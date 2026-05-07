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

from fastapi import Body, FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import asyncio
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
_camera_cache: dict = {'data': b''}      # /camera/image_raw/compressed 의 jpeg bytes
_path_cache: dict = {'points': [], 'updated_at': 0.0}  # Nav2 /plan 의 (x,y) 리스트
_clock_cache: dict = {'sim_secs': 0.0, 'updated_at': 0.0}  # /clock (rosgraph_msgs/Clock)
_frontier_cache: dict = {'points': [], 'updated_at': 0.0}  # explore_lite frontier candidates
_ros_node_thread: Optional[threading.Thread] = None
# /map / /odom / /camera / /plan / frontier 새 메시지 도착 시 set, WS 구독자가 await.
_map_event = threading.Event()
_pose_event = threading.Event()
_camera_event = threading.Event()
_path_event = threading.Event()
_frontier_event = threading.Event()
# 텔레옵: /cmd_vel publisher + Nav2 /goal_pose publisher. _start_ros_subscriber 에서 init.
_cmd_vel_pub = None
_goal_pose_pub = None
# 단순 회전 (reloc UX 명목) 진행 중 플래그. cancel_event 에서 끄면 즉시 종료.
_spin_active = False


def _start_ros_subscriber() -> None:
    """별도 스레드에서 rclpy spin. /odom 구독해 latest 캐시."""
    global _pose_cache
    global _cmd_vel_pub, _goal_pose_pub
    try:
        import rclpy
        from rclpy.node import Node
        from nav_msgs.msg import Odometry, OccupancyGrid, Path
        from geometry_msgs.msg import Twist, PoseStamped
        from sensor_msgs.msg import CompressedImage
        from rosgraph_msgs.msg import Clock
        from visualization_msgs.msg import MarkerArray
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
        _pose_event.set()

    def map_cb(msg) -> None:
        global _map_cache
        _map_cache = {
            'available': True,
            'width': msg.info.width,
            'height': msg.info.height,
            'resolution': msg.info.resolution,
            'origin_x': msg.info.origin.position.x,
            'origin_y': msg.info.origin.position.y,
            'data': list(msg.data),  # int8 (-1 unknown, 0 free, 100 occupied)
            'updated_at': _time.time(),
        }
        _map_event.set()

    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
    qos_odom = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=10,
                          reliability=ReliabilityPolicy.RELIABLE)
    qos_map = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.RELIABLE,
                         durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(Odometry, '/odom', odom_cb, qos_odom)
    # slam_toolbox 는 /map 직접 발행 (transient_local). RTAB-Map 도 launch 의 ('map','/map')
    # remap 으로 같은 토픽에 publish — 한 곳에서 양쪽 백엔드 커버.
    node.create_subscription(OccupancyGrid, '/map', map_cb, qos_map)

    # 카메라 jpeg 캐시 — /camera/image_raw/compressed 도착 시 bytes 만 저장.
    def cam_cb(msg) -> None:
        _camera_cache['data'] = bytes(msg.data)
        _camera_event.set()
    qos_cam = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(CompressedImage, '/camera/image_raw/compressed', cam_cb, qos_cam)

    # Nav2 /plan (현재 글로벌 경로) — 이벤트 진행 중 시각화용.
    def path_cb(msg) -> None:
        pts = [(ps.pose.position.x, ps.pose.position.y) for ps in msg.poses]
        _path_cache['points'] = pts
        _path_cache['updated_at'] = _time.time()
        _path_event.set()
    qos_path = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                          reliability=ReliabilityPolicy.RELIABLE)
    node.create_subscription(Path, '/plan', path_cb, qos_path)

    # /clock — gazebo sim_time. 우하단 status bar 표시용.
    def clock_cb(msg) -> None:
        _clock_cache['sim_secs'] = msg.clock.sec + msg.clock.nanosec / 1e9
        _clock_cache['updated_at'] = _time.time()
    qos_clock = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                           reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(Clock, '/clock', clock_cb, qos_clock)

    # explore_lite frontier 후보 — visualization_msgs/MarkerArray.
    # 각 marker.points 가 polygon 윤곽이거나 단일 frontier 중심점. 단순화: 각 marker
    # 의 pose.position 만 사용 (마커 모드 SPHERE/CUBE 인 경우 frontier 후보 표시).
    def frontier_cb(msg) -> None:
        pts: list[tuple[float, float]] = []
        for m in msg.markers:
            # 삭제 액션 (action=2) 은 skip
            if getattr(m, 'action', 0) == 2:
                continue
            p = m.pose.position
            pts.append((p.x, p.y))
        _frontier_cache['points'] = pts
        _frontier_cache['updated_at'] = _time.time()
        _frontier_event.set()
    qos_marker = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                            reliability=ReliabilityPolicy.RELIABLE)
    # explore_lite 의 토픽 이름은 보통 /explore/frontiers (publisher)
    node.create_subscription(MarkerArray, '/explore/frontiers', frontier_cb, qos_marker)

    # 텔레옵: 웹에서 보낸 명령을 /cmd_vel 로 publish. Nav2/explore 가 같은 토픽에 쓰므로
    # 사용자가 입력 중이면 마지막 메시지가 이김 → 사실상 우선권 (1순위 요건 충족).
    _cmd_vel_pub = node.create_publisher(Twist, '/cmd_vel', 10)
    # Nav2 /goal_pose publisher — subprocess(ros2 topic pub) 우회. 즉시 publish.
    qos_goal = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                          reliability=ReliabilityPolicy.RELIABLE)
    _goal_pose_pub = node.create_publisher(PoseStamped, '/goal_pose', qos_goal)
    log.info('rclpy subs ready + cmd_vel/goal_pose publishers')

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


# ── SLAM 노드 라이프사이클 (subprocess) ─────────────────────────────────
# 부팅 시엔 slam_toolbox 안 띄우고 (use_slam_toolbox:=false), 웹 명령으로 spawn.
# slam_toolbox 는 lifecycle 노드라 직접 ros2 run 으로 띄우면 unconfigured 상태로 남으므로
# launch 에 들어있는 동일한 lifecycle 시퀀스 (configure → activate) 를 재사용하기 위해
# launch_slam_node.launch.py 같은 별도 launch 가 필요. 간단히 async_slam_toolbox_node 를
# 직접 띄우고 lifecycle CLI 로 configure/activate.
SLAM_PARAMS = '/root/gz-nav-sim/install/gz_nav_sim/share/gz_nav_sim/config/slam_params.yaml'
_slam_proc: Optional[subprocess.Popen] = None


def _slam_node_alive() -> bool:
    try:
        out = subprocess.run(
            ['bash', '-c',
             f'source {ROS_SETUP} && source {WS_SETUP} && '
             'ros2 node list 2>/dev/null | grep -F /slam_toolbox'],
            capture_output=True, text=True, timeout=5)
        return out.returncode == 0 and bool(out.stdout.strip())
    except Exception:
        return False


def _slam_spawn() -> dict:
    """slam_toolbox 노드 spawn + lifecycle activate. 이미 떠있으면 noop."""
    global _slam_proc
    if _slam_node_alive():
        return {'ok': True, 'status': 'already_running'}
    if _slam_proc and _slam_proc.poll() is None:
        return {'ok': True, 'status': 'spawning_pending', 'pid': _slam_proc.pid}
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f'ros2 run slam_toolbox async_slam_toolbox_node '
        f'--ros-args --params-file {SLAM_PARAMS} '
        f'-p use_sim_time:=true -p use_lifecycle_manager:=false'
    )
    _slam_proc = subprocess.Popen(['bash', '-c', cmd])
    # lifecycle configure → activate. 노드 등장까지 잠깐 대기.
    for _ in range(20):
        if _slam_node_alive():
            break
        _time.sleep(0.5)
    cfg = subprocess.run(
        ['bash', '-c',
         f'source {ROS_SETUP} && '
         'ros2 lifecycle set /slam_toolbox configure && '
         'ros2 lifecycle set /slam_toolbox activate'],
        capture_output=True, text=True, timeout=20)
    return {
        'ok': cfg.returncode == 0,
        'status': 'started',
        'pid': _slam_proc.pid,
        'lifecycle_log': (cfg.stdout + cfg.stderr)[:300],
    }


@app.post('/api/robots/{robot_id}/slam/start')
def slam_start(robot_id: str):
    return _slam_spawn()


@app.post('/api/robots/{robot_id}/slam/stop')
def slam_stop(robot_id: str):
    """slam_toolbox + explore 정리. uvicorn --reload 로 _slam_proc handle 잃을 수
    있으니 pkill -f 로도 fallback (이름 기반 catch-all)."""
    global _slam_proc, _explore_proc
    killed = []
    for proc, name in ((_explore_proc, 'explore'), (_slam_proc, 'slam')):
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            killed.append(f'{name}(pid={proc.pid})')
    _slam_proc = None
    _explore_proc = None
    # 이름 기반 잔여 정리 (--reload 후 handle 잃은 경우 등).
    for pat in ('async_slam_toolbox_node', 'explore_lite explore.launch'):
        try:
            r = subprocess.run(['pkill', '-f', pat], capture_output=True)
            if r.returncode == 0:
                killed.append(f'pkill:{pat}')
        except Exception:
            pass
    return {'ok': True, 'killed': killed}


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


# ── '내 위치 찾기': 단순 회전 (UX 명목). 실제 reloc 은 SLAM 백엔드 의존이라 별도. ──
@app.post('/api/robots/{robot_id}/slam/relocalize')
def relocalize(robot_id: str):
    """로봇을 한 바퀴 회전. /api/system/cancel_event 로 즉시 정지 가능.
    실제 reloc 알고리즘 (BoW 매칭 등) 은 미구현 — 사용자 시각 피드백 용도.
    동기 호출이라 ~11초 block 되지만 FastAPI 가 threadpool 에서 처리해 다른 요청 무관.
    """
    global _spin_active
    if _cmd_vel_pub is None:
        raise HTTPException(status_code=503, detail='cmd_vel publisher not initialized')
    if _spin_active:
        return {'converged': False, 'reason': 'already spinning'}
    _spin_active = True
    from geometry_msgs.msg import Twist
    spin_msg = Twist()
    spin_msg.angular.z = 0.6  # rad/s
    stop_msg = Twist()
    duration = 11.0  # 한 바퀴 ≈ 2π / 0.6 ≈ 10.5초
    rate_hz = 10
    n = int(duration * rate_hz)
    interrupted = False
    try:
        for _ in range(n):
            if not _spin_active:  # cancel_event 가 False 로 바꾸면 즉시 종료
                interrupted = True
                break
            _cmd_vel_pub.publish(spin_msg)
            _time.sleep(1.0 / rate_hz)
    finally:
        _cmd_vel_pub.publish(stop_msg)
        _spin_active = False
    return {'converged': False, 'completed': not interrupted, 'reason': 'simple spin' + (' (canceled)' if interrupted else '')}


# ── explore_lite 트리거 ────────────────────────────────────────────────
_explore_proc: Optional[subprocess.Popen] = None


@app.post('/api/robots/{robot_id}/slam/explore/start')
def explore_start(robot_id: str):
    """매핑·탐사 시작. SLAM 이 먼저 떠있어야 explore_lite 가 /map 입력 받을 수 있음."""
    global _explore_proc
    slam_result = _slam_spawn()
    # 1) sim_nav.launch.py 가 use_explore=true 로 띄운 explore_node 가 있나?
    try:
        proc = subprocess.run(
            ['bash', '-c',
             f'source {ROS_SETUP} && source {WS_SETUP} && '
             'ros2 node list 2>/dev/null | grep -F /explore_node'],
            capture_output=True, text=True, timeout=5)
        if proc.returncode == 0 and proc.stdout.strip():
            return {'ok': True, 'status': 'already_running_via_launch',
                    'slam': slam_result}
    except Exception:
        pass
    # 2) 우리가 이전에 띄운 거면 그대로 사용
    if _explore_proc and _explore_proc.poll() is None:
        return {'ok': True, 'status': 'already_running_via_adapter',
                'pid': _explore_proc.pid, 'slam': slam_result}
    # 3) 새로 spawn
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        'ros2 launch explore_lite explore.launch.py use_sim_time:=true'
    )
    _explore_proc = subprocess.Popen(['bash', '-c', cmd])
    return {'ok': True, 'status': 'started', 'pid': _explore_proc.pid,
            'slam': slam_result}


@app.get('/api/robots/{robot_id}/slam/explore/status')
def explore_status(robot_id: str):
    global _explore_proc
    if _explore_proc is None:
        return {'exploreStatus': 'idle'}
    rc = _explore_proc.poll()
    if rc is None:
        return {'exploreStatus': 'running', 'pid': _explore_proc.pid}
    return {'exploreStatus': 'stopped', 'exit_code': rc}


@app.get('/api/robots/{robot_id}/slam/status')
def slam_status(robot_id: str):
    """SLAM/explore 활성 여부. uvicorn --reload 로 _slam_proc handle 잃어도
    실제 ROS 노드 존재 여부로 판단 → 항상 정확."""
    return {
        'slamActive': _slam_node_alive(),
        'exploreActive': _explore_node_alive(),
    }


def _explore_node_alive() -> bool:
    try:
        out = subprocess.run(
            ['bash', '-c',
             f'source {ROS_SETUP} && source {WS_SETUP} && '
             'ros2 node list 2>/dev/null | grep -F /explore_node'],
            capture_output=True, text=True, timeout=5)
        return out.returncode == 0 and bool(out.stdout.strip())
    except Exception:
        return False


# ── 텔레옵 ───────────────────────────────────────────────────────────────
class TeleopRequest(BaseModel):
    linear: float = 0.0   # m/s, +전진 -후진
    angular: float = 0.0  # rad/s, +좌회전 -우회전


def _publish_twist(linear: float, angular: float) -> dict:
    if _cmd_vel_pub is None:
        raise HTTPException(status_code=503, detail='cmd_vel publisher not initialized')
    from geometry_msgs.msg import Twist
    msg = Twist()
    msg.linear.x = float(linear)
    msg.angular.z = float(angular)
    _cmd_vel_pub.publish(msg)
    return {'ok': True, 'linear': msg.linear.x, 'angular': msg.angular.z}


@app.post('/api/robots/{robot_id}/teleop')
def teleop(robot_id: str, req: TeleopRequest):
    """1회 Twist publish. Spring Boot 경유 (auth 필요)."""
    return _publish_twist(req.linear, req.angular)


@app.post('/api/system/cancel_event')
def cancel_event():
    """진행 중 이벤트 (reloc 회전, Nav2 goto, explore) 강제 정지.
    - spin_and_relocalize.py 프로세스 kill
    - explore_lite 가 spawn 된 경우 종료 (선택적 — '이벤트 정지' 의미)
    - /cmd_vel 에 (0,0) burst → 로봇 즉시 정지 (Nav2 controller 가 다시 cmd 보내도
      우리가 더 자주 publish 하므로 짧게 우위. SLAM 이 살아 있으면 explore 가 다시
      움직이려 시도하니 explore 도 같이 죽임).
    """
    killed = []
    # 1) spin (reloc) 프로세스
    try:
        r = subprocess.run(['pkill', '-f', 'spin_and_relocalize'], capture_output=True)
        if r.returncode == 0: killed.append('spin_and_relocalize')
    except Exception: pass
    # 2) explore_lite (사용자가 SLAM 도 같이 멈추는 의미로)
    try:
        r = subprocess.run(['pkill', '-f', 'explore_lite explore.launch'], capture_output=True)
        if r.returncode == 0: killed.append('explore_lite')
    except Exception: pass
    # 3) Nav2 BT navigator action cancel — bash one-shot.
    #    BT navigator 의 active goal 을 모두 cancel.
    try:
        subprocess.run(['bash', '-c',
            f'source {ROS_SETUP} && '
            "ros2 action send_goal --feedback /navigate_to_pose nav2_msgs/action/NavigateToPose "
            "'{pose: {header: {frame_id: \"map\"}, pose: {position: {x: 0.0, y: 0.0, z: 0.0}, orientation: {x: 0.0, y: 0.0, z: 0.0, w: 1.0}}}}' "
            "--cancel || true"],
            capture_output=True, timeout=5)
        killed.append('nav2_goal')
    except Exception: pass
    # 4) cmd_vel (0,0) burst — 0.5초 동안
    if _cmd_vel_pub is not None:
        from geometry_msgs.msg import Twist
        msg = Twist()
        for _ in range(5):
            try: _cmd_vel_pub.publish(msg)
            except Exception: pass
            _time.sleep(0.1)
        killed.append('cmd_vel_zero_burst')
    return {'ok': True, 'killed': killed}


@app.post('/api/system/teleop')
def teleop_system(req: TeleopRequest):
    """auth 없이 vite /api/system 프록시로 직접 어댑터 호출.
    프론트가 hold 중에 ~10Hz 폴링하므로 round-trip 짧게 유지 (8080 우회)."""
    return _publish_twist(req.linear, req.angular)


# ── 네비게이션 목표 (Nav2 goal) ─────────────────────────────────────────
class NavGoalRequest(BaseModel):
    x: float       # 맵 좌표계 (m)
    y: float       # 맵 좌표계 (m)
    yaw: float = 0.0  # 도착 시 yaw (rad), 기본 0


@app.post('/api/system/nav/goto')
def nav_goto(req: NavGoalRequest):
    """rclpy publisher 로 /goal_pose 즉시 publish (subprocess timeout 회피).
    Nav2 BT navigator 가 transient_local QoS 로 받아서 navigate_to_pose action 트리거."""
    if _goal_pose_pub is None:
        raise HTTPException(status_code=503, detail='goal_pose publisher not initialized')
    import math
    from geometry_msgs.msg import PoseStamped
    msg = PoseStamped()
    msg.header.frame_id = 'map'
    msg.pose.position.x = float(req.x)
    msg.pose.position.y = float(req.y)
    msg.pose.position.z = 0.0
    msg.pose.orientation.z = math.sin(req.yaw / 2.0)
    msg.pose.orientation.w = math.cos(req.yaw / 2.0)
    _goal_pose_pub.publish(msg)
    return {'ok': True, 'goal': {'x': req.x, 'y': req.y, 'yaw': req.yaw}}


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

    # 실제 데이터 흐름 기준 (단순 토픽 존재 X). /odom 과 /map 은 영속 구독자가
    # 캐시하므로 그 신선도로 판단. 나머지는 우선 토픽 list 기반 (개선 여지 있음).
    expected = ['/odom', '/scan', '/map', '/tf', '/tf_static',
                '/camera/image_raw', '/d456/depth/image_raw',
                '/rtabmap/info', '/rtabmap/grid_map']
    topic_status: dict[str, bool] = {}
    for t in expected:
        if t == '/odom':
            age = now - (_pose_cache.get('updated_at') or 0)
            topic_status[t] = _pose_cache.get('available', False) and age < 5
        elif t == '/map':
            age = now - (_map_cache.get('updated_at') or 0)
            topic_status[t] = _map_cache.get('available', False) and age < 30
        else:
            topic_status[t] = t in ros_topics

    return {
        'adapter': 'ok',
        'sim_alive': sim_alive,
        'slam_active': _slam_node_alive(),
        'explore_active': _explore_node_alive(),
        'sim_secs': _clock_cache.get('sim_secs', 0.0),
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


def _grid_to_png_bytes() -> Optional[bytes]:
    if not _map_cache.get('available'):
        return None
    try:
        from PIL import Image
        import io
        w, h = _map_cache['width'], _map_cache['height']
        data = _map_cache['data']
        pixels = bytearray(w * h)
        for i, v in enumerate(data):
            if v < 0:
                pixels[i] = 127
            elif v < 50:
                pixels[i] = 255
            else:
                pixels[i] = 0
        img = Image.frombytes('L', (w, h), bytes(pixels))
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    except Exception:
        return None


@app.websocket('/ws/map')
async def ws_map(ws: WebSocket):
    """라이브 맵 스트림. /rtabmap/map 메시지 도착할 때마다 메타 JSON + PNG 바이너리 전송.

    프로토콜 (한 사이클):
      1. JSON text frame: {width,height,resolution,origin_x,origin_y,updated_at}
      2. binary frame: PNG 데이터
    클라이언트는 둘을 페어로 처리.
    """
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        # 즉시 한 번 보내기 (있으면)
        while True:
            up = _map_cache.get('updated_at', 0)
            if _map_cache.get('available') and up != last_seen:
                last_seen = up
                meta = {
                    'width': _map_cache['width'],
                    'height': _map_cache['height'],
                    'resolution': _map_cache['resolution'],
                    'origin_x': _map_cache['origin_x'],
                    'origin_y': _map_cache['origin_y'],
                    'updated_at': up,
                }
                await ws.send_json(meta)
                png = _grid_to_png_bytes()
                if png:
                    await ws.send_bytes(png)
            # 새 메시지 대기 (또는 1초 timeout 으로 클라이언트 ping)
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _map_event.wait(timeout=1.0))
            _map_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_map error: %s', e)


@app.websocket('/ws/pose')
async def ws_pose(ws: WebSocket):
    """라이브 pose 스트림. /odom 메시지마다 JSON 전송 (rate ~50Hz).
    sim_time (clock 캐시) 도 함께 동봉."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _pose_cache.get('updated_at', 0)
            if _pose_cache.get('available') and up != last_seen:
                last_seen = up
                payload = {**_pose_cache, 'sim_secs': _clock_cache.get('sim_secs', 0.0)}
                await ws.send_json(payload)
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _pose_event.wait(timeout=1.0))
            _pose_event.clear()
    except WebSocketDisconnect:
        pass


@app.websocket('/ws/frontiers')
async def ws_frontiers(ws: WebSocket):
    """explore_lite frontier 후보 (x,y) 배열. 새 marker array 도착 시 push."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _frontier_cache.get('updated_at', 0)
            if up != last_seen:
                last_seen = up
                await ws.send_json({'points': _frontier_cache['points'], 'updated_at': up})
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _frontier_event.wait(timeout=2.0))
            _frontier_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_frontiers error: %s', e)


@app.websocket('/ws/path')
async def ws_path(ws: WebSocket):
    """Nav2 /plan 라이브 경로. 이벤트 진행 중 path 가 publish 되면 (x,y) 배열 push."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _path_cache.get('updated_at', 0)
            if up != last_seen:
                last_seen = up
                await ws.send_json({'points': _path_cache['points'], 'updated_at': up})
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _path_event.wait(timeout=2.0))
            _path_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_path error: %s', e)


@app.websocket('/ws/camera')
async def ws_camera(ws: WebSocket):
    """라이브 카메라 stream. /camera/image_raw/compressed (jpeg) 도착 시 bytes push."""
    await ws.accept()
    _ensure_subscriber()
    try:
        while True:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _camera_event.wait(timeout=2.0))
            _camera_event.clear()
            data = _camera_cache.get('data')
            if data:
                await ws.send_bytes(data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_camera error: %s', e)


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
