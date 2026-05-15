#!/bin/bash
# ros_adapter 실행 — :8000 listen, ROS2 환경 sourced.
set -e
cd "$(dirname "$0")"
GZ_NAV_SIM_ROOT="${GZ_NAV_SIM_ROOT:-/home/fnhid/gz-nav-sim}"
# 환경별 fallback: hardcoded fnhid → /root → 이 스크립트 위치에서 두 단계 위
# (indoors-web/ros_adapter/run.sh → repo root).
if [ ! -f "$GZ_NAV_SIM_ROOT/install/setup.bash" ]; then
  if [ -f /root/gz-nav-sim/install/setup.bash ]; then
    GZ_NAV_SIM_ROOT=/root/gz-nav-sim
  else
    _here=$(cd "$(dirname "$0")/../.." && pwd)
    if [ -f "$_here/install/setup.bash" ]; then
      GZ_NAV_SIM_ROOT="$_here"
    fi
  fi
fi
export GZ_NAV_SIM_ROOT

# venv 가 없거나 부분 생성됐거나 shebang 이 다른 경로 (예: /root/...) 로
# 박힌 상태에서 디렉토리가 이동된 경우 모두 재생성. `-x python` 만으로는
# stale shebang (bad interpreter) 케이스를 못 잡아서 무한히 즉시 종료한다.
if [ ! -x venv/bin/python ] || ! ./venv/bin/python -c "import sys" 2>/dev/null; then
  rm -rf venv
  if ! python3 -m venv venv 2>/dev/null; then
    echo "[adapter] python3 -m venv 실패 — apt install python3.10-venv 후 재시도"
    apt-get install -y python3.10-venv >/dev/null 2>&1 || true
    python3 -m venv venv
  fi
  ./venv/bin/pip install -q -r requirements.txt
fi

# ROS2 setup.bash 가 set -u 와 충돌 → 명시적으로 nounset 해제.
set +u
source /opt/ros/humble/setup.bash
source "$GZ_NAV_SIM_ROOT/install/setup.bash"
set -u
# sim_nav.launch.py 가 모든 ROS 노드를 ROS_LOCALHOST_ONLY=1 로 띄움 (외부 호스트
# sim leak 차단). adapter 도 같은 도메인에 있어야 isaac_bridge 의 /cmd_vel sub 와
# DDS 매칭됨. 이 설정 빠지면 adapter publish 가 multicast 로만 나가고 isaac_bridge
# (loopback only) 가 못 받아서 텔레옵 묵음.
export ROS_LOCALHOST_ONLY=1
# ROS_DOMAIN_ID 도 launch (run_multisession_slam.sh/bench/run.sh) 와 일치해야
# 같은 DDS 도메인에서 토픽 매칭됨. default 42 — 다른 launch 스크립트와 일관.
# 빠지면 adapter 가 default 0 으로 떠서 ROS 토픽 0개 받음 (web map/OCR 무응답).
export ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-42}
# --reload 제거: WS 핸들러가 background task 로 hang → reload 시 무한대기 + adapter
# 죽음. 코드 변경 시 수동 pkill 후 supervisor 가 재기동하는 흐름이 더 안정적.
exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
