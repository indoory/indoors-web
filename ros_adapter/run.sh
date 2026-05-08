#!/bin/bash
# ros_adapter 실행 — :8000 listen, ROS2 환경 sourced.
set -e
cd "$(dirname "$0")"
GZ_NAV_SIM_ROOT="${GZ_NAV_SIM_ROOT:-/home/fnhid/gz-nav-sim}"
if [ ! -f "$GZ_NAV_SIM_ROOT/install/setup.bash" ] && [ -f /root/gz-nav-sim/install/setup.bash ]; then
  GZ_NAV_SIM_ROOT=/root/gz-nav-sim
fi
export GZ_NAV_SIM_ROOT

# venv 가 없거나 부분 생성됐으면 새로 만든다.
if [ ! -x venv/bin/python ]; then
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
# --reload 제거: WS 핸들러가 background task 로 hang → reload 시 무한대기 + adapter
# 죽음. 코드 변경 시 수동 pkill 후 supervisor 가 재기동하는 흐름이 더 안정적.
exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
