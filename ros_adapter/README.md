# ros_adapter

Indoory 웹 관제 (Spring Boot, :8080) 와 ROS 2 (rtabmap, gz_nav_sim) 사이의 REST 브리지.

상위 [gz-nav-sim README](../../README.md) 의 *멀티세션 SLAM* 섹션이
전체 흐름을 설명한다. 본 README 는 어댑터 단독 운용 정보만 다룸.

## 책임

- Spring Boot 가 호출하는 `/api/robots/{id}/...` REST 라우트 수신
- ROS2 service / topic / subprocess 호출로 변환
- RTAB-Map `.db` blob 파일 ↔ Spring 사이 multipart 운반
- `bench/spin_and_relocalize.py` 서브프로세스 spawn

영속 상태 없음 (stateless). 모든 영속화는 Spring Boot 의 Postgres 가 보유.

## 실행

```bash
cd indoors-web/ros_adapter
./run.sh
```

첫 실행 시:
1. `python3 -m venv venv`
2. `pip install -r requirements.txt` (FastAPI + uvicorn + requests + python-multipart)
3. ROS 2 Humble + 워크스페이스 sourced 환경에서 `uvicorn main:app --port 8000 --reload`

이후 실행은 venv 재사용.

## 환경변수

| 변수 | 기본 | 용도 |
|---|---|---|
| `RTABMAP_DB` | `~/.ros/rtabmap.db` | rtabmap 이 사용하는 working DB 경로 (Save Map 시 읽음) |
| `FLOOR_DB_DIR` | `/var/indoory/floor_dbs` | floor 별 staged `.db` 저장 위치 (Go to Floor 시 쓰기) |
| `SPRING_BASE_URL` | `http://localhost:8080` | Spring Boot base URL — `slam/save` 후 blob 푸시 대상 |
| `SPIN_RELOC_SCRIPT` | `/root/gz-nav-sim/bench/spin_and_relocalize.py` | Where am I? 트리거할 스크립트 |

## 라우트

상위 README §REST API 의 ros_adapter 표 참고.

## 헬스체크

```bash
curl http://localhost:8000/health
# → {"status":"ok","rtabmap_db_exists":true}
```

## 실행 시 ROS 환경

`run.sh` 는 `/opt/ros/humble/setup.bash` 와 `/root/gz-nav-sim/install/setup.bash` 를
sourced 한 셸에서 uvicorn 을 띄운다. 이 환경이 `subprocess.run(['bash', '-c', ...])`
의 자식에도 inherits 되므로 어댑터 안에서 `ros2 service call` 호출이 그대로 동작.
