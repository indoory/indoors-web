package com.indoory.entity.Enum;

/**
 * 운영자 발령 명령의 종류. EXECUTING 으로 영속되는 long-running command 와
 * 1회성 (DONE 즉시 기록되는) command 모두 포함.
 *
 * <p>long-running 들은 RobotsPage 의 actionMode (slam / reloc / goto-running)
 * 와 매핑되어 페이지 새로고침 시 active command fetch 로 UI 복원에 사용.
 */
public enum CommandType {
  // 1회성
  DISPATCH,           // /robots/{id}/commands/dispatch — Nav2 goto. nav 도달까지 long-running 으로 취급.
  PAUSE,
  RESUME,
  EMERGENCY_STOP,

  // long-running
  SLAM_EXPLORE_START, // /robots/{id}/slam/explore/start
  SLAM_STOP,
  RELOCALIZE,         // /robots/{id}/relocalize  (회전 + BoW 매칭)
  TELEPORT,           // /api/system/sim/reset_pose  (사실상 1회성이지만 일관성 위해 기록)
}
