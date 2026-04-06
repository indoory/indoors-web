package com.indoory.backend.service;

import com.indoory.backend.entity.CommandExecutionStatus;
import com.indoory.backend.entity.CommandLogEntity;
import com.indoory.backend.entity.CommandType;
import com.indoory.backend.entity.EventLogEntity;
import com.indoory.backend.entity.EventSeverity;
import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.RobotStateSnapshotEntity;
import com.indoory.backend.repository.CommandLogRepository;
import com.indoory.backend.repository.EventLogRepository;
import com.indoory.backend.repository.RobotStateSnapshotRepository;
import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ActivityService {

  private final CommandLogRepository commandLogRepository;
  private final EventLogRepository eventLogRepository;
  private final RobotStateSnapshotRepository robotStateSnapshotRepository;

  @Transactional
  public void recordEvent(
      Long robotId, Long taskId, EventSeverity severity, String type, String message) {
    EventLogEntity event =
        EventLogEntity.create(robotId, taskId, severity, type, message, LocalDateTime.now());
    eventLogRepository.save(event);
  }

  @Transactional
  public void recordCommand(
      Long robotId,
      Long taskId,
      CommandType commandType,
      String parameters,
      CommandExecutionStatus status,
      String issuedBy) {
    CommandLogEntity command =
        CommandLogEntity.create(
            robotId, taskId, commandType, parameters, status, issuedBy, LocalDateTime.now());
    commandLogRepository.save(command);
  }

  @Transactional
  public void captureSnapshot(RobotEntity robot) {
    RobotStateSnapshotEntity snapshot =
        RobotStateSnapshotEntity.capture(robot, LocalDateTime.now());
    robotStateSnapshotRepository.save(snapshot);
  }
}
