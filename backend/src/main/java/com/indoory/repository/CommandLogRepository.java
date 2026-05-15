package com.indoory.repository;

import com.indoory.entity.CommandLog;
import com.indoory.entity.Enum.CommandExecutionStatus;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommandLogRepository extends JpaRepository<CommandLog, Long> {

  List<CommandLog> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);

  /** 가장 최근 EXECUTING 명령 — frontend mount 시 actionMode 복원에 사용. */
  Optional<CommandLog> findFirstByRobotIdAndStatusOrderByIdDesc(
      Long robotId, CommandExecutionStatus status);
}
