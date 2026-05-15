package com.indoory.entity.Enum;

public enum CommandExecutionStatus {
  QUEUED,
  EXECUTING,   // long-running 진행 중. frontend 가 이걸 보고 actionMode 복원.
  DONE,
  FAILED,
  CANCELED,    // 사용자 명시적 취소 (cancel_event 등)
}
