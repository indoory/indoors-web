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

import json
import os
import subprocess
import tempfile
import io
from pathlib import Path
from typing import Optional

from fastapi import Body, FastAPI, HTTPException, Request, UploadFile, File, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import asyncio
import struct
import requests
import logging

logging.basicConfig(level=logging.INFO)
log = logging.getLogger('adapter')

# ── 설정 ─────────────────────────────────────────────────────────────────
RTABMAP_DB = Path(os.environ.get('RTABMAP_DB', os.path.expanduser('~/.ros/rtabmap.db')))
FLOOR_DB_DIR = Path(os.environ.get('FLOOR_DB_DIR', '/var/indoory/floor_dbs'))
SPRING_BASE = os.environ.get('SPRING_BASE_URL', 'http://localhost:8080')
# 매핑 DB persistent storage 디렉터리. RTAB-Map 이 이 경로의 {mapId}.db 에
# 직접 incremental write 하므로 별도 파일 복사 / autosave 루프 불필요.
# Spring 의 INDOORY_MAP_STORAGE 와 동일해야 UI 가 같은 파일을 봄.
MAP_STORAGE_DIR = Path(os.environ.get('INDOORY_MAP_STORAGE', '/var/indoory/maps'))
MAP_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
ROS_SETUP = '/opt/ros/humble/setup.bash'
GZ_NAV_SIM_ROOT = Path(os.environ.get('GZ_NAV_SIM_ROOT', '/home/fnhid/gz-nav-sim'))
if not (GZ_NAV_SIM_ROOT / 'install/setup.bash').exists() and Path('/root/gz-nav-sim/install/setup.bash').exists():
    GZ_NAV_SIM_ROOT = Path('/root/gz-nav-sim')
SPIN_RELOC_SCRIPT = Path(os.environ.get(
    'SPIN_RELOC_SCRIPT',
    str(GZ_NAV_SIM_ROOT / 'bench/spin_and_relocalize.py')))
WS_SETUP = str(GZ_NAV_SIM_ROOT / 'install/setup.bash')

# Isaac Sim server (xlerobot_v1 ZMQ) — REQ-REP RPC port 5557 (set_pose, reset, ...).
# isaac_bridge 도 같은 host 를 사용. set_pose 같은 sideeffect 호출은 adapter 가
# 직접 REQ — bridge 가 zmq context 점유 중이라 우회.
ISAAC_HOST = os.environ.get('ISAAC_HOST', '127.0.0.1')
ISAAC_REP_PORT = int(os.environ.get('ISAAC_REP_PORT', '5557'))
ISAAC_ROBOT_ID = int(os.environ.get('ISAAC_ROBOT_ID', '0'))

FLOOR_DB_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title='Indoory ROS2 Adapter')


# ── 영속 ROS 구독자: /odom 등을 백그라운드에서 캐시 ───────────────────
# 이전엔 매 요청마다 `ros2 topic echo --once` subprocess 를 띄워서
# DDS 핸드셰이크 폭주 → ROS2 daemon 부하 + 토픽 전반 느려짐.
# 이제 한 번만 구독하고 메모리 캐시 → HTTP 는 cache read 만.
import threading
import time as _time
import collections

# 토픽별 Hz 추적: 콜백 시각을 deque 에 적재 → 윈도우 길이로 카운트해 Hz 산출.
# 헬스 패널 "원래 주기 대비 실측" 표시에 사용. maxlen 으로 메모리 상한.
_topic_msg_times: dict[str, collections.deque] = collections.defaultdict(
    lambda: collections.deque(maxlen=300))

# 토픽별 정상 주기 (Hz). 측정값이 expected/2 미만이면 frontend 가 빨간 표시 = 죽은 것.
# 측정 토픽만 들어있음 (adapter 가 subscribe 하지 않는 토픽은 Hz 산출 불가).
TOPIC_EXPECTED_HZ: dict[str, float] = {
    '/odom': 50.0,
    '/map': 0.5,                              # slam_toolbox map_update_interval ~2s
    '/camera/image_raw/compressed': 30.0,
    '/camera/wrist_left/image_raw/compressed': 30.0,
    '/camera/wrist_right/image_raw/compressed': 30.0,
    '/d456/depth/image_raw': 30.0,
    '/plan': 1.0,
    '/trajectory': 1.0,
    '/clock': 50.0,
    '/semantic_ocr/detections': 5.0,
    '/explore/frontiers': 0.5,
    '/nvblox_node/combined_esdf_pointcloud': 2.0,
}

def _track_msg(topic: str) -> None:
    """콜백 시각을 deque 에 누적. 측정 윈도우 후 _topic_hz() 가 갯수 → Hz 환산."""
    _topic_msg_times[topic].append(_time.time())

def _topic_hz(topic: str, expected_hz: Optional[float] = None) -> float:
    """inter-arrival 기반 Hz: 최근 N 개 도착 시각의 (N-1) / (last - first).

    이전엔 fixed 2초 윈도우 count/window 였는데 저주기 토픽 (0.5/1Hz) 에서
    윈도우 안에 0~2 개만 들어와 0/0.5/1.0 으로 quantized → 부정확.

    개선:
    1) **적응형 윈도우** — expected_hz 알려져 있으면 그 주기로 ~16 샘플 들어올
       길이로 잡는다. 50Hz 면 ~0.3s 면 충분, 0.5Hz 면 ~32s 까지 본다.
       expected 모르면 5s default.
    2) **inter-arrival 평균** — count/window 대신 (N-1)/(last-first) 라
       샘플 수가 적어도 양자화 X. ros2 topic hz 와 동일 방식.
    3) **최근 도착 stale 가드** — last 가 너무 오래 전이면 (window 의 1.5배 초과)
       0 Hz 반환 = 토픽이 최근 안 옴 = dead.
    """
    q = _topic_msg_times.get(topic)
    if not q:
        return 0.0
    now = _time.time()

    # 윈도우 길이 결정: expected_hz 가 있으면 ~16 샘플 들어올 길이.
    # 너무 짧으면 noise (최소 2초), 너무 길면 응답성 저하 (최대 30초).
    if expected_hz and expected_hz > 0:
        window = max(2.0, min(30.0, 16.0 / expected_hz))
    else:
        window = 5.0

    # 마지막 도착이 너무 오래 전이면 dead 로 판정 — 0 Hz.
    last = q[-1]
    if now - last > window * 1.5:
        return 0.0

    # 윈도우 밖 stale 샘플 prune.
    cutoff = now - window
    while q and q[0] < cutoff:
        q.popleft()
    if len(q) < 2:
        return 0.0
    span = q[-1] - q[0]
    return ((len(q) - 1) / span) if span > 0 else 0.0

_pose_cache: dict = {'available': False}
_topics_cache: dict = {'topics': [], 'fetched_at': 0.0}
_map_cache: dict = {'available': False}  # OccupancyGrid 메타 + 데이터
_camera_cache: dict = {'data': b''}      # /camera/image_raw/compressed 의 jpeg bytes
# 추가 카메라 (Isaac wrist left/right) — 도크 "뷰" 탭이 한 번에 3개 표시.
_camera_wrist_l_cache: dict = {'data': b''}
_camera_wrist_r_cache: dict = {'data': b''}
_depth_cache: dict = {'data': b'', 'updated_at': 0.0, 'encoding': ''}  # depth image -> JPEG color map
_path_cache: dict = {'points': [], 'updated_at': 0.0}  # Nav2 /plan 의 (x,y) 리스트
_trajectory_cache: dict = {'points': [], 'updated_at': 0.0}  # 실제 주행 /trajectory
_clock_cache: dict = {'sim_secs': 0.0, 'updated_at': 0.0}  # /clock (rosgraph_msgs/Clock)
_frontier_cache: dict = {'points': [], 'updated_at': 0.0}  # explore_lite frontier candidates
_cloud_cache: dict = {'data': b'', 'count': 0, 'updated_at': 0.0}  # nvblox PointCloud2 → float32 (x,y,z) raw bytes
# RTAB-Map /rtabmap/cloud_map 기반 voxelized scene (nvblox mesh 대용).
# nvblox 없거나 GPU 없는 환경에서 3D 시각화 fallback. (ix,iy,iz) → (r,g,b) 매핑을
# 캐시하고, 새 PointCloud2 도착 시 set diff 로 added/removed delta 만 push.
# 좌표는 _voxel_config['voxel_size'] m 단위 격자 인덱스. int16 quantize 라
# +- 32767*voxel_size m 까지 (voxel=0.10 m → ~3.2 km 범위).
_voxel_cache: dict = {}  # (ix, iy, iz) → (r, g, b)
_voxel_lock = threading.Lock()
_voxel_event = threading.Event()
_voxel_seq = 0
_voxel_delta: dict = {'added': [], 'removed': [], 'updated_at': 0.0}
# 동작 파라미터 — POST /api/system/scene/config 로 라이브 변경.
# - enabled: False 면 sub 자체 disconnect (트래픽 0)
# - voxel_size: downsample 격자 (m). 클수록 가볍지만 거침
# - max_distance: 로봇 현재 위치에서 N m 내 voxel 만 (외곽 burst 차단). None=무제한
# - max_voxels_per_frame: 한 WS frame 최대 voxel 수 (초과 시 split)
# - publish_rate_cap_hz: adapter → WS 최대 발행 빈도
_voxel_config: dict = {
    'enabled': True,
    'voxel_size': 0.10,
    'max_distance': 15.0,
    'max_voxels_per_frame': 50_000,
    'publish_rate_cap_hz': 2.0,
}
# nvblox 3D mesh — /nvblox_node/scene (foxglove_msgs/SceneUpdate) 누적.
# entity_id (block id) → {vertices: bytes(float32×3×N), indices: bytes(uint32×M),
#                          color: (r,g,b) uint8 0..255}.
# nvblox 는 변경된 block 만 incremental delta 로 보냄 → cache 에 누적 + frontend 에
# 새 block 만 push (또는 신규 ws 연결 시 전체 sync).
_mesh_cache: dict[str, dict] = {}
_mesh_lock = threading.Lock()
_mesh_event = threading.Event()
_mesh_seq = 0  # 매 update 마다 증가 — frontend 가 누락 detection 용.
# 가장 최근 update 의 _delta_: 신규/갱신 entity ids + 삭제된 ids.
# new ws connection 은 cache 전체를 _초기 sync_ 로 받고, 그 후엔 delta 만 받음.
_mesh_delta: dict = {'updated_ids': [], 'deleted_ids': [], 'updated_at': 0.0}
# semantic OCR: 확정/후보 표지판 트랙 (map 프레임). MapCanvas 가 spot 으로 표시.
# tracks: list of {id, room_id, x, y, confirmed, confidence, observations}
_ocr_cache: dict = {'tracks': [], 'updated_at': 0.0}

# OCR spot 영속화: floor 별 batch upsert 로 Spring 에 push.
# - _ocr_floor_id: 현재 활성 floor (set_ocr_floor 가 갱신). None 이면 영속화 X.
# - _ocr_post_buffer: track_id → latest entry. 누적 후 worker 가 5초마다 flush.
# - 별도 worker thread (ROS callback 안 막음) 가 sync HTTP POST.
_ocr_floor_id: 'Optional[int]' = None
_ocr_post_buffer: dict = {}
_ocr_post_lock = threading.Lock()
OCR_POST_INTERVAL = 5.0

# RTAB-Map BoW loop closure 신호 — relocalize 의 진짜 성공 판정에 사용.
# /rtabmap/info 의 loop_closure_id 가 0 → non-zero 전이 시점에 매칭 발생.
# proximity_detection_id 도 같이 본다 (같은 location 재방문 검출).
_rtabmap_loop_event = threading.Event()
_rtabmap_last_match: dict = {'loop_id': 0, 'proximity_id': 0, 'updated_at': 0.0}
_ros_node_thread: Optional[threading.Thread] = None

# 매핑 DB write 리다이렉션 상태 — 첫 slam_save 성공 시점에 RTAB-Map 의
# database_path 를 ~/.ros/rtabmap.db → /var/indoory/maps/{id}.db 로 전환해
# 그 이후 모든 incremental write 가 직접 maps/{id}.db 로 누적되도록 함.
# autosave loop / 파일 복사 일체 불필요 — RTAB-Map 자체가 source of truth 위치에 씀.
_redirect_state: dict = {
    'map_id': None,
    'map_name': None,
    'db_path': None,           # 현재 RTAB-Map 이 쓰는 절대 경로
    'redirected_at': 0.0,
    'last_status': '',
}
_redirect_lock = threading.Lock()
# 새 메시지 도착 시 set, WS 구독자가 await.
_map_event = threading.Event()
_pose_event = threading.Event()
_camera_event = threading.Event()
_camera_wrist_l_event = threading.Event()
_camera_wrist_r_event = threading.Event()
_depth_event = threading.Event()
_path_event = threading.Event()
_trajectory_event = threading.Event()
_frontier_event = threading.Event()
_cloud_event = threading.Event()
_ocr_event = threading.Event()
# 텔레옵: /cmd_vel publisher + Nav2 /goal_pose publisher. _start_ros_subscriber 에서 init.
_cmd_vel_pub = None
_goal_pose_pub = None
# 단순 회전 (reloc UX 명목) 진행 중 플래그. cancel_event 에서 끄면 즉시 종료.
_spin_active = False


def _depth_image_to_jpeg(msg) -> Optional[bytes]:
    """Convert a ROS depth Image into a compact browser-friendly JPEG."""
    try:
        import numpy as np
        from PIL import Image
    except Exception as exc:
        log.warning('depth jpeg disabled — numpy/Pillow import failed: %s', exc)
        return None

    enc = (getattr(msg, 'encoding', '') or '').lower()
    width = int(getattr(msg, 'width', 0))
    height = int(getattr(msg, 'height', 0))
    if width <= 0 or height <= 0:
        return None

    if '32fc1' in enc:
        dtype = np.dtype('>f4' if getattr(msg, 'is_bigendian', 0) else '<f4')
        arr = np.frombuffer(bytes(msg.data), dtype=dtype)
        row = max(1, int(msg.step) // dtype.itemsize)
        meters = arr.reshape(height, row)[:, :width].astype(np.float32, copy=False)
    elif '16uc1' in enc or 'mono16' in enc or enc in ('16u', 'uint16'):
        dtype = np.dtype('>u2' if getattr(msg, 'is_bigendian', 0) else '<u2')
        arr = np.frombuffer(bytes(msg.data), dtype=dtype)
        row = max(1, int(msg.step) // dtype.itemsize)
        meters = arr.reshape(height, row)[:, :width].astype(np.float32) * 0.001
    else:
        return None

    valid = np.isfinite(meters) & (meters > 0.05)
    norm = np.zeros((height, width), dtype=np.uint8)
    if valid.any():
        values = meters[valid]
        lo = float(values.min())
        hi = float(np.percentile(values, 99))
        if hi - lo < 0.05:
            hi = lo + 0.05
        norm[valid] = np.clip((meters[valid] - lo) * (255.0 / (hi - lo)), 0, 255).astype(np.uint8)

    # Lightweight false-color map without an OpenCV dependency in the adapter venv.
    rgb = np.zeros((height, width, 3), dtype=np.uint8)
    rgb[..., 0] = norm
    rgb[..., 1] = np.clip(255 - np.abs(norm.astype(np.int16) - 128) * 2, 0, 255).astype(np.uint8)
    rgb[..., 2] = 255 - norm
    rgb[~valid] = 0
    image = Image.fromarray(rgb, 'RGB')
    buf = io.BytesIO()
    image.save(buf, format='JPEG', quality=80)
    return buf.getvalue()


def _start_ros_subscriber() -> None:
    """별도 스레드에서 rclpy spin. /odom 구독해 latest 캐시."""
    global _pose_cache
    global _cmd_vel_pub, _goal_pose_pub
    try:
        import rclpy
        from rclpy.node import Node
        from rclpy.executors import MultiThreadedExecutor
        from rclpy.callback_groups import MutuallyExclusiveCallbackGroup
        from nav_msgs.msg import Odometry, OccupancyGrid, Path
        from geometry_msgs.msg import Twist, PoseStamped
        from sensor_msgs.msg import CompressedImage, Image, PointCloud2, CameraInfo
        from rosgraph_msgs.msg import Clock
        from visualization_msgs.msg import MarkerArray
        from std_msgs.msg import String as StdString
        from tf2_ros import Buffer, TransformListener
        import message_filters
    except Exception as e:
        log.warning('rclpy import failed — cache disabled: %s', e)
        return

    try:
        rclpy.init(args=None)
    except RuntimeError:
        pass  # 이미 init 됨 (uvicorn --reload 가 모듈 다시 import 한 경우 등)
    node = Node('indoory_adapter_telemetry')
    tf_buffer = Buffer()
    TransformListener(tf_buffer, node)

    # ── Per-topic CallbackGroup ────────────────────────────────────────────
    # SingleThreadedExecutor 의 본질적 한계: 모든 callback 이 한 큐에서 FIFO 처리
    # → 한 callback 의 처리 시간이 다른 모든 토픽의 latency 에 직접 더해짐.
    # 무거운 callback (mesh, depth, pointcloud) 이 실시간 토픽 (/odom, /clock,
    # /tf, cmd_vel sub) 을 starve 시키는 문제 반복.
    #
    # 해결: MultiThreadedExecutor + MutuallyExclusiveCallbackGroup 토픽별 분리.
    # 같은 그룹 안 callback 끼리만 직렬 (FIFO 순서 보장). 다른 그룹과는 병렬 실행.
    # Executor 의 thread pool 이 그룹 갯수만큼 동시에 callback 처리.
    cg_fast    = MutuallyExclusiveCallbackGroup()  # /odom, /clock, /tf — 50Hz 급
    cg_map     = MutuallyExclusiveCallbackGroup()  # /map (latched, ~0.5Hz)
    cg_camera  = MutuallyExclusiveCallbackGroup()  # /camera/* (RGB) compressed
    cg_depth   = MutuallyExclusiveCallbackGroup()  # /d456/depth (jpeg encode 들어감)
    cg_cloud   = MutuallyExclusiveCallbackGroup()  # /nvblox_node/combined_esdf_pointcloud
    cg_scene   = MutuallyExclusiveCallbackGroup()  # /nvblox_node/scene (mesh, queue 만 함)
    cg_voxel   = MutuallyExclusiveCallbackGroup()  # /rtabmap/cloud_map (voxel diff fallback)
    cg_path    = MutuallyExclusiveCallbackGroup()  # /plan, /trajectory
    cg_marker  = MutuallyExclusiveCallbackGroup()  # /explore/frontiers, /semantic_ocr

    def odom_cb(msg: Odometry) -> None:
        global _pose_cache
        import math
        p = msg.pose.pose
        o = p.orientation
        frame = msg.header.frame_id
        # map frame 변환은 SLAM 의 map→odom transform 보정에 따라 robot pose 가
        # _제자리에서_ 빙빙 도는 것처럼 jitter — 사용자 보고 case 직격. 그래서 odom
        # frame 그대로 사용 (sim wheel odom 은 거의 noise 없음). map frame trajectory
        # 표시는 trajectory_path_node 가 별도 /trajectory topic 으로 발행하므로 거기서.
        x = p.position.x
        y = p.position.y
        z = p.position.z
        yaw = math.atan2(2 * (o.w * o.z + o.x * o.y),
                         1 - 2 * (o.y * o.y + o.z * o.z))
        _pose_cache = {
            'available': True,
            'x': x,
            'y': y,
            'z': z,
            'yaw_rad': yaw,
            'yaw_deg': math.degrees(yaw),
            'frame': frame,
            'source_frame': msg.header.frame_id,
            'updated_at': _time.time(),
        }
        _pose_event.set()
        _track_msg('/odom')

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
        _track_msg('/map')

    from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
    qos_odom = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=10,
                          reliability=ReliabilityPolicy.RELIABLE)
    qos_map = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.RELIABLE,
                         durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(Odometry, '/odom', odom_cb, qos_odom,
                             callback_group=cg_fast)
    # slam_toolbox 는 /map 직접 발행 (transient_local). RTAB-Map 도 launch 의 ('map','/map')
    # remap 으로 같은 토픽에 publish — 한 곳에서 양쪽 백엔드 커버.
    node.create_subscription(OccupancyGrid, '/map', map_cb, qos_map,
                             callback_group=cg_map)

    # 카메라 jpeg 캐시 — /camera/image_raw/compressed 도착 시 bytes 만 저장.
    def cam_cb(msg) -> None:
        _camera_cache['data'] = bytes(msg.data)
        _camera_event.set()
        _track_msg('/camera/image_raw/compressed')
    def wrist_l_cb(msg) -> None:
        _camera_wrist_l_cache['data'] = bytes(msg.data)
        _camera_wrist_l_event.set()
        _track_msg('/camera/wrist_left/image_raw/compressed')
    def wrist_r_cb(msg) -> None:
        _camera_wrist_r_cache['data'] = bytes(msg.data)
        _camera_wrist_r_event.set()
        _track_msg('/camera/wrist_right/image_raw/compressed')
    qos_cam = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(CompressedImage, '/camera/image_raw/compressed', cam_cb, qos_cam,
                             callback_group=cg_camera)
    node.create_subscription(CompressedImage, '/camera/wrist_left/image_raw/compressed', wrist_l_cb, qos_cam,
                             callback_group=cg_camera)
    node.create_subscription(CompressedImage, '/camera/wrist_right/image_raw/compressed', wrist_r_cb, qos_cam,
                             callback_group=cg_camera)

    # D456 depth stream — convert to JPEG color map for the browser panel.
    _last_depth_push = [0.0]
    def depth_cb(msg) -> None:
        # Hz 측정은 throttle 영향 없도록 항상 기록 (도착 시각).
        _track_msg('/d456/depth/image_raw')
        now = _time.time()
        if now - _last_depth_push[0] < 0.2:
            return
        jpg = _depth_image_to_jpeg(msg)
        if not jpg:
            return
        _depth_cache['data'] = jpg
        _depth_cache['updated_at'] = now
        _depth_cache['encoding'] = getattr(msg, 'encoding', '')
        _depth_event.set()
        _last_depth_push[0] = now
    node.create_subscription(Image, '/d456/depth/image_raw', depth_cb, qos_cam,
                             callback_group=cg_depth)
    node.create_subscription(Image, '/camera/depth/image_raw', depth_cb, qos_cam,
                             callback_group=cg_depth)

    # Nav2 /plan (현재 글로벌 경로) — 이벤트 진행 중 시각화용.
    def path_cb(msg) -> None:
        pts = [(ps.pose.position.x, ps.pose.position.y) for ps in msg.poses]
        _path_cache['points'] = pts
        _path_cache['updated_at'] = _time.time()
        _path_event.set()
        _track_msg('/plan')
    qos_path = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                          reliability=ReliabilityPolicy.RELIABLE)
    node.create_subscription(Path, '/plan', path_cb, qos_path,
                             callback_group=cg_path)

    # 실제 주행 궤적. trajectory_path_node 가 transient_local 로 publish 하므로
    # adapter 가 늦게 붙어도 최근 궤적을 즉시 받을 수 있게 durability 를 맞춘다.
    def trajectory_cb(msg) -> None:
        pts = [(ps.pose.position.x, ps.pose.position.y) for ps in msg.poses]
        _trajectory_cache['points'] = pts
        _trajectory_cache['updated_at'] = _time.time()
        _trajectory_event.set()
        _track_msg('/trajectory')
    qos_trajectory = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                                reliability=ReliabilityPolicy.RELIABLE,
                                durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(Path, '/trajectory', trajectory_cb, qos_trajectory,
                             callback_group=cg_path)

    # /clock — gazebo sim_time. 우하단 status bar 표시용.
    def clock_cb(msg) -> None:
        _clock_cache['sim_secs'] = msg.clock.sec + msg.clock.nanosec / 1e9
        _clock_cache['updated_at'] = _time.time()
        _track_msg('/clock')
    qos_clock = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                           reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(Clock, '/clock', clock_cb, qos_clock,
                             callback_group=cg_fast)

    # nvblox PointCloud2 → 3D scene 시각화. 메시지마다 (x,y,z) FLOAT32 만 추출해 binary
    # buffer 캐시 → /ws/cloud 가 그대로 push. 클라이언트는 Float32Array(buffer, 0, n*3).
    # rate 제한: 마지막 push 후 0.5s 안에는 새 메시지 무시 (~2Hz max).
    import struct
    _last_cloud_push = [0.0]
    def cloud_cb(msg) -> None:
        # Hz 측정은 throttle 영향 없도록 항상 기록.
        _track_msg('/nvblox_node/combined_esdf_pointcloud')
        now = _time.time()
        if now - _last_cloud_push[0] < 0.5:
            return  # throttle
        # offset for x, y, z
        ox, oy, oz = None, None, None
        for f in msg.fields:
            if f.name == 'x' and f.datatype == 7:  # FLOAT32
                ox = f.offset
            elif f.name == 'y' and f.datatype == 7:
                oy = f.offset
            elif f.name == 'z' and f.datatype == 7:
                oz = f.offset
        if ox is None or oy is None or oz is None:
            return
        step = msg.point_step
        n = len(msg.data) // step
        if n == 0:
            return
        # 큰 클라우드 down-sample (max 5000 points)
        stride = max(1, n // 5000)
        out = bytearray()
        data = bytes(msg.data)
        for i in range(0, n, stride):
            base = i * step
            out += data[base + ox: base + ox + 4]
            out += data[base + oy: base + oy + 4]
            out += data[base + oz: base + oz + 4]
        _cloud_cache['data'] = bytes(out)
        _cloud_cache['count'] = len(out) // 12
        _cloud_cache['updated_at'] = now
        _cloud_event.set()
        _last_cloud_push[0] = now
    qos_cloud = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                           reliability=ReliabilityPolicy.BEST_EFFORT)
    node.create_subscription(PointCloud2, '/nvblox_node/combined_esdf_pointcloud',
                             cloud_cb, qos_cloud,
                             callback_group=cg_cloud)

    # /rtabmap/cloud_map → voxelized RGB scene. nvblox 부재 시 3D 시각화 fallback.
    # RTAB-Map publish 패턴:
    #   - 평소: keyframe 추가 시 incremental 누적 (added 위주, removed ~0)
    #   - 루프 클로저 직후: 그래프 최적화로 keyframe pose 일제 보정 → 거의 전 voxel
    #     좌표 재투영 → 한 frame 의 added/removed 모두 폭증 (burst). 우리 voxel set
    #     diff 가 이 burst 를 자연스럽게 처리 (frame split + rate cap 으로 흡수).
    _last_voxel_push = [0.0]
    def voxel_cb(msg) -> None:
        global _voxel_seq
        _track_msg('/rtabmap/cloud_map')
        if not _voxel_config.get('enabled', True):
            return
        now = _time.time()
        rate_cap = float(_voxel_config.get('publish_rate_cap_hz') or 0.0)
        if rate_cap > 0 and now - _last_voxel_push[0] < 1.0 / rate_cap:
            return
        ox = oy = oz = orgb = None
        rgb_dtype = None  # 7=FLOAT32, 6=UINT32
        for f in msg.fields:
            if f.name == 'x' and f.datatype == 7:
                ox = f.offset
            elif f.name == 'y' and f.datatype == 7:
                oy = f.offset
            elif f.name == 'z' and f.datatype == 7:
                oz = f.offset
            elif f.name in ('rgb', 'rgba'):
                orgb = f.offset
                rgb_dtype = f.datatype
        if ox is None or oy is None or oz is None:
            return
        step = msg.point_step
        data = bytes(msg.data)
        n = len(data) // step
        if n == 0:
            return
        voxel_size = max(0.01, float(_voxel_config.get('voxel_size', 0.10)))
        inv = 1.0 / voxel_size
        max_d = _voxel_config.get('max_distance')
        # 로봇 현재 위치 (없으면 None — distance gate 비활성).
        center = None
        if max_d and _pose_cache.get('available'):
            center = (_pose_cache.get('x', 0.0), _pose_cache.get('y', 0.0))
        max_d_sq = (float(max_d) ** 2) if max_d else None
        # 새 voxel set 구축 (이번 메시지 기준 ground truth). _next_set 이 정의이고
        # _voxel_cache 가 이전 상태. diff 후 _voxel_cache 를 _next_set 으로 swap.
        import struct as _struct
        next_set: dict = {}
        # PointCloud2 의 rgb 필드는 RTAB-Map 이 보통 float32 (uint32 reinterpret) 로 패킹:
        # 4 bytes = [r, g, b, _] 또는 [b, g, r, _] (point_cloud2.read_points 의 일반 처리).
        # 우리는 byte 직접 읽어 r/g/b 추출. 색 없으면 회색 (128,128,128).
        for i in range(n):
            base = i * step
            x = _struct.unpack_from('<f', data, base + ox)[0]
            y = _struct.unpack_from('<f', data, base + oy)[0]
            z = _struct.unpack_from('<f', data, base + oz)[0]
            if max_d_sq is not None and center is not None:
                dx = x - center[0]; dy = y - center[1]
                if dx*dx + dy*dy > max_d_sq:
                    continue
            ix = int(round(x * inv))
            iy = int(round(y * inv))
            iz = int(round(z * inv))
            # int16 quantize 범위 (-32768..32767) — 절대좌표 ~3.2 km @ voxel=0.1m.
            if ix < -32768 or ix > 32767 or iy < -32768 or iy > 32767 or iz < -32768 or iz > 32767:
                continue
            key = (ix, iy, iz)
            if key in next_set:
                continue
            if orgb is not None:
                # 4 byte (b,g,r,a) — PCL 표준. RViz/RTAB-Map 모두 동일.
                b = data[base + orgb]
                g = data[base + orgb + 1]
                r = data[base + orgb + 2]
            else:
                r = g = b = 128
            next_set[key] = (r, g, b)
        with _voxel_lock:
            prev_keys = set(_voxel_cache.keys())
            next_keys = set(next_set.keys())
            added_keys = next_keys - prev_keys
            removed_keys = prev_keys - next_keys
            # 색 변경된 voxel 도 added 로 취급 (rare; 보통 안 일어남)
            for k in (next_keys & prev_keys):
                if _voxel_cache[k] != next_set[k]:
                    added_keys.add(k)
            _voxel_cache.clear()
            _voxel_cache.update(next_set)
            added_list = [(k[0], k[1], k[2], *next_set[k]) for k in added_keys]
            removed_list = [list(k) for k in removed_keys]
            _voxel_seq += 1
            _voxel_delta['added'] = added_list
            _voxel_delta['removed'] = removed_list
            _voxel_delta['updated_at'] = now
        _last_voxel_push[0] = now
        if added_list or removed_list:
            _voxel_event.set()
            log.debug('voxel diff: +%d / -%d (total=%d)',
                      len(added_list), len(removed_list), len(next_set))

    # cloud_map QoS: TRANSIENT_LOCAL latched + RELIABLE (RTAB-Map default).
    qos_voxel = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                           reliability=ReliabilityPolicy.RELIABLE,
                           durability=DurabilityPolicy.TRANSIENT_LOCAL)
    node.create_subscription(PointCloud2, '/rtabmap/cloud_map',
                             voxel_cb, qos_voxel,
                             callback_group=cg_voxel)

    # nvblox 3D mesh — /nvblox_node/scene (foxglove_msgs/SceneUpdate).
    # 각 SceneEntity 는 mesh block. TriangleListPrimitive 의 points/colors/indices
    # 를 binary 로 직렬화해 cache. nvblox accumulate_only=True 라 한 번 추가된 block
    # 은 stable; 신규/갱신된 block 만 옴 → cache 누적 + delta 추적.
    try:
        from foxglove_msgs.msg import SceneUpdate
    except ImportError:
        log.warning('foxglove_msgs not available — /ws/scene disabled')
        SceneUpdate = None  # type: ignore

    # Draco: 정점·인덱스·컬러를 양자화 + 엔트로피 인코딩 → 5~15배 압축.
    # frontend Three.js 의 DRACOLoader 가 동일 bitstream 디코딩.
    try:
        import DracoPy
        import numpy as _np
    except ImportError:
        DracoPy = None  # type: ignore
        _np = None  # type: ignore
        log.warning('DracoPy not available — falling back to raw float32 encode')

    if SceneUpdate is not None:
        # Worker thread 패턴: scene_cb 는 가벼운 enqueue 만, 무거운 numpy 빌드 +
        # DracoPy.encode 는 _mesh_encoder_worker 가 다른 스레드에서 처리.
        #
        # 이전 (in-callback 인코딩) 은 nvblox mesh 가 도착할 때마다 ~수천 entity 를
        # rclpy SingleThreadedExecutor 가 점유한 채로 인코딩 → 그 동안 camera/odom/
        # depth/cmd_vel sub callback 이 모두 starve. 사용자가 5초 lag 보고 (= mesh
        # publish 주기 = 1 callback 의 인코딩 지속 시간).
        #
        # queue maxsize=2 + drop policy: worker 가 못 따라가면 옛 mesh 는 drop.
        # mesh 는 누적 cache 라 가끔 frame 빠져도 시각적 손실 미미.
        import queue as _queue_mod
        _scene_work_queue: '_queue_mod.Queue' = _queue_mod.Queue(maxsize=2)

        def scene_cb(msg) -> None:
            # ROS msg 객체는 pure Python 이라 thread 간 안전. queue full 이면 drop.
            try:
                _scene_work_queue.put_nowait(msg)
            except _queue_mod.Full:
                # 워커가 밀리고 있음 — 가장 오래된 1개 빼고 새 msg 푸시 (latest-wins).
                try:
                    _scene_work_queue.get_nowait()
                except _queue_mod.Empty:
                    pass
                try:
                    _scene_work_queue.put_nowait(msg)
                except _queue_mod.Full:
                    pass

        def _process_scene_msg(msg) -> None:
            """원래 scene_cb 본문. 이제 worker thread 에서 호출됨."""
            global _mesh_seq
            updated_ids: list[str] = []
            deleted_ids: list[str] = []
            with _mesh_lock:
                for ent in msg.entities:
                    eid = str(ent.id)
                    if not ent.triangles:
                        continue
                    tri = ent.triangles[0]
                    n_v = len(tri.points)
                    n_c = len(tri.colors)
                    n_i = len(tri.indices)
                    if n_v == 0 or n_i == 0:
                        continue
                    if _np is not None:
                        verts_np = _np.empty((n_v, 3), dtype=_np.float32)
                        for i, p in enumerate(tri.points):
                            verts_np[i, 0] = p.x
                            verts_np[i, 1] = p.y
                            verts_np[i, 2] = p.z
                        faces_np = _np.asarray(tri.indices, dtype=_np.uint32).reshape(-1, 3)
                        colors_np: 'Optional[_np.ndarray]' = None
                        if n_c == n_v:
                            colors_np = _np.empty((n_v, 3), dtype=_np.uint8)
                            for i, c in enumerate(tri.colors):
                                colors_np[i, 0] = max(0, min(255, int(c.r * 255)))
                                colors_np[i, 1] = max(0, min(255, int(c.g * 255)))
                                colors_np[i, 2] = max(0, min(255, int(c.b * 255)))
                    if DracoPy is not None and _np is not None:
                        try:
                            encoded = DracoPy.encode(
                                verts_np, faces_np,
                                colors=colors_np,
                                quantization_bits=14,
                                compression_level=1,
                            )
                            _mesh_cache[eid] = {'draco': bytes(encoded)}
                            updated_ids.append(eid)
                            continue
                        except Exception as e:
                            log.warning('Draco encode failed for %s: %s', eid, e)
                    vbuf = verts_np.tobytes() if _np is not None else b''
                    cbuf = colors_np.tobytes() if (_np is not None and colors_np is not None) else b''
                    ibuf = faces_np.tobytes() if _np is not None else b''
                    _mesh_cache[eid] = {
                        'vertices': vbuf, 'colors': cbuf, 'indices': ibuf,
                    }
                    updated_ids.append(eid)
                for d in msg.deletions:
                    eid = str(d.id)
                    if d.type == 0:
                        if _mesh_cache.pop(eid, None) is not None:
                            deleted_ids.append(eid)
                    elif d.type == 1:
                        deleted_ids.extend(_mesh_cache.keys())
                        _mesh_cache.clear()
                _mesh_seq += 1
                _mesh_delta['updated_ids'] = updated_ids
                _mesh_delta['deleted_ids'] = deleted_ids
                _mesh_delta['updated_at'] = _time.time()
            if updated_ids or deleted_ids:
                _mesh_event.set()

        def _mesh_encoder_worker() -> None:
            """별도 스레드 — queue 에서 ROS msg 꺼내 Draco 인코딩 처리.
            ROS executor 스레드 free 유지 (camera/odom/cmd_vel 안 막힘)."""
            log.info('mesh_encoder_worker started')
            while True:
                try:
                    msg = _scene_work_queue.get()
                except Exception:
                    continue
                try:
                    t0 = _time.time()
                    _process_scene_msg(msg)
                    dt = _time.time() - t0
                    if dt > 1.0:
                        log.info('mesh encode took %.2fs (%d entities)',
                                 dt, len(msg.entities))
                except Exception as e:
                    log.warning('mesh encoder worker error: %s', e)

        _mesh_worker_thread = threading.Thread(
            target=_mesh_encoder_worker, daemon=True, name='mesh-encoder')
        _mesh_worker_thread.start()

        # OCR spot batch upsert worker — _ocr_post_buffer 를 OCR_POST_INTERVAL 마다
        # Spring 으로 flush. 별도 thread 라 ROS callback / FastAPI 둘 다 안 막음.
        # 같은 track_id 는 dict 갱신이라 자동 dedup → 운영상 N초 사이 latest 만 보냄.
        def _ocr_post_worker() -> None:
            log.info('ocr_post_worker started')
            while True:
                _time.sleep(OCR_POST_INTERVAL)
                fid = _ocr_floor_id
                if fid is None:
                    continue
                with _ocr_post_lock:
                    if not _ocr_post_buffer:
                        continue
                    spots = list(_ocr_post_buffer.values())
                    _ocr_post_buffer.clear()
                try:
                    requests.post(
                        f'{SPRING_BASE}/api/floors/{fid}/ocr-spots/batch',
                        json={'spots': spots}, timeout=5)
                except Exception as e:
                    log.warning('ocr spot batch post failed (%d spots): %s',
                                len(spots), e)
        threading.Thread(target=_ocr_post_worker, daemon=True, name='ocr-post').start()
        # SceneUpdate publisher (relay) 는 RELIABLE + TRANSIENT_LOCAL 로 발행하지만,
        # 25K+ block 큰 latched 메시지가 publisher 측 buffer overflow 로 publish block
        # 되는 현상 관찰 — ros2 graph 에서 publisher count=0 으로 보이고 매칭 0.
        # BEST_EFFORT + VOLATILE subscriber 로 두면 latched 못 받지만 ongoing 매칭은 됨.
        # Reliability Compatibility: BEST_EFFORT subscriber ↔ RELIABLE publisher OK.
        qos_scene = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                               reliability=ReliabilityPolicy.BEST_EFFORT,
                               durability=DurabilityPolicy.VOLATILE)
        node.create_subscription(SceneUpdate, '/nvblox_node/scene', scene_cb, qos_scene,
                                 callback_group=cg_scene)

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
        _track_msg('/explore/frontiers')
    qos_marker = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                            reliability=ReliabilityPolicy.RELIABLE)
    # explore_lite 의 토픽 이름은 보통 /explore/frontiers (publisher)
    node.create_subscription(MarkerArray, '/explore/frontiers', frontier_cb, qos_marker,
                             callback_group=cg_marker)

    # semantic OCR detections — JSON in std_msgs/String. tracks[].world_xyz 만 추출
    # 해서 MapCanvas spot 표시. annotation_status (candidate / confirmed) 색 분기용.
    def ocr_cb(msg) -> None:
        try:
            payload = json.loads(msg.data)
        except Exception:
            return
        tracks_out: list[dict] = []
        # 진단 위해 frame_id 까지 cache (web에서 'map' 인지 fallback인지 식별).
        frames_seen: set = set()
        for ann in payload.get('annotations', []) or []:
            xyz = ann.get('world_xyz')
            if not xyz or len(xyz) < 2:
                continue
            # semantic_ocr_node._track_to_dict 가 'frame_id' 키로 publish함
            # ('world_frame_id' 아님 — adapter 진단용 잘못된 키 fix).
            wfid = ann.get('frame_id') or ''
            frames_seen.add(wfid)
            tracks_out.append({
                'id': ann.get('id'),
                'room_id': ann.get('selected_room_id'),
                'x': float(xyz[0]),
                'y': float(xyz[1]),
                'world_frame': wfid,  # 'map' / 'odom' / 'camera_optical_frame' 등
                'confirmed': ann.get('annotation_status') == 'confirmed',
                'confidence': float(ann.get('selected_confidence') or 0.0),
                'observations': int(ann.get('observations') or 1),
            })
        _ocr_cache['tracks'] = tracks_out
        _ocr_cache['frames'] = sorted(frames_seen)
        _ocr_cache['updated_at'] = _time.time()
        _ocr_event.set()
        _track_msg('/semantic_ocr/detections')
        # 영속화 buffer 누적 — floor 가 set 됐을 때만. worker thread 가 주기적 flush.
        if _ocr_floor_id is not None and tracks_out:
            with _ocr_post_lock:
                for t in tracks_out:
                    tid = t.get('id')
                    if tid is None:
                        continue
                    _ocr_post_buffer[str(tid)] = {
                        'trackId': str(tid),
                        'roomId': t.get('room_id'),
                        'x': float(t['x']),
                        'y': float(t['y']),
                        'confidence': float(t.get('confidence') or 0.0),
                        'observations': int(t.get('observations') or 1),
                        'confirmed': bool(t.get('confirmed')),
                    }
    qos_ocr = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                         reliability=ReliabilityPolicy.RELIABLE)
    node.create_subscription(StdString, '/semantic_ocr/detections', ocr_cb, qos_ocr,
                             callback_group=cg_marker)

    # RTAB-Map info — loop closure / proximity detection 신호. relocalize 가
    # 단순 회전이 아니라 "BoW 매칭 발생까지 회전, 매칭 시점에 즉시 stop" 으로 동작
    # 하기 위해 필요. /rtabmap/info 는 keyframe 도착마다 publish (~1Hz).
    try:
        from rtabmap_msgs.msg import Info as RtabmapInfo
        def rtabmap_info_cb(msg) -> None:
            lid = int(getattr(msg, 'loop_closure_id', 0) or 0)
            pid = int(getattr(msg, 'proximity_detection_id', 0) or 0)
            if lid != 0 or pid != 0:
                _rtabmap_last_match['loop_id'] = lid
                _rtabmap_last_match['proximity_id'] = pid
                _rtabmap_last_match['updated_at'] = _time.time()
                _rtabmap_loop_event.set()
            _track_msg('/rtabmap/info')
        qos_info = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                              reliability=ReliabilityPolicy.RELIABLE)
        node.create_subscription(RtabmapInfo, '/rtabmap/info', rtabmap_info_cb, qos_info,
                                 callback_group=cg_marker)
        log.info('subscribed /rtabmap/info for loop closure detection')
    except ImportError:
        log.info('rtabmap_msgs not available — /slam/relocalize will fall back to spin-only')
    except Exception as e:
        log.warning('rtabmap info subscribe failed: %s', e)

    # 텔레옵: /cmd_vel_teleop 로 publish. twist_mux 가 그것을 priority 100 으로
    # 받아 Nav2 의 /cmd_vel (priority 10) 보다 항상 우세 적용 → /cmd_vel_mux →
    # isaac_bridge. SLAM 못 잡혀 Nav2 가 cmd_vel=0 도배해도 사용자 teleop 통과.
    _cmd_vel_pub = node.create_publisher(Twist, '/cmd_vel_teleop', 10)
    # Nav2 /goal_pose publisher — subprocess(ros2 topic pub) 우회. 즉시 publish.
    qos_goal = QoSProfile(history=HistoryPolicy.KEEP_LAST, depth=1,
                          reliability=ReliabilityPolicy.RELIABLE)
    _goal_pose_pub = node.create_publisher(PoseStamped, '/goal_pose', qos_goal)
    # SO-ARM101 leader 양 팔 14 joint position publisher. isaac_bridge 가 구독해
    # frame.arm_joint_pos_target 에 채움. raw ticks (0..4095). 50Hz.
    from std_msgs.msg import Float64MultiArray
    global _leader_arm_pub
    _leader_arm_pub = node.create_publisher(Float64MultiArray, '/leader_arm_joint_target', 10)
    log.info('rclpy subs ready + cmd_vel/goal_pose/leader_arm publishers')

    # Executor: 각 callback_group 이 자기 thread 점유 가능하도록 thread pool 충분히.
    # 그룹 8개 (fast/map/camera/depth/cloud/scene/path/marker) + tf TransformListener 의
    # 자체 timer = 9 정도. 여유로 12 thread 할당. 그룹 갯수 < threads → 그룹 늦은
    # callback 이 thread 못 잡아 starve 되는 일 없음.
    executor = MultiThreadedExecutor(num_threads=12)
    executor.add_node(node)
    try:
        executor.spin()
    except Exception as e:
        log.warning('rclpy spin ended: %s', e)
    finally:
        executor.shutdown()
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
    # ROS 재시작 신호 — 모든 robot 의 mapId/floorId NULL 화. 사용자 시나리오:
    #   1) 5층 탐색 → 2) ROS 종료/재부팅 → 3) 로봇은 위치 모름 → 4) 운영자에게 묻기
    #   → 5) 운영자 "5층" 답 → 6) backend 가 5F row hit → blob load → SLAM 계속
    # adapter restart 자체를 ROS 재시작으로 간주 — 단순 adapter crash recovery 도
    # 보딩 재확인이 보수적으로 안전.
    try:
        r = requests.post(f'{SPRING_BASE}/api/robots/session/reset-all', timeout=3)
        if r.ok:
            log.info('startup: backend session reset (%s)', r.text[:120])
        else:
            log.warning('startup session reset HTTP %d', r.status_code)
    except Exception as e:
        log.warning('startup session reset failed: %s', e)


def _ros_service_call(srv_name: str, srv_type: str, args: str = '{}', timeout_s: int = 8) -> tuple[bool, str]:
    """`ros2 service call` subprocess wrapper. ROS env sourced.
    Default timeout 8 초 — 서비스 존재 시엔 이내에 응답이 옴. 부재 시 hang 방지."""
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f"ros2 service call {srv_name} {srv_type} '{args}'"
    )
    try:
        proc = subprocess.run(
            ['bash', '-c', cmd], capture_output=True, text=True, timeout=timeout_s)
        return proc.returncode == 0, (proc.stdout or '') + (proc.stderr or '')
    except subprocess.TimeoutExpired:
        return False, f'timeout calling {srv_name}'


def _isaac_rpc(op: str, timeout_ms: int = 1500, **kwargs) -> dict:
    """Isaac sim_server REQ-REP RPC (xlerobot_v1 spec). 짧은 timeout 으로 sim 죽음
    감지 가능. 본 어댑터의 ZMQ context 는 새로 만들고 호출 후 닫음 — 빈도 낮음."""
    import zmq, msgpack
    ctx = zmq.Context()
    sock = ctx.socket(zmq.REQ)
    sock.setsockopt(zmq.RCVTIMEO, timeout_ms)
    sock.setsockopt(zmq.SNDTIMEO, timeout_ms)
    sock.setsockopt(zmq.LINGER, 0)
    try:
        sock.connect(f'tcp://{ISAAC_HOST}:{ISAAC_REP_PORT}')
        req = {'schema': 'xlerobot_v1', 'op': op, **kwargs}
        sock.send(msgpack.packb(req, use_bin_type=True))
        raw = sock.recv()
        resp = msgpack.unpackb(raw, raw=False)
        if not isinstance(resp, dict):
            return {'ok': False, 'error': f'malformed response: {type(resp).__name__}'}
        return resp
    except zmq.Again:
        return {'ok': False, 'error': f'timeout after {timeout_ms}ms (sim_server unreachable?)'}
    except Exception as exc:
        return {'ok': False, 'error': f'{type(exc).__name__}: {exc}'}
    finally:
        try: sock.close()
        except Exception: pass
        try: ctx.term()
        except Exception: pass


def _ros_param_set(node: str, name: str, value: str, timeout_s: int = 4) -> tuple[bool, str]:
    """`ros2 param set <node> <name> <value>` subprocess wrapper. value is
    passed as YAML scalar; quote so empty / multi-word strings round-trip.
    Default timeout 4 초."""
    yaml_value = json.dumps(value)  # produces a YAML-compatible quoted string
    cmd = (
        f'source {ROS_SETUP} && source {WS_SETUP} && '
        f"ros2 param set {node} {name} {yaml_value}"
    )
    try:
        proc = subprocess.run(
            ['bash', '-c', cmd], capture_output=True, text=True, timeout=timeout_s)
        return proc.returncode == 0, (proc.stdout or '') + (proc.stderr or '')
    except subprocess.TimeoutExpired:
        return False, f'timeout setting {node} {name}'


# ── SLAM 노드 라이프사이클 (subprocess) ─────────────────────────────────
# 부팅 시엔 slam_toolbox 안 띄우고 (use_slam_toolbox:=false), 웹 명령으로 spawn.
# slam_toolbox 는 lifecycle 노드라 직접 ros2 run 으로 띄우면 unconfigured 상태로 남으므로
# launch 에 들어있는 동일한 lifecycle 시퀀스 (configure → activate) 를 재사용하기 위해
# launch_slam_node.launch.py 같은 별도 launch 가 필요. 간단히 async_slam_toolbox_node 를
# 직접 띄우고 lifecycle CLI 로 configure/activate.
SLAM_PARAMS = str(GZ_NAV_SIM_ROOT / 'install/gz_nav_sim/share/gz_nav_sim/config/slam_params.yaml')
_slam_proc: Optional[subprocess.Popen] = None


def _slam_node_alive() -> bool:
    """SLAM backend 가 살아있는지. slam_toolbox 또는 rtabmap 둘 중 하나라도 OK.
    /proc/*/cmdline 직접 스캔 (pgrep 셀프매치 방지)."""
    import glob
    needles = (
        '/slam_toolbox/async_slam_toolbox_node',
        # rtabmap_slam/rtabmap binary — launch 가 'rtabmap' 이름으로 띄움.
        # 보통 /opt/ros/humble/lib/rtabmap_slam/rtabmap.
        'rtabmap_slam/rtabmap',
        'rtabmap_ros/rtabmap',
    )
    for pidfile in glob.glob('/proc/[0-9]*/cmdline'):
        try:
            with open(pidfile, 'rb') as f:
                cmd = f.read().replace(b'\x00', b' ').decode('utf-8', 'ignore')
            if any(n in cmd for n in needles):
                return True
        except Exception:
            continue
    return False


_NODE_ALIVE_CMDLINE_HINT = {
    # Humble 에선 binary 가 rtabmap_slam/rtabmap. 이전 foxy/galactic 의
    # rtabmap_ros/rtabmap 도 fallback 대비 함께 검사 (substring → 둘 중 하나 match).
    '/rtabmap': 'rtabmap_slam/rtabmap',
    '/semantic_ocr_node': 'semantic_ocr_node.py',
    '/semantic_vlm_node': 'semantic_vlm_node.py',
}


def _ros_node_alive(node_name: str) -> bool:
    """ROS2 node 실행 중 체크. ros2 node list 는 daemon cold 시 수 초 걸릴 수 있어
    /proc/*/cmdline 직접 스캔. 알려진 노드는 _NODE_ALIVE_CMDLINE_HINT 의 cmdline
    조각으로 매칭. 모르는 노드는 ros2 node list 폴백."""
    target = node_name if node_name.startswith('/') else f'/{node_name}'
    hint = _NODE_ALIVE_CMDLINE_HINT.get(target)
    if hint:
        import glob
        for pidfile in glob.glob('/proc/[0-9]*/cmdline'):
            try:
                with open(pidfile, 'rb') as f:
                    cmd = f.read().replace(b'\x00', b' ').decode('utf-8', 'ignore')
                if hint in cmd:
                    return True
            except Exception:
                continue
        return False
    # Unknown node: fall back to ros2 node list.
    cmd = f'source {ROS_SETUP} && source {WS_SETUP} && ros2 node list 2>/dev/null'
    try:
        proc = subprocess.run(
            ['bash', '-c', cmd], capture_output=True, text=True, timeout=2)
        if proc.returncode != 0:
            return False
        return any(line.strip() == target for line in proc.stdout.splitlines())
    except subprocess.TimeoutExpired:
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
    # start_new_session=True → 새 pgid → killpg 가 adapter 안 건드리고 자식 그룹만 종료.
    _slam_proc = subprocess.Popen(['bash', '-c', cmd], start_new_session=True)
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
    """SLAM 완전 종료: explore_lite + slam_toolbox 둘 다 SIGKILL.
    rtabmap 도 살아있으면 같이. sim 자체 (isaac_bridge / nav2 / 카메라) 는 보존 —
    유저가 다시 slam/start 누르면 새 매핑 세션 시작.

    이전 동작 (stop = explore 만 종료, slam_toolbox 유지) 은 사용자 직관과 안 맞아
    제거. slam_toolbox 안 죽으면 누적 매핑이 계속 일어나고, 사용자는 '종료가 안 됐다'
    고 느낌."""
    import os, signal
    global _explore_proc, _slam_proc
    killed = []
    my_pgid = os.getpgid(0)

    def _kill_handle(proc, label):
        if not proc or proc.poll() is not None:
            return
        try:
            pgid = os.getpgid(proc.pid)
            if pgid == my_pgid:
                proc.kill()
                killed.append(f'{label}(pid={proc.pid}, same-pgid-skipped)')
            else:
                os.killpg(pgid, signal.SIGKILL)
                killed.append(f'{label}(pgid={pgid})')
        except Exception as e:
            try: proc.kill()
            except Exception: pass
            killed.append(f'{label}(err:{e})')

    _kill_handle(_explore_proc, 'explore')
    _kill_handle(_slam_proc, 'slam')
    _explore_proc = None
    _slam_proc = None

    # 이름 기반 즉시 SIGKILL — adapter 가 띄우지 않은 (launch 가 띄운) 인스턴스 포함.
    patterns = (
        'explore_lite/explore', 'explore_node', 'ros2 launch explore_lite',
        'slam_toolbox/async_slam_toolbox_node',
        'slam_toolbox/sync_slam_toolbox_node',
        'rtabmap_slam/rtabmap',
    )
    for pat in patterns:
        try:
            r = subprocess.run(['pkill', '-9', '-f', pat], capture_output=True)
            if r.returncode == 0:
                killed.append(f'pkill:{pat}')
        except Exception:
            pass
    return {'ok': True, 'killed': killed}


# ── DB 저장: rtabmap working DB → maps/{id}.db one-time copy + 이후 직접 write ──
#
# 이전 모델: rtabmap 이 ~/.ros/rtabmap.db 에 누적, slam_save 시 maps/{id}.db 로
# 통째 파일 복사. 393MB DB 면 매 save 마다 디스크 I/O 폭주 + UI 가 마지막 save
# 시점 snapshot 에 멈춤.
#
# 새 모델: 첫 slam_save 호출 시 (1) Spring 으로 현 DB blob 푸시해서 maps/{id}.db
# 자리잡기 (2) RTAB-Map 의 database_path 를 maps/{id}.db 로 load_database 서비스
# 통해 redirect → 이후 모든 incremental write 가 직접 maps/{id}.db 로 누적.
# 같은 mapId 로 재호출되면 redirect 이미 됐으므로 metadata refresh 만.

def _push_rtabmap_db_to_spring(map_id: int, map_name: str, *, timeout: float = 120) -> dict:
    """현재 라이브 DB blob 을 Spring 의 /api/maps/{id}/rtabmap-db 로 multipart 푸시.

    ros_adapter 가 추적하는 _redirect_state.db_path (없으면 RTABMAP_DB 기본) 의
    파일을 읽어 보낸다. Spring 은 받아서 maps/{id}.db 로 디스크에 write.
    """
    with _redirect_lock:
        src = Path(_redirect_state.get('db_path') or RTABMAP_DB)
    if not src.exists():
        return {'ok': False, 'status': 0, 'text': f'DB not found at {src}'}
    url = f'{SPRING_BASE}/api/maps/{map_id}/rtabmap-db'
    size_mb = round(src.stat().st_size / 1e6, 2)
    try:
        with src.open('rb') as f:
            files = {'file': (f'{map_name}.db', f, 'application/octet-stream')}
            r = requests.post(url, files=files, timeout=timeout)
        return {
            'ok': r.ok,
            'status': r.status_code,
            'db_size_mb': size_mb,
            'text': (r.text or '')[:200],
        }
    except Exception as e:
        return {'ok': False, 'status': 0, 'db_size_mb': size_mb, 'text': str(e)[:200]}


def _redirect_rtabmap_to_map(map_id: int, map_name: str) -> dict:
    """RTAB-Map 의 active database_path 를 /var/indoory/maps/{map_id}.db 로 전환.

    전제: maps/{map_id}.db 파일이 디스크에 이미 존재 (Spring 의 saveRtabmapDb 가
    방금 만든 상태). load_database srv 의 clear: false 로 그 DB 를 reload —
    Working Memory 에 이전 누적 + 새 keyframe 부터는 이 파일에 incremental write.
    """
    target = MAP_STORAGE_DIR / f'{map_id}.db'
    if not target.exists():
        return {'ok': False, 'reason': f'target {target} does not exist (Spring save 실패?)'}
    if not _ros_node_alive('/rtabmap'):
        return {'ok': False, 'reason': '/rtabmap node not alive — redirect 보류'}
    args = f'{{database_path: "{target}", clear: false}}'
    ok, log_out = _ros_service_call(
        '/rtabmap/rtabmap/load_database', 'rtabmap_msgs/srv/LoadDatabase',
        args=args, timeout_s=30)
    if ok:
        # mapping 모드 보장 (load_database 가 모드 변경하지 않지만 idempotent 안전).
        _ros_service_call('/rtabmap/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
        with _redirect_lock:
            _redirect_state['map_id'] = int(map_id)
            _redirect_state['map_name'] = map_name
            _redirect_state['db_path'] = str(target)
            _redirect_state['redirected_at'] = _time.time()
            _redirect_state['last_status'] = 'redirected ok'
        log.info('slam/save: rtabmap database_path → %s (mapId=%d) — 이후 직접 누적',
                 target, map_id)
    else:
        with _redirect_lock:
            _redirect_state['last_status'] = f'redirect fail: {log_out[:150]}'
        log.warning('slam/save: load_database 실패 map_id=%d log=%s',
                    map_id, log_out[:200])
    return {'ok': ok, 'log': log_out[:300]}


@app.post('/api/robots/{robot_id}/slam/save')
async def slam_save(robot_id: str, request: Request):
    """첫 호출: 현재 working DB → Spring 푸시 + RTAB-Map 을 maps/{id}.db 로 redirect.
    같은 mapId 재호출: 이미 redirect 상태이므로 file copy 스킵, 메타만 refresh.
    """
    body = await request.body()
    log.info('slam/save body bytes=%d content-type=%s',
             len(body), request.headers.get('content-type'))
    try:
        payload = await request.json() if body else {}
    except Exception:
        payload = {}
    map_id = payload.get('mapId')
    map_name = payload.get('mapName') or 'map'

    if map_id is None:
        # mapId 없으면 그냥 현 DB 정보만 반환 (이전 동작 보존).
        with _redirect_lock:
            cur_path = _redirect_state.get('db_path') or str(RTABMAP_DB)
        cur_size = Path(cur_path).stat().st_size if Path(cur_path).exists() else 0
        return {
            'ok': False,
            'reason': 'mapId not provided',
            'db_path': cur_path,
            'db_size_mb': round(cur_size / 1e6, 2),
        }

    map_id = int(map_id)
    target = MAP_STORAGE_DIR / f'{map_id}.db'
    with _redirect_lock:
        already_redirected = (
            _redirect_state.get('map_id') == map_id
            and _redirect_state.get('db_path') == str(target)
        )

    if already_redirected:
        # RTAB-Map 이 이미 maps/{id}.db 에 직접 쓰고 있음 — copy 불필요.
        # 파일 복사로 외부에서 덮어쓰면 RTAB-Map 의 SQLite handle 깨짐 (절대 금지).
        size_mb = round(target.stat().st_size / 1e6, 2) if target.exists() else 0
        # Spring 측에 metadata 변경 trigger (size 갱신용). 실패해도 무해.
        try:
            requests.post(
                f'{SPRING_BASE}/api/maps/{map_id}/refresh-metadata', timeout=5)
        except Exception:
            pass
        with _redirect_lock:
            _redirect_state['last_status'] = 'already redirected — refresh only'
        return {
            'ok': True,
            'mode': 'direct-write (no copy)',
            'db_path': str(target),
            'db_size_mb': size_mb,
        }

    # 첫 save: 현재 working DB → Spring 푸시 → 디스크에 maps/{id}.db 자리잡힘.
    push_res = _push_rtabmap_db_to_spring(map_id, map_name)
    if not push_res.get('ok'):
        return {
            'ok': False,
            'status': push_res.get('status'),
            'log': push_res.get('text', '')[:200],
            'stage': 'push',
        }
    # Spring 이 maps/{id}.db 에 blob 을 write 했으니 이제 RTAB-Map 을 그쪽으로 redirect.
    redir_res = _redirect_rtabmap_to_map(map_id, map_name)
    return {
        'ok': redir_res.get('ok'),
        'status': push_res.get('status'),
        'mode': 'redirected (future writes direct)' if redir_res.get('ok')
                else 'push ok, redirect failed (will copy on next save)',
        'db_size_mb': push_res.get('db_size_mb'),
        'log': (redir_res.get('log') or '')[:200],
    }


@app.get('/api/slam/redirect/status')
def slam_redirect_status() -> dict:
    """디버깅 — 현재 RTAB-Map 이 어디에 쓰고 있는지."""
    with _redirect_lock:
        s = dict(_redirect_state)
    db_path = Path(s.get('db_path') or RTABMAP_DB)
    s['active_db_path'] = str(db_path)
    s['active_db_exists'] = db_path.exists()
    s['active_db_size_mb'] = (
        round(db_path.stat().st_size / 1e6, 2) if db_path.exists() else None)
    s['storage_dir'] = str(MAP_STORAGE_DIR)
    return s


# ── 층 전환: Spring 으로부터 blob 받아 디스크 stage + rtabmap reload ────
@app.post('/api/robots/{robot_id}/floor/set')
async def floor_set(robot_id: str, floorCode: str, file: UploadFile = File(...)):
    """multipart: floorCode (form field), file (rtabmap .db blob).

    저장 위치: FLOOR_DB_DIR/{floorCode}.db
    그리고 rtabmap 에 load_database 서비스 호출.
    """
    target = FLOOR_DB_DIR / f'{floorCode}.db'
    # await file.read() 는 전체 blob 을 메모리 로드 → 6GB+ .db 에서 adapter OOM.
    # 1MB chunk 단위 stream → adapter heap fixed footprint.
    CHUNK = 1024 * 1024
    with target.open('wb') as _f:
        while True:
            chunk = await file.read(CHUNK)
            if not chunk:
                break
            _f.write(chunk)

    # rtabmap 부재면 db 만 stage 하고 빠져나옴 — 나중에 rtabmap 띄우면 load 가능.
    if not _ros_node_alive('/rtabmap'):
        log.info('floor/set: /rtabmap absent, blob staged at %s — load deferred', target)
        return {
            'ok': True,
            'skipped_load': True,
            'staged_at': str(target),
            'size_mb': round(target.stat().st_size / 1e6, 2),
            'note': 'rtabmap not running — blob staged but not loaded',
        }
    # rtabmap_msgs/srv/LoadDatabase: { database_path: string, clear: bool }
    args = f'{{database_path: "{target}", clear: true}}'
    ok, log_out = _ros_service_call(
        '/rtabmap/rtabmap/load_database', 'rtabmap_msgs/srv/LoadDatabase', args=args)
    # Boot 시 launch 가 rtabmap_localization:=true 로 띄워 keyframe 추가 차단
    # (안전). 운영자가 floor 확정 = "이 층에서 매핑 진행 의사" → 이제 mapping 활성.
    # set_mode_mapping 은 idempotent 라 이미 mapping 모드여도 무해.
    # srv 경로: launch 의 namespace=/rtabmap + node name=rtabmap → /rtabmap/rtabmap/*.
    ok_mode, mode_log = _ros_service_call(
        '/rtabmap/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
    if ok:
        # _redirect_state.db_path 갱신 — slam_save 가 active DB 가 어느 파일인지
        # 알아야 함 (안 그러면 stale ~/.ros/rtabmap.db 를 push 함). map_id 는 모름
        # (floor_set 은 floorCode 키이지 mapId 가 아님), redirected 상태는 아님.
        with _redirect_lock:
            _redirect_state['db_path'] = str(target)
            _redirect_state['last_status'] = f'floor_set: rtabmap → {target.name}'
    return {
        'ok': ok,
        'staged_at': str(target),
        'size_mb': round(target.stat().st_size / 1e6, 2),
        'mode': 'mapping' if ok_mode else 'unknown',
        'log': log_out[:300],
        'mode_log': mode_log[:200] if mode_log else '',
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
    # rtabmap 부재 (slam_toolbox 백엔드) 면 service call 이 timeout 까지 hang 함 → fast skip.
    if not _ros_node_alive('/rtabmap'):
        log.info('floor/fresh: %s — /rtabmap absent (likely slam_toolbox backend), skipping reset', floor_code)
        return {
            'ok': True,
            'floorCode': floor_code,
            'mode': 'mapping_no_op',
            'note': 'rtabmap not running — slam_toolbox already in continuous mapping mode',
        }
    log.info('floor/fresh: %s — resetting rtabmap to start new map', floor_code)
    # srv 경로: launch 의 namespace=/rtabmap + node name=rtabmap → /rtabmap/rtabmap/*.
    ok1, _ = _ros_service_call('/rtabmap/rtabmap/reset', 'std_srvs/srv/Empty')
    ok2, _ = _ros_service_call(
        '/rtabmap/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
    return {
        'ok': ok1 or ok2,
        'floorCode': floor_code,
        'mode': 'mapping',
        'note': 'fresh start — explore via /slam/explore/start to fill map',
    }


# ── 임시 매핑 (층 모를 때) — 별도 .db 로 시작해 기존 .db 보호 ────────────
@app.post('/api/system/slam/start_temp')
def slam_start_temp():
    """층을 알리지 않은 채 매핑 시작. unknown_<timestamp>.db 로 별도 swap →
    기존 ~/.ros/rtabmap.db (이전 층 매핑) 는 그대로 보존됨. 사용자가 나중에
    "이건 5F 였어" 명시하면 그 임시 .db 를 5F 로 rename 할 수 있음 (future).
    """
    if not _ros_node_alive('/rtabmap'):
        raise HTTPException(status_code=503, detail='rtabmap not running — preset 의 use_rtabmap 확인')
    import time as _t
    ts = _t.strftime('%Y%m%d_%H%M%S')
    target = FLOOR_DB_DIR / f'unknown_{ts}.db'
    target.parent.mkdir(parents=True, exist_ok=True)
    # load_database 가 file 없으면 새로 생성. clear:true 로 working memory reset.
    args = f'{{database_path: "{target}", clear: true}}'
    ok1, log1 = _ros_service_call(
        '/rtabmap/rtabmap/load_database', 'rtabmap_msgs/srv/LoadDatabase', args=args)
    ok2, log2 = _ros_service_call(
        '/rtabmap/rtabmap/set_mode_mapping', 'std_srvs/srv/Empty')
    log.info('slam/start_temp: temp_db=%s ok_load=%s ok_mode=%s', target, ok1, ok2)
    return {
        'ok': ok1 and ok2,
        'mode': 'mapping',
        'temp_db_path': str(target),
        'note': '기존 ~/.ros/rtabmap.db 손상 0. 임시 .db 는 floor 명시 시 rename 가능 (TBD).',
    }


# ── Semantic OCR floor hint (per-session) ─────────────────────────────
# Web 세션이 시작될 때 (또는 사용자가 명시 변경할 때) 호출.
# floorCode='' 또는 키 누락 = "모름" → OCR 의 floor 필터 비활성 (default 동작).
# vite proxy 가 /api/system/* 만 adapter:8000 으로 보내므로 system prefix 필수.
@app.post('/api/system/semantic_ocr/floor')
async def set_ocr_floor(request: Request):
    """Body: {"floorCode": "4F" | "13F" | "B3F" | "", "mode": "reject" | "complete"}.

    OCR 노드의 floor_hint / floor_prior_mode 파라미터를 즉시 갱신.
    노드 안의 add_on_set_parameters_callback 이 hot-path 캐시도 같이 갱신.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    floor_code = str(body.get('floorCode') or '').strip()
    mode = str(body.get('mode') or 'reject').strip().lower()
    if mode not in ('reject', 'complete'):
        mode = 'reject'
    raw_floor_id = body.get('floorId')

    # 영속화 floor 갱신 — floorId 있을 때만 활성. 없으면 영속화 비활성 (legacy).
    global _ocr_floor_id
    new_floor_id = int(raw_floor_id) if isinstance(raw_floor_id, (int, str)) and str(raw_floor_id).strip() else None
    floor_changed = new_floor_id != _ocr_floor_id
    _ocr_floor_id = new_floor_id

    # floor 전환 시 buffer 초기화 — 옛 floor 의 미flush 데이터가 새 floor 로 들어가지 않게.
    if floor_changed:
        with _ocr_post_lock:
            _ocr_post_buffer.clear()

    # OCR 노드 미실행이면 ros2 param set 이 timeout 까지 기다리며 hang. fast skip.
    if not _ros_node_alive('/semantic_ocr_node'):
        log.info('semantic_ocr/floor: /semantic_ocr_node absent, skipping (floor=%s)', floor_code)
        return {
            'ok': True,
            'skipped': True,
            'note': 'semantic_ocr_node not running — hint will apply when node starts',
            'floorCode': floor_code,
            'mode': mode,
        }

    ok_hint, log_hint = _ros_param_set(
        '/semantic_ocr_node', 'floor_hint', floor_code)
    ok_mode, log_mode = _ros_param_set(
        '/semantic_ocr_node', 'floor_prior_mode', mode)

    # 세션/맵 전환 = OCR 트랙 무효. OCR 노드는 floor_hint 변경 callback 으로
    # self._tracks 클리어한 다음 frame 부터 빈 detections 발행. 어댑터 캐시도
    # 즉시 비우고 /ws/ocr 푸시해서 프런트가 OCR 노드 다음 publish 까지 기다리지
    # 않게 한다 (1Hz publish 라 최대 ~1초 지연 회피).
    _ocr_cache['tracks'] = []
    _ocr_cache['updated_at'] = _time.time()

    # 새 floor 의 영속화된 spot 들을 backend 에서 fetch 해서 cache seed.
    # 이러면 frontend 는 OCR 노드의 첫 publish 를 기다리지 않고도 옛 라벨을 즉시 봄.
    # ROS 끄기 전 누적된 confirmed track 들이 ROS 다시 켤 때 자동 복원됨.
    if new_floor_id is not None:
        try:
            r = requests.get(
                f'{SPRING_BASE}/api/floors/{new_floor_id}/ocr-spots', timeout=3)
            if r.ok:
                seeded: list[dict] = []
                for s in r.json() or []:
                    seeded.append({
                        'id': s.get('trackId'),
                        'room_id': s.get('roomId'),
                        'x': float(s.get('x') or 0.0),
                        'y': float(s.get('y') or 0.0),
                        'confirmed': bool(s.get('confirmed')),
                        'confidence': float(s.get('confidence') or 0.0),
                        'observations': int(s.get('observations') or 1),
                    })
                _ocr_cache['tracks'] = seeded
                _ocr_cache['updated_at'] = _time.time()
        except Exception as e:
            log.warning('ocr seed fetch failed: %s', e)
    _ocr_event.set()

    return {
        'ok': ok_hint and ok_mode,
        'floorCode': floor_code,
        'mode': mode,
        'tracks_cleared': True,
        'log': {
            'floor_hint': (log_hint or '')[:160],
            'floor_prior_mode': (log_mode or '')[:160],
        },
    }


# ── Isaac sim_server set_pose (시작 좌표로 텔레포트) ───────────────────
# xlerobot_v1 §4 RPC. 와이어 quat = xyzw. 디폴트는 origin (0,0,0.05) + identity.
@app.post('/api/system/sim/reset_pose')
async def sim_reset_pose(request: Request):
    """Body (선택): {robot_id?: int, pose?: [x,y,z, qx,qy,qz,qw]}.
    pose 생략 시 (0, 0, 0.05, 0, 0, 0, 1) — origin + identity quat.
    robot_id 생략 시 ISAAC_ROBOT_ID env 의 디폴트.

    이 호출은 RTAB-Map 의 odom→base_link integrator 와 무관하게 sim 측 robot
    위치만 텔레포트. 즉 지도와 어긋남 — 텔레포트 후 'reloc' 또는 fresh 매핑
    필요. UX 의도: 사용자가 디버깅 / 시작점 복귀용으로 누름.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    robot_id = int(body.get('robot_id') if body.get('robot_id') is not None else ISAAC_ROBOT_ID)
    pose = body.get('pose')
    if pose is None:
        pose = [0.0, 0.0, 0.05, 0.0, 0.0, 0.0, 1.0]
    if not (isinstance(pose, list) and len(pose) == 7):
        raise HTTPException(status_code=400, detail='pose must be 7-element list [x,y,z,qx,qy,qz,qw]')
    pose_floats = [float(v) for v in pose]
    resp = _isaac_rpc('set_pose', pose=pose_floats, robot_id=robot_id)
    return {**resp, 'robot_id': robot_id, 'pose': pose_floats}


# ── '내 위치 찾기': 회전 + RTAB-Map BoW loop closure 신호 모니터링 ─────
@app.post('/api/robots/{robot_id}/slam/relocalize')
def relocalize(robot_id: str):
    """로봇을 한 바퀴 회전하면서 /rtabmap/info 의 loop_closure_id / proximity_id
    가 0 → non-zero 로 전이하면 즉시 정지 + converged=true.
    매칭 못 잡고 한 바퀴 끝나면 converged=false ('회전 끝까지 매칭 X').
    /api/system/cancel_event 로 즉시 중단 가능.
    동기 호출 (~최대 11초). FastAPI threadpool 처리라 다른 요청 영향 X.
    """
    global _spin_active
    if _cmd_vel_pub is None:
        raise HTTPException(status_code=503, detail='cmd_vel publisher not initialized')
    if _spin_active:
        return {'converged': False, 'reason': 'already spinning'}

    # RTAB-Map 매칭 신호 reset — 회전 _이전_ 의 옛 매칭은 무시.
    _rtabmap_loop_event.clear()
    spin_started_at = _time.time()
    _rtabmap_last_match['updated_at'] = 0.0

    _spin_active = True
    from geometry_msgs.msg import Twist
    spin_msg = Twist()
    spin_msg.angular.z = 0.6  # rad/s — 한 바퀴 ≈ 2π / 0.6 ≈ 10.5초
    stop_msg = Twist()
    duration = 11.0
    rate_hz = 10
    n = int(duration * rate_hz)
    interrupted = False
    converged = False
    matched_loop_id = 0
    matched_proximity_id = 0
    elapsed_at_match = 0.0
    try:
        for _ in range(n):
            if not _spin_active:
                interrupted = True
                break
            # 회전 시작 _이후_ 발생한 매칭만 카운트 (event.is_set + updated_at 비교).
            if _rtabmap_loop_event.is_set() and \
                    _rtabmap_last_match['updated_at'] > spin_started_at:
                converged = True
                matched_loop_id = int(_rtabmap_last_match['loop_id'])
                matched_proximity_id = int(_rtabmap_last_match['proximity_id'])
                elapsed_at_match = _time.time() - spin_started_at
                break
            _cmd_vel_pub.publish(spin_msg)
            _time.sleep(1.0 / rate_hz)
    finally:
        _cmd_vel_pub.publish(stop_msg)
        _spin_active = False

    if converged:
        return {
            'converged': True,
            'loop_closure_id': matched_loop_id,
            'proximity_detection_id': matched_proximity_id,
            'elapsed_s': round(elapsed_at_match, 2),
            'reason': 'rtabmap loop closure matched',
        }
    return {
        'converged': False,
        'completed': not interrupted,
        'reason': 'spin canceled' if interrupted else 'no loop closure during full rotation',
    }


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
    _explore_proc = subprocess.Popen(['bash', '-c', cmd], start_new_session=True)
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
    # /proc/*/cmdline 직접 스캔 — pgrep 셀프매치 회피.
    import glob
    for pidfile in glob.glob('/proc/[0-9]*/cmdline'):
        try:
            with open(pidfile, 'rb') as f:
                cmd = f.read().replace(b'\x00', b' ').decode('utf-8', 'ignore')
            if 'lib/explore_lite/explore' in cmd:
                return True
        except Exception:
            continue
    return False


# ── 텔레옵 ───────────────────────────────────────────────────────────────
class TeleopRequest(BaseModel):
    linear: float = 0.0   # m/s, +전진 -후진 (robot frame x)
    angular: float = 0.0  # rad/s, +좌회전 -우회전 (robot frame z)
    lateral: float = 0.0  # m/s, holonomic 좌우 평행이동 (robot frame y, +왼쪽).
                          # diff-drive sim 에선 무시. xlerobot 등 omni base 만 사용.


def _publish_twist(linear: float, angular: float, lateral: float = 0.0) -> dict:
    if _cmd_vel_pub is None:
        raise HTTPException(status_code=503, detail='cmd_vel publisher not initialized')
    from geometry_msgs.msg import Twist
    msg = Twist()
    msg.linear.x = float(linear)
    msg.linear.y = float(lateral)
    msg.angular.z = float(angular)
    _cmd_vel_pub.publish(msg)
    return {'ok': True, 'linear': msg.linear.x, 'lateral': msg.linear.y, 'angular': msg.angular.z}


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
    # 0) 단순 회전 active flag → 즉시 종료
    global _spin_active
    if _spin_active:
        _spin_active = False
        killed.append('spin_loop_flag')
    # 1) spin (reloc) 프로세스 — 옛 spin_and_relocalize 가 살아있으면
    try:
        r = subprocess.run(['pkill', '-f', 'spin_and_relocalize'], capture_output=True)
        if r.returncode == 0: killed.append('spin_and_relocalize')
    except Exception: pass
    # 2) explore_lite + explore_node (launch wrapper 와 실제 node 모두)
    for pat in ('explore_lite', 'explore_node'):
        try:
            r = subprocess.run(['pkill', '-f', pat], capture_output=True)
            if r.returncode == 0: killed.append(f'pkill:{pat}')
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
    프론트가 hold 중에 ~10Hz 폴링하므로 round-trip 짧게 유지 (8080 우회).
    (deprecated: /ws/teleop 권장 — watchdog 으로 연결 끊김 시 자동 정지)"""
    return _publish_twist(req.linear, req.angular)


@app.websocket('/ws/teleop')
async def ws_teleop(ws: WebSocket):
    """텔레옥 WS — 프론트가 hold 중 {linear, angular, lateral} 메시지 송신.
    어댑터 watchdog: 마지막 메시지 후 300ms 안 오면 자동 (0,0,0) publish → 연결 끊김
    (브라우저 죽음/탭 닫힘/네트워크 글리치) 시 robot 무한이동 방지.

    프로토콜:
      client → {linear: float, angular: float, lateral: float}
      client → {linear: 0, angular: 0, lateral: 0}  ← release 시 명시적
      (서버는 응답 안 함)
    """
    await ws.accept()
    last_cmd = [0.0]  # last receive monotonic time
    stop_sent = [False]
    async def watchdog():
        # 별도 task. 받은 메시지 없으면 (0,0,0) publish + 종료.
        while True:
            await asyncio.sleep(0.1)
            now = _time.monotonic()
            if last_cmd[0] > 0 and now - last_cmd[0] > 0.3:
                if not stop_sent[0]:
                    _publish_twist(0.0, 0.0, 0.0)
                    stop_sent[0] = True
            try:
                if ws.client_state.value > 1:  # closed
                    break
            except Exception:
                break
    wd = asyncio.create_task(watchdog())
    try:
        while True:
            msg = await ws.receive_json()
            lin = float(msg.get('linear', 0.0))
            ang = float(msg.get('angular', 0.0))
            lat = float(msg.get('lateral', 0.0))
            _publish_twist(lin, ang, lat)
            last_cmd[0] = _time.monotonic()
            stop_sent[0] = (lin == 0.0 and ang == 0.0 and lat == 0.0)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_teleop error: %s', e)
    finally:
        # 연결 종료 시 무조건 정지
        try: _publish_twist(0.0, 0.0, 0.0)
        except Exception: pass
        wd.cancel()


# ── 텔레옵 디바이스 (xlerobot SO-ARM101 leader) ─────────────────────────
# 프론트가 조작 탭에서 좌/우 leader USB serial 각각 선택 → connect.
# scservo_sdk (feetech-servo-sdk PyPI) 로 STS3215 protocol 직접 통신.
# 50Hz background thread 가 양 팔 sync_read('Present_Position') → ROS topic publish.
# isaac_bridge 가 그 토픽 구독해 frame.arm_joint_pos_target 에 채움.
#
# STS3215 register: Present_Position 주소 0x38 (56), length 2 byte (uint16, 0..4095).
# protocol_end=0 = SCS (Feetech) — Dynamixel 과 packet 형식 다름.
_FEETECH_PRESENT_POSITION = 56  # 0x38
_FEETECH_POS_LEN = 2            # bytes
_FEETECH_PROTOCOL_END = 0       # SCS / Feetech
_LEADER_MOTOR_IDS = (1, 2, 3, 4, 5, 6)   # SO-ARM101 6 joint: pan/lift/elbow/wrist_flex/wrist_roll/gripper
_LEADER_MOTOR_NAMES = ('shoulder_pan', 'shoulder_lift', 'elbow_flex',
                       'wrist_flex', 'wrist_roll', 'gripper')

_TELEOP_ARMS = ('left', 'right')
# slot 필드:
#   connected: bool
#   port, baudrate
#   port_handler, packet_handler, sync_read   ← scservo_sdk 객체 (None when disconnected)
#   last_positions: list[float|None] of length 6 ('Present_Position' raw ticks 0..4095, None=read fail)
#   last_read_at: float (monotonic)
#   error: str|None
_teleop_devices: dict[str, dict] = {
    arm: {
        'connected': False, 'port': None, 'baudrate': None,
        'port_handler': None, 'packet_handler': None, 'sync_read': None,
        'last_positions': [None] * 6, 'last_read_at': 0.0,
        'error': None,
    }
    for arm in _TELEOP_ARMS
}
_teleop_lock = threading.Lock()
_leader_pub_lock = threading.Lock()
_leader_thread: Optional[threading.Thread] = None
_leader_thread_stop = threading.Event()
# adapter ROS 노드 가 만든 Float64MultiArray publisher. _start_ros_subscriber 에서 init.
_leader_arm_pub = None
# 14 element fallback (None = 마지막 값 유지). 좌 6 + 우 6 + 2 head=0.
# 인덱스 매핑은 sim 측 joint_names_pos 순서 검증 후 조정 (우선 좌→우→head 0,0).
_LEADER_FRAME_LEN = 14


class TeleopConnectRequest(BaseModel):
    arm: str = 'left'                  # 'left' | 'right'
    port: str                          # /dev/ttyACM0 등
    baudrate: int = 1000000            # feetech sts3215 기본 1Mbps


def _validate_arm(arm: str) -> str:
    if arm not in _TELEOP_ARMS:
        raise HTTPException(status_code=400, detail=f'arm must be one of {_TELEOP_ARMS}, got {arm!r}')
    return arm


def _arm_status(arm: str) -> dict:
    d = _teleop_devices[arm]
    return {
        'connected': bool(d.get('connected')),
        'port': d.get('port'),
        'baudrate': d.get('baudrate'),
        'error': d.get('error'),
    }


@app.get('/api/system/teleop/ports')
def list_teleop_ports():
    """USB-시리얼 포트 enumerate. xlerobot 류 디바이스는 /dev/ttyACM*, USB-FTDI 류는 /dev/ttyUSB*."""
    try:
        import serial.tools.list_ports
    except ImportError:
        raise HTTPException(status_code=503, detail='pyserial not installed in adapter venv')
    # 이미 한쪽 leader 가 잡고 있는 포트는 메타로 표시 → 프론트가 다른 쪽 선택지에서 회색 처리.
    held = {arm: _teleop_devices[arm].get('port') for arm in _TELEOP_ARMS
            if _teleop_devices[arm].get('connected')}
    ports = []
    for p in serial.tools.list_ports.comports():
        held_by = next((arm for arm, pp in held.items() if pp == p.device), None)
        ports.append({
            'device': p.device,
            'description': p.description or '',
            'hwid': p.hwid or '',
            'manufacturer': p.manufacturer or '',
            'product': p.product or '',
            'heldBy': held_by,  # 'left' | 'right' | None
        })
    return {'ports': ports}


def _open_feetech_bus(port: str, baudrate: int):
    """scservo_sdk 로 USB 포트 open + STS3215 6 모터 ping. 실패 시 raise.
    반환: (port_handler, packet_handler, GroupSyncRead). 호출자가 close 책임.
    """
    import scservo_sdk as sdk
    ph = sdk.PortHandler(port)
    if not ph.openPort():
        raise RuntimeError(f'openPort failed: {port}')
    if not ph.setBaudRate(baudrate):
        try: ph.closePort()
        except Exception: pass
        raise RuntimeError(f'setBaudRate {baudrate} failed: {port}')
    pkt = sdk.PacketHandler(_FEETECH_PROTOCOL_END)
    # Ping 6 모터로 leader 진위 확인. 한 모터라도 응답 없으면 실패.
    missing = []
    for mid in _LEADER_MOTOR_IDS:
        _model, comm, err = pkt.ping(ph, mid)
        if comm != 0 or err != 0:
            missing.append(mid)
    if missing:
        try: ph.closePort()
        except Exception: pass
        raise RuntimeError(f'ping failed for motor IDs {missing} on {port} '
                           f'(leader 가 6 모터 1..6 다 응답해야 함)')
    sr = sdk.GroupSyncRead(ph, pkt, _FEETECH_PRESENT_POSITION, _FEETECH_POS_LEN)
    for mid in _LEADER_MOTOR_IDS:
        if not sr.addParam(mid):
            try: ph.closePort()
            except Exception: pass
            raise RuntimeError(f'GroupSyncRead.addParam id={mid} failed')
    return ph, pkt, sr


def _close_feetech_bus(slot: dict) -> None:
    ph = slot.get('port_handler')
    if ph is not None:
        try: ph.closePort()
        except Exception: pass
    slot.update({'port_handler': None, 'packet_handler': None, 'sync_read': None})


@app.post('/api/system/teleop/connect')
def connect_teleop_device(req: TeleopConnectRequest):
    try:
        import scservo_sdk  # noqa: F401
    except ImportError:
        raise HTTPException(status_code=503,
                            detail='feetech-servo-sdk not installed in adapter venv')
    arm = _validate_arm(req.arm)
    with _teleop_lock:
        # 같은 포트가 다른 arm 에 이미 잡혀 있으면 거부.
        for other in _TELEOP_ARMS:
            if other != arm and _teleop_devices[other].get('connected') and _teleop_devices[other].get('port') == req.port:
                raise HTTPException(status_code=409,
                                    detail=f'port {req.port} already held by {other} arm')
        slot = _teleop_devices[arm]
        if slot.get('connected') and slot.get('port') == req.port and slot.get('baudrate') == req.baudrate:
            return {'ok': True, 'arm': arm, 'connected': True,
                    'port': req.port, 'baudrate': req.baudrate}
        # 다른 설정 또는 미연결 → 기존 close 후 새로 open
        _close_feetech_bus(slot)
        try:
            ph, pkt, sr = _open_feetech_bus(req.port, req.baudrate)
        except Exception as e:
            slot.update({'connected': False, 'error': str(e),
                         'port_handler': None, 'packet_handler': None, 'sync_read': None})
            raise HTTPException(status_code=400, detail=f'open failed: {e}')
        slot.update({
            'connected': True,
            'port': req.port,
            'baudrate': req.baudrate,
            'port_handler': ph,
            'packet_handler': pkt,
            'sync_read': sr,
            'error': None,
            'last_positions': [None] * 6,
            'last_read_at': 0.0,
        })
    _ensure_leader_thread_started()
    log.info('teleop %s arm connected (feetech): %s @ %d', arm, req.port, req.baudrate)
    return {'ok': True, 'arm': arm, 'connected': True,
            'port': req.port, 'baudrate': req.baudrate}


class TeleopDisconnectRequest(BaseModel):
    arm: str = 'left'                  # 'left' | 'right'


@app.post('/api/system/teleop/disconnect')
def disconnect_teleop_device(req: TeleopDisconnectRequest):
    arm = _validate_arm(req.arm)
    with _teleop_lock:
        slot = _teleop_devices[arm]
        _close_feetech_bus(slot)
        slot.update({'connected': False, 'error': None,
                     'last_positions': [None] * 6, 'last_read_at': 0.0})
    return {'ok': True, 'arm': arm, 'connected': False}


@app.get('/api/system/teleop/status')
def teleop_device_status():
    """양 팔 상태 한 번에. 응답: {left: {...}, right: {...}}.
    각 arm 에 last_positions (raw ticks 0..4095) 와 last_read_age 추가.
    """
    out = {}
    for arm in _TELEOP_ARMS:
        s = _teleop_devices[arm]
        last_at = s.get('last_read_at') or 0.0
        out[arm] = {
            'connected': bool(s.get('connected')),
            'port': s.get('port'),
            'baudrate': s.get('baudrate'),
            'error': s.get('error'),
            'last_positions': list(s.get('last_positions') or []),
            'last_read_age_ms': int((_time.monotonic() - last_at) * 1000) if last_at > 0 else None,
        }
    return out


# ── Leader 50Hz read thread ─────────────────────────────────────────────
def _leader_read_loop():
    """양 팔 connected slot 마다 GroupSyncRead 호출, slot.last_positions 갱신.
    그리고 14-element float array 합쳐 ROS topic 으로 publish.
    인덱스 매핑: 0..5 = left arm 6 joint, 6..11 = right arm 6 joint, 12..13 = 0 (head 보류).
    Sim 측 joint_names_pos 순서가 다르면 매핑 상수 (_LEADER_INDEX_MAP) 수정.
    """
    period = 1.0 / 50.0   # 50 Hz
    while not _leader_thread_stop.is_set():
        t0 = _time.monotonic()
        # ── arm 별 sync read (lock 안에서 짧게) ───────────────────────
        for arm in _TELEOP_ARMS:
            with _teleop_lock:
                slot = _teleop_devices[arm]
                if not slot.get('connected') or slot.get('sync_read') is None:
                    continue
                sr = slot['sync_read']
            # txRxPacket 은 시간 걸리므로 lock 밖에서.
            try:
                comm = sr.txRxPacket()
                if comm != 0:
                    raise RuntimeError(f'txRxPacket comm={comm}')
                vals = []
                for mid in _LEADER_MOTOR_IDS:
                    if not sr.isAvailable(mid, _FEETECH_PRESENT_POSITION, _FEETECH_POS_LEN):
                        vals.append(None)
                        continue
                    raw = sr.getData(mid, _FEETECH_PRESENT_POSITION, _FEETECH_POS_LEN)
                    vals.append(int(raw))
                with _teleop_lock:
                    slot = _teleop_devices[arm]
                    if slot.get('connected'):
                        slot['last_positions'] = vals
                        slot['last_read_at'] = _time.monotonic()
                        slot['error'] = None
            except Exception as e:
                with _teleop_lock:
                    slot = _teleop_devices[arm]
                    slot['error'] = f'read fail: {e}'
        # ── 14 element 합쳐 publish (raw ticks 그대로) ─────────────────
        if _leader_arm_pub is not None:
            frame = [0.0] * _LEADER_FRAME_LEN
            with _teleop_lock:
                lp_l = list(_teleop_devices['left'].get('last_positions') or [])
                lp_r = list(_teleop_devices['right'].get('last_positions') or [])
            for i, v in enumerate(lp_l[:6]):
                if v is not None:
                    frame[i] = float(v)
            for i, v in enumerate(lp_r[:6]):
                if v is not None:
                    frame[6 + i] = float(v)
            try:
                from std_msgs.msg import Float64MultiArray
                msg = Float64MultiArray()
                msg.data = frame
                _leader_arm_pub.publish(msg)
            except Exception as e:
                log.warning('leader publish error: %s', e)
        # ── pace ───────────────────────────────────────────────────────
        elapsed = _time.monotonic() - t0
        sleep = period - elapsed
        if sleep > 0:
            _time.sleep(sleep)


def _ensure_leader_thread_started():
    """첫 connect 시 read thread spawn (lazy)."""
    global _leader_thread
    if _leader_thread is not None and _leader_thread.is_alive():
        return
    _leader_thread_stop.clear()
    _leader_thread = threading.Thread(target=_leader_read_loop,
                                      name='leader_read', daemon=True)
    _leader_thread.start()
    log.info('leader read thread started (50 Hz)')


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

    # 시뮬 백엔드 살아있는지 — gazebo 면 gzserver, isaac 면 isaac_bridge.py
    # /proc/*/cmdline 직접 스캔: pgrep -f 는 자기 자신 pattern 까지 매칭하는 버그가 있어
    # 다른 cmd 검사들과 동일하게 cmdline glob 으로 통일.
    sim_alive = False
    try:
        import glob as _glob
        for pidfile in _glob.glob('/proc/[0-9]*/cmdline'):
            try:
                with open(pidfile, 'rb') as f:
                    cmd = f.read().replace(b'\x00', b' ').decode('utf-8', 'ignore')
            except Exception:
                continue
            if 'gzserver' in cmd or 'isaac_bridge.py' in cmd:
                sim_alive = True
                break
    except Exception:
        pass

    db_size = RTABMAP_DB.stat().st_size if RTABMAP_DB.exists() else 0
    disk = shutil.disk_usage('/')

    # 실제 데이터 흐름 기준 (단순 토픽 존재 X). /odom 과 /map 은 영속 구독자가
    # 캐시하므로 그 신선도로 판단. 나머지는 우선 토픽 list 기반 (개선 여지 있음).
    expected = ['/odom', '/scan', '/map', '/trajectory', '/tf', '/tf_static',
                '/camera/image_raw', '/camera/image_raw/compressed',
                '/d456/depth/image_raw', '/semantic_ocr/detections',
                '/rtabmap/info', '/rtabmap/grid_map']
    topic_status: dict[str, bool] = {}
    for t in expected:
        if t == '/odom':
            age = now - (_pose_cache.get('updated_at') or 0)
            topic_status[t] = _pose_cache.get('available', False) and age < 5
        elif t == '/map':
            age = now - (_map_cache.get('updated_at') or 0)
            topic_status[t] = _map_cache.get('available', False) and age < 30
        elif t == '/trajectory':
            topic_status[t] = bool(_trajectory_cache.get('points')) or t in ros_topics
        elif t == '/camera/image_raw/compressed':
            topic_status[t] = bool(_camera_cache.get('data'))
        elif t == '/d456/depth/image_raw':
            age = now - (_depth_cache.get('updated_at') or 0)
            topic_status[t] = bool(_depth_cache.get('data')) and age < 5
        elif t == '/semantic_ocr/detections':
            age = now - (_ocr_cache.get('updated_at') or 0)
            topic_status[t] = (_ocr_cache.get('updated_at', 0) > 0 and age < 30) or t in ros_topics
        else:
            topic_status[t] = t in ros_topics

    # 토픽별 Hz + 정상 주기. adapter 가 subscribe 한 토픽만 hz 측정 가능 (그 외엔 -1).
    # frontend 는 hz < expected/2 면 "죽은 토픽" 으로 빨간 표시.
    topic_metrics: dict[str, dict] = {}
    for t in expected:
        expected_hz = TOPIC_EXPECTED_HZ.get(t)
        # 측정 가능한 토픽만 hz 계산 (subscribe 한 토픽). 그 외는 None.
        hz = round(_topic_hz(t, expected_hz), 1) if t in TOPIC_EXPECTED_HZ else None
        topic_metrics[t] = {
            'alive': topic_status[t],
            'hz': hz,                                  # None = 측정 안 함, float = 실측 Hz
            'expected_hz': expected_hz,                # None = 기준 없음 → frontend 는 비교 안 함
        }

    return {
        'adapter': 'ok',
        'sim_alive': sim_alive,
        'slam_active': _slam_node_alive(),
        'explore_active': _explore_node_alive(),
        'sim_secs': _clock_cache.get('sim_secs', 0.0),
        'rtabmap_db_path': str(RTABMAP_DB),
        'rtabmap_db_size_mb': round(db_size / 1e6, 2),
        'ros_topic_count': len(ros_topics),
        'ros_expected_topics': topic_status,           # 호환 유지
        'ros_topic_metrics': topic_metrics,            # 신규: Hz 정보 포함
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


@app.get('/api/system/depth.jpg')
def depth_jpg():
    """Return the latest depth frame as a JPEG color map."""
    from fastapi.responses import Response
    _ensure_subscriber()
    data = _depth_cache.get('data')
    if not data:
        return Response(status_code=204)
    return Response(content=data, media_type='image/jpeg')


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
    """라이브 pose 스트림. /odom 50Hz → 클라이언트 부하 줄이려 ~20Hz throttle.
    sim_time (clock 캐시) 도 함께 동봉."""
    await ws.accept()
    _ensure_subscriber()
    last_sent_at = 0.0
    MIN_INTERVAL = 0.05  # 50ms = 20Hz max
    try:
        while True:
            up = _pose_cache.get('updated_at', 0)
            now = _time.time()
            if (_pose_cache.get('available') and up > last_sent_at
                    and now - last_sent_at >= MIN_INTERVAL):
                last_sent_at = now
                payload = {**_pose_cache, 'sim_secs': _clock_cache.get('sim_secs', 0.0)}
                await ws.send_json(payload)
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _pose_event.wait(timeout=0.05))
            _pose_event.clear()
    except WebSocketDisconnect:
        pass


def _serialize_voxel_frame(added: list, removed: list, voxel_size_m: float,
                           is_initial: bool = False) -> bytes:
    """RTAB-Map cloud_map voxel delta → binary frame.

    Frame layout (version 3):
      u8   version = 3
      u8   flags (bit0=initial_sync; bit1=more_chunks_follow)
      f32  voxel_size_m
      u32  added_count
      for each added voxel:
        i16 ix, i16 iy, i16 iz, u8 r, u8 g, u8 b   (9 bytes)
      u32  removed_count
      for each removed voxel:
        i16 ix, i16 iy, i16 iz                      (6 bytes)

    frontend: ix*voxel_size, iy*voxel_size, iz*voxel_size 로 복원.
    """
    out = bytearray()
    flags = 0
    if is_initial:
        flags |= 0x01
    out += struct.pack('<BBf', 3, flags, voxel_size_m)
    out += struct.pack('<I', len(added))
    for v in added:
        ix, iy, iz, r, g, b = v
        out += struct.pack('<hhhBBB', ix, iy, iz, r, g, b)
    out += struct.pack('<I', len(removed))
    for v in removed:
        out += struct.pack('<hhh', v[0], v[1], v[2])
    return bytes(out)


@app.websocket('/ws/voxels')
async def ws_voxels(ws: WebSocket):
    """RTAB-Map /rtabmap/cloud_map 의 voxelized RGB scene. 첫 frame = 캐시 전체
    (initial sync), 이후 frame = added/removed delta. nvblox mesh (/ws/scene) 의
    GPU-free 대체. 큰 frame 은 max_voxels_per_frame 단위 chunk 분할 송신.
    """
    await ws.accept()
    _ensure_subscriber()
    voxel_size = float(_voxel_config.get('voxel_size', 0.10))
    max_per_frame = int(_voxel_config.get('max_voxels_per_frame', 50_000))
    # 1) Initial sync: 캐시 snapshot 을 chunk 단위로 added 로 보냄.
    with _voxel_lock:
        snapshot = [(k[0], k[1], k[2], *v) for k, v in _voxel_cache.items()]
    try:
        if not snapshot:
            # 빈 캐시여도 frame 1번은 보내 클라가 voxel_size 알게 함.
            await ws.send_bytes(_serialize_voxel_frame([], [], voxel_size, is_initial=True))
        else:
            for i in range(0, len(snapshot), max_per_frame):
                chunk = snapshot[i:i + max_per_frame]
                await ws.send_bytes(_serialize_voxel_frame(chunk, [], voxel_size,
                                                            is_initial=(i == 0)))
    except Exception as e:
        log.warning('ws_voxels initial sync error: %s', e)
        return
    last_seq = _voxel_seq
    # 2) 이후 delta.
    try:
        while True:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _voxel_event.wait(timeout=2.0))
            _voxel_event.clear()
            cur_seq = _voxel_seq
            if cur_seq == last_seq:
                continue
            last_seq = cur_seq
            with _voxel_lock:
                added = list(_voxel_delta.get('added') or [])
                removed = list(_voxel_delta.get('removed') or [])
                # config 가 라이브 변경됐으면 새 voxel_size 반영.
                voxel_size = float(_voxel_config.get('voxel_size', voxel_size))
                max_per_frame = int(_voxel_config.get('max_voxels_per_frame', max_per_frame))
            if not added and not removed:
                continue
            # 큰 burst (루프 클로저 시 added/removed 폭증) 분할 송신.
            # removed 가 더 크면 removed 단독 frame, added 가 더 크면 같이.
            # 단순화: added 만 chunk 분할, removed 는 첫 chunk 에 첨부.
            if added:
                first = True
                for i in range(0, len(added), max_per_frame):
                    chunk_added = added[i:i + max_per_frame]
                    chunk_removed = removed if first else []
                    first = False
                    await ws.send_bytes(_serialize_voxel_frame(
                        chunk_added, chunk_removed, voxel_size, is_initial=False))
            else:
                # added 없고 removed 만 있을 때 (루프 클로저 직후 옛 voxel 제거 frame)
                for i in range(0, len(removed), max_per_frame):
                    chunk_removed = removed[i:i + max_per_frame]
                    await ws.send_bytes(_serialize_voxel_frame(
                        [], chunk_removed, voxel_size, is_initial=False))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_voxels error: %s', e)


@app.get('/api/system/scene/config')
def get_scene_config():
    """현재 voxel scene 파라미터 (mesh 대용 fallback)."""
    return dict(_voxel_config)


@app.post('/api/system/scene/config')
def set_scene_config(cfg: dict):
    """voxel scene 파라미터 라이브 변경. 변경 시 캐시 reset 으로 다음 cloud_map
    publish 가 fresh diff 계산하도록 강제 (안 그러면 voxel_size 가 바뀌어도 옛
    quantize 결과가 prev 로 남아 첫 frame 이 added=현재전체+removed=옛전체 burst)."""
    global _voxel_seq
    allowed = {'enabled', 'voxel_size', 'max_distance',
               'max_voxels_per_frame', 'publish_rate_cap_hz'}
    changed = False
    voxel_size_changed = False
    for k, v in cfg.items():
        if k not in allowed:
            continue
        if k == 'voxel_size' and v != _voxel_config.get('voxel_size'):
            voxel_size_changed = True
        _voxel_config[k] = v
        changed = True
    if voxel_size_changed:
        with _voxel_lock:
            removed = [list(k) for k in _voxel_cache.keys()]
            _voxel_cache.clear()
            _voxel_seq += 1
            _voxel_delta['added'] = []
            _voxel_delta['removed'] = removed
            _voxel_delta['updated_at'] = _time.time()
        _voxel_event.set()
    return {'ok': True, 'changed': changed, 'config': dict(_voxel_config)}


@app.post('/api/system/scene/voxels/reset')
def reset_voxel_scene():
    """voxel 캐시 즉시 비움 + 모든 WS 클라이언트에 removed delta 송신."""
    global _voxel_seq
    with _voxel_lock:
        removed = [list(k) for k in _voxel_cache.keys()]
        _voxel_cache.clear()
        _voxel_seq += 1
        _voxel_delta['added'] = []
        _voxel_delta['removed'] = removed
        _voxel_delta['updated_at'] = _time.time()
    if removed:
        _voxel_event.set()
    return {'ok': True, 'cleared': len(removed)}


@app.websocket('/ws/cloud')
async def ws_cloud(ws: WebSocket):
    """nvblox 3D pointcloud (FLOAT32 x,y,z 버퍼). 캔버스 overlay 렌더용.
    프로토콜: 매 메시지마다 binary frame (n*12 bytes, n = 점 개수, max 5000)."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _cloud_cache.get('updated_at', 0)
            if up != last_seen and _cloud_cache['data']:
                last_seen = up
                await ws.send_bytes(_cloud_cache['data'])
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _cloud_event.wait(timeout=2.0))
            _cloud_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_cloud error: %s', e)


# Wire format version. frontend 가 첫 byte 보고 호환성 검사.
# v1: 옛 raw float32+uint8 포맷 (이전 _serialize_mesh_frame)
# v2: per-entity Draco bitstream (DRACOLoader 디코딩)
_MESH_FRAME_VERSION = 2

def _serialize_mesh_frame(updated_ids: list[str], deleted_ids: list[str]) -> bytes:
    """nvblox mesh delta → binary frame. frontend three.js 가 BufferGeometry 로 디코딩.

    Frame layout (v2 — Draco):
      u8  version (= 2)
      u32 update_count (LE)
      for each updated entity:
        u8  id_len
        bytes id (utf-8, id_len bytes)
        u8  payload_kind        # 1 = Draco, 0 = raw fallback
        u32 payload_size
        bytes payload           # kind=1: Draco bitstream; kind=0: 옛 raw v1 의
                                # vertex/color/index 직렬화 (드물게 fallback 시).
      u32 delete_count
      for each deleted id:
        u8  id_len
        bytes id

    payload_kind 분리: DracoPy 미설치 등 fallback 케이스를 같은 frame 안에 섞을
    수 있게. 보통 모든 entity 가 kind=1 로 옴.
    """
    out = bytearray()
    out += struct.pack('<B', _MESH_FRAME_VERSION)
    valid_ups: list[tuple[str, dict]] = []
    with _mesh_lock:
        for eid in updated_ids:
            ent = _mesh_cache.get(eid)
            if ent is not None:
                valid_ups.append((eid, ent))
    out += struct.pack('<I', len(valid_ups))
    for eid, ent in valid_ups:
        idb = eid.encode('utf-8')
        out += struct.pack('<B', len(idb))
        out += idb
        if 'draco' in ent:
            payload = ent['draco']
            out += struct.pack('<B', 1)
            out += struct.pack('<I', len(payload))
            out += payload
        else:
            # Fallback: 옛 raw 포맷을 단일 payload 안에 packing.
            # vc, vbytes, has_color, [cbytes], ic, ibytes (v1 와 동일 layout).
            vbytes = ent.get('vertices', b'')
            cbytes = ent.get('colors', b'')
            ibytes = ent.get('indices', b'')
            vc = len(vbytes) // 12
            ic = len(ibytes) // 4
            sub = bytearray()
            sub += struct.pack('<I', vc) + vbytes
            sub += struct.pack('<B', 1 if cbytes else 0)
            if cbytes:
                sub += cbytes
            sub += struct.pack('<I', ic) + ibytes
            out += struct.pack('<B', 0)
            out += struct.pack('<I', len(sub))
            out += bytes(sub)
    out += struct.pack('<I', len(deleted_ids))
    for eid in deleted_ids:
        idb = eid.encode('utf-8')
        out += struct.pack('<B', len(idb))
        out += idb
    return bytes(out)


@app.post('/api/system/scene/reset')
def scene_reset():
    """nvblox mesh cache 강제 비움. 매 client 새로고침 시 누적된 옛 entity 잔재가
    그려지는 현상 (mesh 가 점점 이상해짐) 해결용. 호출 후 다음 nvblox publish 부터
    새 entity 만 cache 에 들어감. 활성 ws 클라이언트들엔 모든 entity deletion frame
    이 push 되어 화면 즉시 클리어."""
    global _mesh_seq
    deleted: list[str] = []
    with _mesh_lock:
        deleted = list(_mesh_cache.keys())
        _mesh_cache.clear()
        _mesh_seq += 1
        _mesh_delta['updated_ids'] = []
        _mesh_delta['deleted_ids'] = deleted
        _mesh_delta['updated_at'] = _time.time()
    if deleted:
        _mesh_event.set()
    log.info('scene/reset: cleared %d entities', len(deleted))
    return {'ok': True, 'cleared': len(deleted)}


@app.websocket('/ws/scene')
async def ws_scene(ws: WebSocket):
    """nvblox 3D mesh (TriangleListPrimitive 누적). frontend Three.js 가 BufferGeometry
    로 그림. 첫 frame = cache 의 모든 entity (initial sync), 이후 frame = delta only.
    프로토콜: binary frame (위 _serialize_mesh_frame format)."""
    await ws.accept()
    _ensure_subscriber()
    # 1) Initial sync: cache 의 모든 entity 를 1MB chunk 단위로 split 해 push.
    #    websocket default frame limit (1MB) 회피. 한 chunk 가 1MB 가까이 되면
    #    다음 entity 부터 새 frame.
    MAX_FRAME = 900_000  # 안전 margin (uvicorn default 1MB)
    with _mesh_lock:
        all_ids = list(_mesh_cache.keys())
    chunk: list[str] = []
    # u8 version + u32 update_count = 5; trailing u32 delete_count = 4 → 시작 5.
    chunk_size = 5
    try:
        for eid in all_ids:
            with _mesh_lock:
                ent = _mesh_cache.get(eid)
            if not ent:
                continue
            # v2 entity overhead: u8 id_len + id + u8 kind + u32 size + payload.
            id_bytes = len(eid.encode('utf-8'))
            if 'draco' in ent:
                payload_size = len(ent['draco'])
            else:
                payload_size = (4 + len(ent.get('vertices', b''))
                                + 1 + len(ent.get('colors', b''))
                                + 4 + len(ent.get('indices', b'')))
            est = 1 + id_bytes + 1 + 4 + payload_size
            if chunk_size + est > MAX_FRAME and chunk:
                await ws.send_bytes(_serialize_mesh_frame(chunk, []))
                chunk = []
                chunk_size = 5
            chunk.append(eid)
            chunk_size += est
        if chunk:
            await ws.send_bytes(_serialize_mesh_frame(chunk, []))
    except Exception as e:
        log.warning('ws_scene initial sync error: %s', e)
        return
    last_seq = _mesh_seq
    # 2) 이후: scene_cb 가 _mesh_event 깨우면 그 update 의 delta 만 push.
    try:
        while True:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _mesh_event.wait(timeout=2.0))
            _mesh_event.clear()
            cur_seq = _mesh_seq
            if cur_seq == last_seq:
                continue
            last_seq = cur_seq
            up_ids = list(_mesh_delta.get('updated_ids') or [])
            del_ids = list(_mesh_delta.get('deleted_ids') or [])
            if not up_ids and not del_ids:
                continue
            await ws.send_bytes(_serialize_mesh_frame(up_ids, del_ids))
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_scene error: %s', e)


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


@app.websocket('/ws/trajectory')
async def ws_trajectory(ws: WebSocket):
    """실제 주행 /trajectory. MapCanvas 가 로봇이 지나온 경로로 표시한다."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _trajectory_cache.get('updated_at', 0)
            if up != last_seen:
                last_seen = up
                await ws.send_json({
                    'points': _trajectory_cache['points'],
                    'updated_at': up,
                })
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _trajectory_event.wait(timeout=2.0))
            _trajectory_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_trajectory error: %s', e)


@app.websocket('/ws/ocr')
async def ws_ocr(ws: WebSocket):
    """semantic OCR 트랙 라이브 stream. 새 detection 이 도착하면 [{x, y, room_id,
    confirmed, confidence, observations, id}] 를 JSON 으로 push. MapCanvas 가
    map 위에 spot 으로 그림."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _ocr_cache.get('updated_at', 0)
            if up != last_seen:
                last_seen = up
                await ws.send_json({'tracks': _ocr_cache['tracks'], 'updated_at': up})
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _ocr_event.wait(timeout=2.0))
            _ocr_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_ocr error: %s', e)


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


@app.websocket('/ws/camera/{name}')
async def ws_camera_named(ws: WebSocket, name: str):
    """추가 카메라 stream — name 으로 라우팅. front/wrist_left/wrist_right 지원.
    Isaac bridge 가 /camera/{name}/image_raw/compressed 로 발행하는 것 push."""
    cache_map = {
        'front': (_camera_cache, _camera_event),
        'wrist_left': (_camera_wrist_l_cache, _camera_wrist_l_event),
        'wrist_right': (_camera_wrist_r_cache, _camera_wrist_r_event),
    }
    entry = cache_map.get(name)
    if entry is None:
        await ws.close(code=1008)
        return
    cache, event = entry
    await ws.accept()
    _ensure_subscriber()
    try:
        while True:
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: event.wait(timeout=2.0))
            event.clear()
            data = cache.get('data')
            if data:
                await ws.send_bytes(data)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_camera_named[%s] error: %s', name, e)


@app.websocket('/ws/depth')
async def ws_depth(ws: WebSocket):
    """Live depth stream. Pushes JPEG color maps from /d456/depth/image_raw."""
    await ws.accept()
    _ensure_subscriber()
    last_seen = 0.0
    try:
        while True:
            up = _depth_cache.get('updated_at', 0.0)
            if up != last_seen and _depth_cache.get('data'):
                last_seen = up
                await ws.send_bytes(_depth_cache['data'])
            await asyncio.get_event_loop().run_in_executor(
                None, lambda: _depth_event.wait(timeout=2.0))
            _depth_event.clear()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning('ws_depth error: %s', e)


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
