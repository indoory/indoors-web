package com.indoory.service;

import com.indoory.controller.ApiDtos;
import com.indoory.entity.EventLog;
import com.indoory.repository.EventLogRepository;
import com.indoory.repository.RobotRepository;
import com.indoory.repository.TaskRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class EventService {

  private final EventLogRepository eventLogRepository;
  private final RobotRepository robotRepository;
  private final TaskRepository taskRepository;
  private final ViewAssemblerService viewAssemblerService;

  @Transactional(readOnly = true)
  public List<ApiDtos.EventLogResponse> getEvents() {
    return eventLogRepository.findAllByOrderByCreatedAtDesc().stream()
        .map(this::toEventResponse)
        .toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.EventLogResponse getEvent(Long eventId) {
    EventLog event =
        eventLogRepository
            .findById(eventId)
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Event not found"));
    return toEventResponse(event);
  }

  private ApiDtos.EventLogResponse toEventResponse(EventLog event) {
    return viewAssemblerService.toEventLog(
        event,
        event.getRobotId() == null
            ? null
            : robotRepository.findById(event.getRobotId()).orElse(null),
        event.getTaskId() == null ? null : taskRepository.findById(event.getTaskId()).orElse(null));
  }
}
