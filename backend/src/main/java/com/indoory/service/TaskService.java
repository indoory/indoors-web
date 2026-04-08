package com.indoory.service;

import com.indoory.config.SessionOperator;
import com.indoory.controller.ApiDtos;
import com.indoory.entity.*;
import com.indoory.entity.Enum.*;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.LocationRepository;
import com.indoory.repository.MapRepository;
import com.indoory.repository.RobotRepository;
import com.indoory.repository.TaskRepository;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class TaskService {

  private static final List<TaskStatus> ACTIVE_TASK_STATUSES =
      List.of(TaskStatus.ASSIGNED, TaskStatus.RUNNING, TaskStatus.PAUSED);
  private static final String SYSTEM_ISSUER = "system@indoory.io";

  private final TaskRepository taskRepository;
  private final RobotRepository robotRepository;
  private final FloorRepository floorRepository;
  private final MapRepository mapRepository;
  private final LocationRepository locationRepository;
  private final TaskDispatchPolicy taskDispatchPolicy;
  private final ViewAssemblerService viewAssemblerService;
  private final ActivityService activityService;

  @Transactional(readOnly = true)
  public List<ApiDtos.TaskSummaryResponse> getTasks() {
    return taskRepository.findAllByOrderByCreatedAtDesc().stream()
        .map(this::toTaskSummary)
        .toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.TaskDetailResponse getTask(Long taskId) {
    return toTaskDetail(findTask(taskId));
  }

  @Transactional
  public ApiDtos.TaskDetailResponse createTask(
      ApiDtos.CreateTaskRequest request, SessionOperator operator) {
    Location pickup = findLocation(request.pickupLocationId());
    Location dropoff = findLocation(request.dropoffLocationId());

    if (pickup.getId().equals(dropoff.getId())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Pickup and dropoff must be different locations");
    }

    if (!pickup.getFloorId().equals(dropoff.getFloorId())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "MVP task creation requires pickup and dropoff on the same floor");
    }

    Floor floor = findFloor(pickup.getFloorId());
    IndoorMap map = findMap(floor.getMapId());
    LocalDateTime now = LocalDateTime.now();

    Task task =
        taskRepository.save(
            newDeliveryTask(
                nextTaskCode(),
                parsePriority(request.priority()),
                map.getId(),
                floor.getId(),
                pickup.getId(),
                dropoff.getId(),
                now));

    if (!tryAssignTask(task, operator.email())) {
      activityService.recordEvent(
          null,
          task.getId(),
          EventSeverity.WARN,
          "TASK",
          "Task " + task.getTaskCode() + " queued because no robot is currently available");
    }

    return toTaskDetail(findTask(task.getId()));
  }

  @Transactional
  public void cancelTask(Long taskId, SessionOperator operator) {
    Task task = findTask(taskId);

    if (isTerminal(task)) {
      return;
    }

    LocalDateTime now = LocalDateTime.now();
    cancel(task, now);
    taskRepository.save(task);

    if (task.getAssignedRobotId() != null) {
      Robot robot = findRobot(task.getAssignedRobotId());
      robot.markIdle();
      robotRepository.save(robot);
      activityService.recordEvent(
          robot.getId(),
          task.getId(),
          EventSeverity.WARN,
          "TASK",
          "Task " + task.getTaskCode() + " canceled by " + operator.email());
      dispatchQueuedTasks();
      return;
    }

    activityService.recordEvent(
        null,
        task.getId(),
        EventSeverity.WARN,
        "TASK",
        "Queued task " + task.getTaskCode() + " canceled by " + operator.email());
  }

  @Transactional
  public void deleteTask(Long taskId, SessionOperator operator) {
    Task task = findTask(taskId);
    if (ACTIVE_TASK_STATUSES.contains(task.getStatus())) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete active task");
    }

    taskRepository.delete(task);

    activityService.recordEvent(
        null,
        task.getId(),
        EventSeverity.WARN,
        "TASK",
        "Task " + task.getTaskCode() + " deleted by " + operator.email());
  }

  @Transactional
  public void dispatchQueuedTasks() {
    for (Task queuedTask : taskRepository.findAllByStatusOrderByCreatedAtAsc(TaskStatus.CREATED)) {
      tryAssignTask(queuedTask, SYSTEM_ISSUER);
    }
  }

  @Transactional(readOnly = true)
  public Task findActiveTaskForRobot(Long robotId) {
    return taskRepository
        .findFirstByAssignedRobotIdAndStatusInOrderByCreatedAtDesc(robotId, ACTIVE_TASK_STATUSES)
        .orElse(null);
  }

  private Robot selectRobot(Long mapId, Long floorId) {
    Set<Long> busyRobotIds =
        taskRepository.findAllByStatusInOrderByCreatedAtDesc(ACTIVE_TASK_STATUSES).stream()
            .map(Task::getAssignedRobotId)
            .filter(Objects::nonNull)
            .collect(java.util.stream.Collectors.toSet());

    return taskDispatchPolicy.selectRobot(
        robotRepository.findAllByOrderByIdAsc(), busyRobotIds, mapId, floorId);
  }

  private boolean tryAssignTask(Task task, String issuedBy) {
    Robot candidate = selectRobot(task.getMapId(), task.getFloorId());
    if (candidate == null) {
      return false;
    }

    Location pickup = findLocation(task.getPickupLocationId());
    Location dropoff = findLocation(task.getDropoffLocationId());
    LocalDateTime now = LocalDateTime.now();

    assign(task, candidate.getId(), now);
    taskRepository.save(task);

    candidate.markPlanning();
    robotRepository.save(candidate);

    activityService.recordCommand(
        candidate.getId(),
        task.getId(),
        CommandType.DISPATCH,
        "pickup: " + pickup.getName() + ", dropoff: " + dropoff.getName(),
        CommandExecutionStatus.EXECUTING,
        issuedBy);
    activityService.recordEvent(
        candidate.getId(),
        task.getId(),
        EventSeverity.INFO,
        "TASK",
        "Task " + task.getTaskCode() + " auto-assigned to " + candidate.getLabel());
    return true;
  }

  private String nextTaskCode() {
    long nextId = taskRepository.findTopByOrderByIdDesc().map(Task::getId).orElse(4000L) + 1L;
    return "TSK-" + nextId;
  }

  private Task newDeliveryTask(
      String taskCode,
      TaskPriority priority,
      Long mapId,
      Long floorId,
      Long pickupLocationId,
      Long dropoffLocationId,
      LocalDateTime createdAt) {
    return Task.builder()
        .taskCode(taskCode)
        .type(TaskType.DELIVERY)
        .status(TaskStatus.CREATED)
        .priority(priority)
        .mapId(mapId)
        .floorId(floorId)
        .pickupLocationId(pickupLocationId)
        .dropoffLocationId(dropoffLocationId)
        .currentStage(TaskStage.QUEUED)
        .stageUpdatedAt(createdAt)
        .build();
  }

  public boolean isTerminal(Task task) {
    return task.getStatus() == TaskStatus.DONE
        || task.getStatus() == TaskStatus.CANCELED
        || task.getStatus() == TaskStatus.FAILED;
  }

  public void assign(Task task, Long robotId, LocalDateTime assignedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(assignedAt, "assignedAt must not be null");
    task.setAssignedRobotId(Objects.requireNonNull(robotId, "robotId must not be null"));
    task.setStatus(TaskStatus.ASSIGNED);
    task.setCurrentStage(TaskStage.ROUTE_TO_PICKUP);
    task.setStageUpdatedAt(timestamp);
    task.setFailureReason(null);
    task.setCompletedAt(null);
  }

  public void markRunning(Task task, LocalDateTime startedAt) {
    Objects.requireNonNull(startedAt, "startedAt must not be null");
    task.setStatus(TaskStatus.RUNNING);
  }

  public void advanceToLoading(Task task, LocalDateTime updatedAt) {
    updateStage(task, TaskStage.LOADING, updatedAt);
  }

  public void advanceToDropoff(Task task, LocalDateTime updatedAt) {
    updateStage(task, TaskStage.ROUTE_TO_DROPOFF, updatedAt);
  }

  public void pause(Task task, LocalDateTime updatedAt) {
    task.setStatus(TaskStatus.PAUSED);
    task.setStageUpdatedAt(Objects.requireNonNull(updatedAt, "updatedAt must not be null"));
  }

  public void resume(Task task, LocalDateTime updatedAt) {
    task.setStatus(TaskStatus.RUNNING);
    task.setStageUpdatedAt(Objects.requireNonNull(updatedAt, "updatedAt must not be null"));
  }

  public void cancel(Task task, LocalDateTime canceledAt) {
    LocalDateTime timestamp = Objects.requireNonNull(canceledAt, "canceledAt must not be null");
    task.setStatus(TaskStatus.CANCELED);
    task.setCurrentStage(TaskStage.CANCELED);
    task.setStageUpdatedAt(timestamp);
    task.setFailureReason(null);
    task.setCompletedAt(null);
  }

  public void fail(Task task, String failureReason, LocalDateTime failedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(failedAt, "failedAt must not be null");
    task.setStatus(TaskStatus.FAILED);
    task.setCurrentStage(TaskStage.FAILED);
    task.setStageUpdatedAt(timestamp);
    task.setFailureReason(failureReason == null ? "Task execution failed" : failureReason);
    task.setCompletedAt(null);
  }

  public void complete(Task task, LocalDateTime completedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(completedAt, "completedAt must not be null");
    task.setStatus(TaskStatus.DONE);
    task.setCurrentStage(TaskStage.COMPLETED);
    task.setStageUpdatedAt(timestamp);
    task.setCompletedAt(timestamp);
    task.setFailureReason(null);
  }

  private void updateStage(Task task, TaskStage stage, LocalDateTime updatedAt) {
    task.setCurrentStage(Objects.requireNonNull(stage, "stage must not be null"));
    task.setStageUpdatedAt(Objects.requireNonNull(updatedAt, "updatedAt must not be null"));
  }

  private TaskPriority parsePriority(String priority) {
    try {
      return TaskPriority.valueOf(priority == null ? "NORMAL" : priority.toUpperCase());
    } catch (IllegalArgumentException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported priority");
    }
  }

  private ApiDtos.TaskSummaryResponse toTaskSummary(Task task) {
    Floor floor = findFloor(task.getFloorId());
    Location pickup = findLocation(task.getPickupLocationId());
    Location dropoff = findLocation(task.getDropoffLocationId());
    Robot assignedRobot =
        task.getAssignedRobotId() == null ? null : findRobot(task.getAssignedRobotId());
    return viewAssemblerService.toTaskSummary(task, floor, pickup, dropoff, assignedRobot);
  }

  private ApiDtos.TaskDetailResponse toTaskDetail(Task task) {
    Floor floor = findFloor(task.getFloorId());
    Location pickup = findLocation(task.getPickupLocationId());
    Location dropoff = findLocation(task.getDropoffLocationId());
    Robot assignedRobot =
        task.getAssignedRobotId() == null ? null : findRobot(task.getAssignedRobotId());
    return viewAssemblerService.toTaskDetail(task, floor, pickup, dropoff, assignedRobot);
  }

  private Task findTask(Long id) {
    return taskRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found"));
  }

  private Robot findRobot(Long id) {
    return robotRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Robot not found"));
  }

  private Floor findFloor(Long id) {
    return floorRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Floor not found"));
  }

  private IndoorMap findMap(Long id) {
    return mapRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Map not found"));
  }

  private Location findLocation(Long id) {
    return locationRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Location not found"));
  }
}
