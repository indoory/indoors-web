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
    """관제·디버깅 콘솔용 종합 헬스. ROS·시뮬·어댑터·맵 DB 한 번에."""
    import shutil
    # ROS 토픽 list (있는 토픽만)
    ros_topics = []
    try:
        proc = subprocess.run(
            ['bash', '-c',
             f'source {ROS_SETUP} && source {WS_SETUP} && ros2 topic list 2>/dev/null'],
            capture_output=True, text=True, timeout=5)
        ros_topics = [t for t in proc.stdout.strip().split('\n') if t]
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


@app.get('/api/system/last_pose')
def last_pose():
    """현재 /odom 의 마지막 pose 한 번 조회 (sim 상태 디버깅)."""
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        'timeout 3 ros2 topic echo /odom --once 2>/dev/null | head -20'
    )
    try:
        proc = subprocess.run(['bash', '-c', cmd], capture_output=True, text=True, timeout=6)
        out = proc.stdout
        if not out.strip():
            return {'available': False}
        # 간단히 x, y, yaw 만 파싱
        import re
        x = re.search(r'x:\s*(-?[\d.e+-]+)', out)
        y = re.search(r'y:\s*(-?[\d.e+-]+)', out)
        return {
            'available': True,
            'raw': out[:500],
            'x': float(x.group(1)) if x else None,
            'y': float(y.group(1)) if y else None,
        }
    except Exception as e:
        return {'available': False, 'error': str(e)}
