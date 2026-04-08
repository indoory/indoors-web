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
  public void recordCommand(
      Long robotId,
      Long taskId,
      CommandType commandType,
      String parameters,
      CommandExecutionStatus status,
      String issuedBy) {
    CommandLog command = newCommandLog(robotId, taskId, commandType, parameters, status, issuedBy);
    commandLogRepository.save(command);
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
