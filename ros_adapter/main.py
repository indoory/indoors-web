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

from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import requests

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
class SaveSlamReq(BaseModel):
    mapId: Optional[int] = None
    mapName: Optional[str] = None


@app.post('/api/robots/{robot_id}/slam/save')
def slam_save(robot_id: str, req: SaveSlamReq):
    # 1) rtabmap 에 backup (현재 working DB → ~/.ros/rtabmap.db.back) 트리거.
    ok, log = _ros_service_call('/rtabmap/backup', 'std_srvs/srv/Empty')
    if not ok:
        # backup 서비스가 없는 버전이면 set_mode_localization 호출로 강제 flush.
        _ros_service_call(
            '/rtabmap/set_mode_localization', 'std_srvs/srv/Empty')
    if not RTABMAP_DB.exists():
        raise HTTPException(status_code=500, detail=f'DB not found at {RTABMAP_DB}')

    # 2) Spring Boot 에 multipart POST.
    if req.mapId is None:
        raise HTTPException(status_code=400, detail='mapId required')
    url = f'{SPRING_BASE}/api/maps/{req.mapId}/rtabmap-db'
    with RTABMAP_DB.open('rb') as f:
        files = {'file': (f'{req.mapName or "map"}.db', f, 'application/octet-stream')}
        r = requests.post(url, files=files, timeout=60)
    return {
        'ok': r.ok,
        'status': r.status_code,
        'db_size_mb': round(RTABMAP_DB.stat().st_size / 1e6, 2),
        'log': log[:200],
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
