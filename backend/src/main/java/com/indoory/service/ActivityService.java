package com.indoory.service;

import com.indoory.entity.*;
import com.indoory.entity.Enum.CommandExecutionStatus;
import com.indoory.entity.Enum.CommandType;
import com.indoory.entity.Enum.EventSeverity;
import com.indoory.repository.CommandLogRepository;
import com.indoory.repository.EventLogRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class ActivityService {

  private final CommandLogRepository commandLogRepository;
  private final EventLogRepository eventLogRepository;

  @Transactional
  public void recordEvent(
      Long robotId, Long taskId, EventSeverity severity, String type, String message) {
    EventLog event = newEventLog(robotId, taskId, severity, type, message);
    eventLogRepository.save(event);
  }

  @Transactional
  public CommandLog recordCommand(
      Long robotId,
      Long taskId,
      CommandType commandType,
      String parameters,
      CommandExecutionStatus status,
      String issuedBy) {
    CommandLog command = newCommandLog(robotId, taskId, commandType, parameters, status, issuedBy);
    return commandLogRepository.save(command);
  }

  /** EXECUTING row 를 DONE/FAILED/CANCELED 로 종료 + result 저장. id 가 null
   *  또는 row 없으면 silent skip (멱등성). result 는 1024 chars 로 truncate. */
  @Transactional
  public void markCommandFinished(
      Long commandId, CommandExecutionStatus status, String result) {
    if (commandId == null) return;
    commandLogRepository.findById(commandId).ifPresent(cmd -> {
      cmd.setStatus(status);
      if (result != null) {
        cmd.setResult(result.length() > 1024 ? result.substring(0, 1024) : result);
      }
      commandLogRepository.save(cmd);
    });
  }

  /** robot 의 가장 최근 EXECUTING 명령 (없으면 빈 Optional). frontend 가 mount 시 fetch. */
  @Transactional(readOnly = true)
  public java.util.Optional<CommandLog> findActiveCommand(Long robotId) {
    return commandLogRepository.findFirstByRobotIdAndStatusOrderByIdDesc(
        robotId, CommandExecutionStatus.EXECUTING);
  }

  /** 진행 중인 EXECUTING 명령을 종료. 새 long-running 명령 시작 전 호출 (1 robot
   *  = 1 active command 불변량). null → no-op. */
  @Transactional
  public void closeActiveCommand(Long robotId, CommandExecutionStatus status, String result) {
    findActiveCommand(robotId).ifPresent(cmd -> markCommandFinished(cmd.getId(), status, result));
  }

  private EventLog newEventLog(
      Long robotId, Long taskId, EventSeverity severity, String type, String message) {
    return EventLog.builder()
        .robotId(robotId)
        .taskId(taskId)
        .severity(severity)
        .type(type)
        .message(message)
        .build();
  }

  private CommandLog newCommandLog(
      Long robotId,
      Long taskId,
      CommandType commandType,
      String parameters,
      CommandExecutionStatus status,
      String issuedBy) {
    return CommandLog.builder()
        .robotId(robotId)
        .taskId(taskId)
        .commandType(commandType)
        .parameters(parameters == null ? "" : parameters)
        .status(status)
        .issuedBy(issuedBy)
        .build();
  }
}
