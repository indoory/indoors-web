#!/bin/bash
# ros_adapter 실행 — :8000 listen, ROS2 환경 sourced.
set -e
cd "$(dirname "$0")"
if [ ! -d venv ]; then
  python3 -m venv venv
  ./venv/bin/pip install -r requirements.txt
fi
source /opt/ros/humble/setup.bash
source /root/gz-nav-sim/install/setup.bash
exec ./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
