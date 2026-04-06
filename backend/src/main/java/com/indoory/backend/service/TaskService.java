package com.indoory.backend.service;

import com.indoory.backend.api.ApiDtos;
import com.indoory.backend.config.SessionOperator;
import com.indoory.backend.entity.CommandExecutionStatus;
import com.indoory.backend.entity.CommandType;
import com.indoory.backend.entity.EventSeverity;
import com.indoory.backend.entity.FloorEntity;
import com.indoory.backend.entity.LocationEntity;
import com.indoory.backend.entity.MapEntity;
import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.TaskEntity;
import com.indoory.backend.entity.TaskPriority;
import com.indoory.backend.entity.TaskStatus;
import com.indoory.backend.repository.FloorRepository;
import com.indoory.backend.repository.LocationRepository;
import com.indoory.backend.repository.MapRepository;
import com.indoory.backend.repository.RobotRepository;
import com.indoory.backend.repository.TaskRepository;
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
    LocationEntity pickup = findLocation(request.pickupLocationId());
    LocationEntity dropoff = findLocation(request.dropoffLocationId());

    if (pickup.getId().equals(dropoff.getId())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST, "Pickup and dropoff must be different locations");
    }

    if (!pickup.getFloorId().equals(dropoff.getFloorId())) {
      throw new ResponseStatusException(
          HttpStatus.BAD_REQUEST,
          "MVP task creation requires pickup and dropoff on the same floor");
    }

    FloorEntity floor = findFloor(pickup.getFloorId());
    MapEntity map = findMap(floor.getMapId());
    LocalDateTime now = LocalDateTime.now();

    TaskEntity task =
        taskRepository.save(
            TaskEntity.createDelivery(
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
    TaskEntity task = findTask(taskId);

    if (task.isTerminal()) {
      return;
    }

    LocalDateTime now = LocalDateTime.now();
    task.cancel(now);
    taskRepository.save(task);

    if (task.getAssignedRobotId() != null) {
      RobotEntity robot = findRobot(task.getAssignedRobotId());
      robot.markIdle(now);
      robotRepository.save(robot);
      activityService.captureSnapshot(robot);
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
  public void dispatchQueuedTasks() {
    for (TaskEntity queuedTask :
        taskRepository.findAllByStatusOrderByCreatedAtAsc(TaskStatus.CREATED)) {
      tryAssignTask(queuedTask, SYSTEM_ISSUER);
    }
  }

  @Transactional(readOnly = true)
  public TaskEntity findActiveTaskForRobot(Long robotId) {
    return taskRepository
        .findFirstByAssignedRobotIdAndStatusInOrderByCreatedAtDesc(robotId, ACTIVE_TASK_STATUSES)
        .orElse(null);
  }

  private RobotEntity selectRobot(Long mapId, Long floorId) {
    Set<Long> busyRobotIds =
        taskRepository.findAllByStatusInOrderByCreatedAtDesc(ACTIVE_TASK_STATUSES).stream()
            .map(TaskEntity::getAssignedRobotId)
            .filter(Objects::nonNull)
            .collect(java.util.stream.Collectors.toSet());

    return taskDispatchPolicy.selectRobot(
        robotRepository.findAllByOrderByIdAsc(), busyRobotIds, mapId, floorId);
  }

  private boolean tryAssignTask(TaskEntity task, String issuedBy) {
    RobotEntity candidate = selectRobot(task.getMapId(), task.getFloorId());
    if (candidate == null) {
      return false;
    }

    LocationEntity pickup = findLocation(task.getPickupLocationId());
    LocationEntity dropoff = findLocation(task.getDropoffLocationId());
    LocalDateTime now = LocalDateTime.now();

    task.assignTo(candidate.getId(), now);
    taskRepository.save(task);

    candidate.markPlanning(now);
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
    activityService.captureSnapshot(candidate);
    return true;
  }

  private String nextTaskCode() {
    long nextId = taskRepository.findTopByOrderByIdDesc().map(TaskEntity::getId).orElse(4000L) + 1L;
    return "TSK-" + nextId;
  }

  private TaskPriority parsePriority(String priority) {
    try {
      return TaskPriority.valueOf(priority == null ? "NORMAL" : priority.toUpperCase());
    } catch (IllegalArgumentException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unsupported priority");
    }
  }

  private ApiDtos.TaskSummaryResponse toTaskSummary(TaskEntity task) {
    FloorEntity floor = findFloor(task.getFloorId());
    LocationEntity pickup = findLocation(task.getPickupLocationId());
    LocationEntity dropoff = findLocation(task.getDropoffLocationId());
    RobotEntity assignedRobot =
        task.getAssignedRobotId() == null ? null : findRobot(task.getAssignedRobotId());
    return viewAssemblerService.toTaskSummary(task, floor, pickup, dropoff, assignedRobot);
  }

  private ApiDtos.TaskDetailResponse toTaskDetail(TaskEntity task) {
    FloorEntity floor = findFloor(task.getFloorId());
    LocationEntity pickup = findLocation(task.getPickupLocationId());
    LocationEntity dropoff = findLocation(task.getDropoffLocationId());
    RobotEntity assignedRobot =
        task.getAssignedRobotId() == null ? null : findRobot(task.getAssignedRobotId());
    return viewAssemblerService.toTaskDetail(task, floor, pickup, dropoff, assignedRobot);
  }

  private TaskEntity findTask(Long id) {
    return taskRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Task not found"));
  }

  private RobotEntity findRobot(Long id) {
    return robotRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Robot not found"));
  }

  private FloorEntity findFloor(Long id) {
    return floorRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Floor not found"));
  }

  private MapEntity findMap(Long id) {
    return mapRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Map not found"));
  }

  private LocationEntity findLocation(Long id) {
    return locationRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Location not found"));
  }
}
