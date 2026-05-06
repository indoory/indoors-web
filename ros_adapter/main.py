"""ROS2 ↔ Spring Boot 브리지 어댑터.

Spring Boot 가 :8000 으로 호출하는 REST 라우트를 ros2 service/topic 호출로 변환.
- POST /api/robots/{id}/slam/save           → rtabmap DB 백업 + 호출자에게 blob multipart 푸시
- POST /api/robots/{id}/floor/set           → 새 층 DB blob 디스크 stage + rtabmap reload
- POST /api/robots/{id}/slam/relocalize     → spin_and_relocalize.py 실행
- POST /api/robots/{id}/slam/start /stop    → rtabmap mapping/localization 모드 토글
- POST /api/robots/{id}/slam/explore/start  → explore_lite launch
- GET  /api/robots/{id}/slam/explore/status → explore_lite 라이브 상태

ros_adapter 는 단순 stateless: ROS2 서비스 호출만, 영속 상태는 Spring Boot DB 가 보유.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import requests
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('adapter')

# ── 설정 ─────────────────────────────────────────────────────────────────
RTABMAP_DB = Path(os.environ.get('RTABMAP_DB', os.path.expanduser('~/.ros/rtabmap.db')))
FLOOR_DB_DIR = Path(os.environ.get('FLOOR_DB_DIR', '/var/indoory/floor_dbs'))
SPRING_BASE = os.environ.get('SPRING_BASE_URL', 'http://localhost:8080')
SPIN_RELOC_SCRIPT = Path(os.environ.get(
    'SPIN_RELOC_SCRIPT',
    '/root/gz-nav-sim/bench/spin_and_relocalize.py'))
ROS_SETUP = '/opt/ros/humble/setup.bash'
WS_SETUP = '/root/gz-nav-sim/install/setup.bash'

FLOOR_DB_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title='Indoory ROS2 Adapter')


# ── 영속 ROS 구독자: /odom 등을 백그라운드에서 캐시 ───────────────────
# 이전엔 매 요청마다 `ros2 topic echo --once` subprocess 를 띄워서
# DDS 핸드셰이크 폭주 → ROS2 daemon 부하 + 토픽 전반 느려짐.
# 이제 한 번만 구독하고 메모리 캐시 → HTTP 는 cache read 만.
import threading
import time as _time

_pose_cache: dict = {'available': False}
_topics_cache: dict = {'topics': [], 'fetched_at': 0.0}
_map_cache: dict = {'available': False}  # OccupancyGrid 메타 + 데이터
_ros_node_thread: Optional[threading.Thread] = None


def _start_ros_subscriber() -> None:
    """별도 스레드에서 rclpy spin. /odom 구독해 latest 캐시."""
    global _pose_cache
    try:
        import rclpy
        from rclpy.node import Node
        from nav_msgs.msg import Odometry, OccupancyGrid
    except Exception as e:
        log.warning('rclpy import failed — cache disabled: %s', e)
        return

    try:
        rclpy.init(args=None)
    except RuntimeError:
        pass  # 이미 init 됨 (uvicorn --reload 가 모듈 다시 import 한 경우 등)
    node = Node('indoory_adapter_telemetry')

    def odom_cb(msg: Odometry) -> None:
        global _pose_cache
        p = msg.pose.pose
        o = p.orientation
        # quaternion → yaw (z-axis rotation)
        import math
        yaw = math.atan2(2 * (o.w * o.z + o.x * o.y),
                         1 - 2 * (o.y * o.y + o.z * o.z))
        _pose_cache = {
            'available': True,
            'x': p.position.x,
            'y': p.position.y,
            'z': p.position.z,
            'yaw_rad': yaw,
            'yaw_deg': math.degrees(yaw),
            'frame': msg.header.frame_id,
            'updated_at': _time.time(),
        }

    def map_cb(msg) -> None:
        global _map_cache
        _map_cache = {
            'available': True,
            'width': msg.info.width,
            'height': msg.info.height,
            'resolution': msg.info.resolution,
            'origin_x': msg.info.origin.position.x,
            'origin_y': msg.info.origin.position.y,
            'data': list(msg.data),  # int8 배열 (-1 unknown, 0 free, 100 occupied)
            'updated_at': _time.time(),
        }

    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
    qos_odom = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=10,
                          reliability=ReliabilityPolicy.RELIABLE)
    qos_map = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.RELIABLE,
                         durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(Odometry, '/odom', odom_cb, qos_odom)
    # rtabmap 의 실제 OccupancyGrid 발행 토픽: /rtabmap/map (또는 /rtabmap/grid_prob_map).
    # /map 으로 remap 하려 했으나 launch 의 'grid_map' 키는 존재하지 않아 no-op 였음.
    node.create_subscription(OccupancyGrid, '/rtabmap/map', map_cb, qos_map)
    log.info('rclpy subscribers /odom + /rtabmap/map started (cached)')

    try:
        rclpy.spin(node)
    except Exception as e:
        log.warning('rclpy spin ended: %s', e)
    finally:
        node.destroy_node()
        try:
            rclpy.shutdown()
        except Exception:
            pass


def _ensure_subscriber() -> None:
    global _ros_node_thread
    if _ros_node_thread is None or not _ros_node_thread.is_alive():
        _ros_node_thread = threading.Thread(
            target=_start_ros_subscriber, daemon=True, name='ros-sub')
        _ros_node_thread.start()


@app.on_event('startup')
def _on_startup() -> None:
    _ensure_subscriber()


def _ros_service_call(srv_name: str, srv_type: str, args: str = '{}') -> tuple[bool, str]:
    """`ros2 service call` subprocess wrapper. ROS env sourced."""
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f"ros2 service call {srv_name} {srv_type} '{args}'"
    )
    try:
        proc = subprocess.run(
            ['bash', '-c', cmd], capture_output=True, text=True, timeout=20)
        ok = proc.returncode == 0 and ('response' in proc.stdout.lower()
                                       or 'success' in proc.stdout.lower()
                                       or 'response: rtabmap_msgs' in proc.stdout.lower()
                                       or proc.returncode == 0)
        return proc.returncode == 0, (proc.stdout or '') + (proc.stderr or '')
    except subprocess.TimeoutExpired:
        return False, f'timeout calling {srv_name}'


# ── SLAM 모드 토글 ──────────────────────────────────────────────────────
@app.post('/api/robots/{robot_id}/slam/start')
def slam_start(robot_id: str):
    ok, log = _ros_service_call('/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
    return {'ok': ok, 'log': log[:500]}


@app.post('/api/robots/{robot_id}/slam/stop')
def slam_stop(robot_id: str):
    # rtabmap 의 backup → 안전 stop. set_mode_localization 으로 책임 종료.
    ok, log = _ros_service_call('/rtabmap/backup', 'std_srvs/srv/Empty')
    return {'ok': ok, 'log': log[:500]}


# ── DB 저장: rtabmap → 디스크 → Spring Boot 푸시 ───────────────────────
@app.post('/api/robots/{robot_id}/slam/save')
async def slam_save(robot_id: str, request: Request):
    """Save 요청은 body 가 없거나 {mapId, mapName} JSON. 둘 다 허용."""
    body = await request.body()
    log.info('slam/save body bytes=%d content-type=%s',
             len(body), request.headers.get('content-type'))
    try:
        payload = await request.json() if body else {}
    except Exception:
        payload = {}
    map_id = payload.get('mapId')
    map_name = payload.get('mapName') or 'map'

    # rtabmap 은 SQLite WAL 모드로 incremental write 하므로 ~/.ros/rtabmap.db 는
    # 항상 consistent. /rtabmap/backup srv 호출은 대용량 DB 복사로 타임아웃 위험 →
    # 직접 파일 read 가 가장 안전. (multi-session 맥락에서 약간의 미반영분 있더라도
    # 다음 save 가 보완)
    srv_log = ''
    if not RTABMAP_DB.exists():
        raise HTTPException(status_code=500, detail=f'DB not found at {RTABMAP_DB}')

    # 2) Spring Boot 의 /api/maps/{id}/rtabmap-db 로 multipart 푸시.
    if map_id is None:
        return {
            'ok': False,
            'reason': 'mapId not provided — DB exists locally but not pushed',
            'db_size_mb': round(RTABMAP_DB.stat().st_size / 1e6, 2),
        }
    url = f'{SPRING_BASE}/api/maps/{map_id}/rtabmap-db'
    with RTABMAP_DB.open('rb') as f:
        files = {'file': (f'{map_name}.db', f, 'application/octet-stream')}
        r = requests.post(url, files=files, timeout=60)
    return {
        'ok': r.ok,
        'status': r.status_code,
        'db_size_mb': round(RTABMAP_DB.stat().st_size / 1e6, 2),
        'log': (srv_log or '')[:200],
    }


# ── 층 전환: Spring 으로부터 blob 받아 디스크 stage + rtabmap reload ────
@app.post('/api/robots/{robot_id}/floor/set')
async def floor_set(robot_id: str, floorCode: str, file: UploadFile = File(...)):
    """multipart: floorCode (form field), file (rtabmap .db blob).

    저장 위치: FLOOR_DB_DIR/{floorCode}.db
    그리고 rtabmap 에 load_database 서비스 호출.
    """
    target = FLOOR_DB_DIR / f'{floorCode}.db'
    target.write_bytes(await file.read())

    # rtabmap_msgs/srv/LoadDatabase: { database_path: string, clear: bool }
    args = f'{{database_path: "{target}", clear: true}}'
    ok, log = _ros_service_call(
        '/rtabmap/load_database', 'rtabmap_msgs/srv/LoadDatabase', args=args)
    return {
        'ok': ok,
        'staged_at': str(target),
        'size_mb': round(target.stat().st_size / 1e6, 2),
        'log': log[:300],
    }


# ── 새 맵으로 시작 (저장된 .db 없는 floor) ─────────────────────────────
@app.post('/api/robots/{robot_id}/floor/fresh')
async def floor_fresh(robot_id: str, request: Request):
    """현재 working memory 비우고 mapping 모드 진입. 새로운 floor 매핑 시작.

    rtabmap 의 /rtabmap/reset 은 working memory + DB 모두 초기화.
    다음 save 시점에 새 .db 가 Spring 으로 푸시됨.
    """
    body = await request.body()
    try:
        payload = await request.json() if body else {}
    except Exception:
        payload = {}
    floor_code = payload.get('floorCode', 'unknown')
    log.info('floor/fresh: %s — resetting rtabmap to start new map', floor_code)

    ok1, _ = _ros_service_call('/rtabmap/reset', 'std_srvs/srv/Empty')
    ok2, _ = _ros_service_call(
        '/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
    return {
        'ok': ok1 or ok2,
        'floorCode': floor_code,
        'mode': 'mapping',
        'note': 'fresh start — explore via /slam/explore/start to fill map',
    }


# ── 글로벌 재로컬: 회전 + RTAB-Map BoW 매칭 ────────────────────────────
@app.post('/api/robots/{robot_id}/slam/relocalize')
def relocalize(robot_id: str):
    """Mem/IncrementalMemory=false 로 전환 후 spin_and_relocalize.py subprocess 실행.

    동기 호출. spin_and_relocalize 가 종료 코드로 결과 반환:
      0 = 수렴 성공, 1 = timeout, 2 = error.
    """
    _ros_service_call('/rtabmap/set_mode_localization', 'std_srvs/srv/Empty')

    if not SPIN_RELOC_SCRIPT.exists():
        raise HTTPException(status_code=500, detail=f'script missing: {SPIN_RELOC_SCRIPT}')
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f'python3 {SPIN_RELOC_SCRIPT} --timeout 15'
    )
    proc = subprocess.run(
        ['bash', '-c', cmd], capture_output=True, text=True, timeout=30)
    return {
        'converged': proc.returncode == 0,
        'exit_code': proc.returncode,
        'stdout_tail': (proc.stdout or '')[-500:],
        'stderr_tail': (proc.stderr or '')[-200:],
    }


# ── explore_lite 트리거 ────────────────────────────────────────────────
_explore_proc: Optional[subprocess.Popen] = None


@app.post('/api/robots/{robot_id}/slam/explore/start')
def explore_start(robot_id: str):
    global _explore_proc
    if _explore_proc and _explore_proc.poll() is None:
        return {'ok': True, 'status': 'already_running'}
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        'ros2 launch explore_lite explore.launch.py use_sim_time:=true'
    )
    _explore_proc = subprocess.Popen(['bash', '-c', cmd])
    return {'ok': True, 'status': 'started', 'pid': _explore_proc.pid}


@app.get('/api/robots/{robot_id}/slam/explore/status')
def explore_status(robot_id: str):
    global _explore_proc
    if _explore_proc is None:
        return {'exploreStatus': 'idle'}
    rc = _explore_proc.poll()
    if rc is None:
        return {'exploreStatus': 'running', 'pid': _explore_proc.pid}
    return {'exploreStatus': 'stopped', 'exit_code': rc}


# ── 헬스 ────────────────────────────────────────────────────────────────
@app.get('/health')
def health():
    return {'status': 'ok', 'rtabmap_db_exists': RTABMAP_DB.exists()}


@app.get('/api/system/health')
def system_health():
    """관제·디버깅 콘솔용 종합 헬스. ROS·시뮬·어댑터·맵 DB 한 번에.

    ros2 topic list 호출은 비싸니 30초 캐시. /odom 등 라이브 토픽은 영속
    구독자 캐시에서 'updated_at' 신선도로 판단.
    """
    import shutil
    # ROS 토픽 list 30초 캐시 (subprocess 호출 빈도 줄이기)
    now = _time.time()
    ros_topics = _topics_cache['topics']
    if now - _topics_cache['fetched_at'] > 30:
        try:
            proc = subprocess.run(
                ['bash', '-c',
                 f'source {ROS_SETUP} && source {WS_SETUP} && ros2 topic list 2>/dev/null'],
                capture_output=True, text=True, timeout=5)
            fresh = [t for t in proc.stdout.strip().split('\n') if t]
            if fresh:
                _topics_cache['topics'] = fresh
                _topics_cache['fetched_at'] = now
                ros_topics = fresh
        except Exception:
            pass

    # 시뮬 PID (gzserver) 살아있는지
    sim_alive = False
    try:
        proc = subprocess.run(
            ['pgrep', '-f', 'gzserver'], capture_output=True, text=True, timeout=2)
        sim_alive = proc.returncode == 0 and proc.stdout.strip() != ''
    except Exception:
        pass

    db_size = RTABMAP_DB.stat().st_size if RTABMAP_DB.exists() else 0
    disk = shutil.disk_usage('/')

    expected = ['/odom', '/scan', '/map', '/tf', '/tf_static',
                '/camera/image_raw', '/d456/depth/image_raw',
                '/rtabmap/info', '/rtabmap/grid_map']
    topic_status = {t: t in ros_topics for t in expected}

    return {
        'adapter': 'ok',
        'sim_alive': sim_alive,
        'rtabmap_db_path': str(RTABMAP_DB),
        'rtabmap_db_size_mb': round(db_size / 1e6, 2),
        'ros_topic_count': len(ros_topics),
        'ros_expected_topics': topic_status,
        'disk_free_gb': round(disk.free / 1e9, 1),
        'floor_db_dir': str(FLOOR_DB_DIR),
    }


@app.get('/api/system/topic_hz/{topic_name:path}')
def topic_hz(topic_name: str, samples: int = 10):
    """단일 토픽의 publish 속도 측정 (몇 초 동안 sample 회 메시지 카운트)."""
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f'timeout 3 ros2 topic hz /{topic_name.lstrip("/")} 2>&1 | head -8'
    )
    try:
        proc = subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, timeout=8)
        return {'topic': topic_name, 'output': proc.stdout[-1000:]}
    except Exception as e:
        return {'topic': topic_name, 'error': str(e)}


@app.get('/api/system/map')
def map_meta():
    """OccupancyGrid 메타 (width/height/resolution/origin). 그리드 자체는 /map.png."""
    _ensure_subscriber()
    if not _map_cache.get('available'):
        return {'available': False, 'reason': 'no /map message yet'}
    age = _time.time() - _map_cache.get('updated_at', 0)
    return {
        'available': True,
        'width': _map_cache['width'],
        'height': _map_cache['height'],
        'resolution': _map_cache['resolution'],
        'origin_x': _map_cache['origin_x'],
        'origin_y': _map_cache['origin_y'],
        'age_seconds': round(age, 2),
    }


@app.get('/api/system/map.png')
def map_png():
    """OccupancyGrid 를 PNG 로 인코딩해 반환. 프론트가 <img> 로 표시."""
    from fastapi.responses import Response
    _ensure_subscriber()
    if not _map_cache.get('available'):
        return Response(status_code=204)
    try:
        from PIL import Image
        import io
        w, h = _map_cache['width'], _map_cache['height']
        data = _map_cache['data']
        # OccupancyGrid: -1=unknown(gray), 0=free(white), 100=occupied(black)
        pixels = bytearray(w * h)
        for i, v in enumerate(data):
            if v < 0:
                pixels[i] = 127  # unknown — gray
            elif v < 50:
                pixels[i] = 255  # free — white
            else:
                pixels[i] = 0    # occupied — black
        # ROS OccupancyGrid 는 (0,0) 이 원점, row-major. PIL 은 top-left 가 (0,0)
        # 이라 y축 flip 필요.
        img = Image.frombytes('L', (w, h), bytes(pixels))
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return Response(content=buf.getvalue(), media_type='image/png')
    except Exception as e:
        return Response(content=str(e).encode(), status_code=500)


@app.get('/api/system/last_pose')
def last_pose():
    """영속 rclpy 구독자가 캐시한 /odom 의 마지막 pose. subprocess 호출 X."""
    _ensure_subscriber()
    if not _pose_cache.get('available'):
        return {'available': False, 'reason': 'no /odom message yet'}
    age = _time.time() - _pose_cache.get('updated_at', 0)
    return {
        **_pose_cache,
        'age_seconds': round(age, 2),
        'stale': age > 5,
    }
