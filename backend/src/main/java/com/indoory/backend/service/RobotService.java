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
import com.indoory.backend.entity.TaskStatus;
import com.indoory.backend.repository.CommandLogRepository;
import com.indoory.backend.repository.EventLogRepository;
import com.indoory.backend.repository.FloorRepository;
import com.indoory.backend.repository.LocationRepository;
import com.indoory.backend.repository.MapRepository;
import com.indoory.backend.repository.RobotRepository;
import com.indoory.backend.repository.RobotStateSnapshotRepository;
import com.indoory.backend.repository.TaskRepository;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class RobotService {

  private final RobotRepository robotRepository;
  private final TaskRepository taskRepository;
  private final CommandLogRepository commandLogRepository;
  private final EventLogRepository eventLogRepository;
  private final RobotStateSnapshotRepository robotStateSnapshotRepository;
  private final FloorRepository floorRepository;
  private final MapRepository mapRepository;
  private final LocationRepository locationRepository;
  private final ViewAssemblerService viewAssemblerService;
  private final ActivityService activityService;
  private final TaskService taskService;

  @Transactional(readOnly = true)
  public List<ApiDtos.RobotSummaryResponse> getRobots() {
    return robotRepository.findAllByOrderByIdAsc().stream()
        .map(
            robot -> {
              TaskEntity activeTask = taskService.findActiveTaskForRobot(robot.getId());
              FloorEntity floor = findFloor(robot.getFloorId());
              MapEntity map = findMap(robot.getMapId());
              return viewAssemblerService.toRobotSummary(robot, activeTask, floor, map);
            })
        .toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotDetailResponse getRobot(Long robotId) {
    RobotEntity robot = findRobot(robotId);
    TaskEntity activeTask = taskService.findActiveTaskForRobot(robot.getId());
    FloorEntity floor = findFloor(robot.getFloorId());
    MapEntity map = findMap(robot.getMapId());

    return new ApiDtos.RobotDetailResponse(
        viewAssemblerService.toRobotSummary(robot, activeTask, floor, map),
        viewAssemblerService.toRobotState(robot),
        viewAssemblerService.toRobotPose(robot, map, floor),
        activeTask == null ? null : toTaskDetail(activeTask),
        commandLogRepository.findAllByRobotIdOrderByCreatedAtDesc(robot.getId()).stream()
            .map(viewAssemblerService::toCommandLog)
            .toList(),
        taskRepository.findAllByAssignedRobotIdOrderByCreatedAtDesc(robot.getId()).stream()
            .map(this::toTaskSummary)
            .toList(),
        eventLogRepository.findAllByRobotIdOrderByCreatedAtDesc(robot.getId()).stream()
            .map(event -> viewAssemblerService.toEventLog(event, robot, taskForEvent(event)))
            .toList(),
        robotStateSnapshotRepository.findTop20ByRobotIdOrderByRecordedAtDesc(robot.getId()).stream()
            .map(viewAssemblerService::toSnapshot)
            .toList());
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotStateResponse getRobotState(Long robotId) {
    return viewAssemblerService.toRobotState(findRobot(robotId));
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotPoseResponse getRobotPose(Long robotId) {
    RobotEntity robot = findRobot(robotId);
    return viewAssemblerService.toRobotPose(
        robot, findMap(robot.getMapId()), findFloor(robot.getFloorId()));
  }

  @Transactional(readOnly = true)
  public List<ApiDtos.TaskSummaryResponse> getRobotTasks(Long robotId) {
    return taskRepository.findAllByAssignedRobotIdOrderByCreatedAtDesc(robotId).stream()
        .map(this::toTaskSummary)
        .toList();
  }

  @Transactional(readOnly = true)
  public List<ApiDtos.CommandLogResponse> getRobotCommands(Long robotId) {
    return commandLogRepository.findAllByRobotIdOrderByCreatedAtDesc(robotId).stream()
        .map(viewAssemblerService::toCommandLog)
        .toList();
  }

  @Transactional(readOnly = true)
  public List<ApiDtos.RobotStateSnapshotResponse> getRobotLogs(Long robotId) {
    return robotStateSnapshotRepository.findTop20ByRobotIdOrderByRecordedAtDesc(robotId).stream()
        .map(viewAssemblerService::toSnapshot)
        .toList();
  }

  @Transactional
  public ApiDtos.RobotSummaryResponse renameRobot(Long robotId, ApiDtos.RobotLabelRequest request) {
    RobotEntity robot = findRobot(robotId);
    try {
      robot.rename(request.label());
    } catch (IllegalArgumentException exception) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, exception.getMessage(), exception);
    }
    robotRepository.save(robot);
    return viewAssemblerService.toRobotSummary(
        robot,
        taskService.findActiveTaskForRobot(robot.getId()),
        findFloor(robot.getFloorId()),
        findMap(robot.getMapId()));
  }

  @Transactional
  public void dispatch(
      Long robotId, ApiDtos.DispatchCommandRequest request, SessionOperator operator) {
    RobotEntity robot = findRobot(robotId);
    TaskEntity activeTask = taskService.findActiveTaskForRobot(robot.getId());
    if (activeTask != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Robot already has an active task");
    }

    LocationEntity location =
        locationRepository
            .findById(request.locationId())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Location not found"));
    FloorEntity floor = findFloor(location.getFloorId());
    LocalDateTime now = LocalDateTime.now();

    robot.markPlanning(now);
    robotRepository.save(robot);

    activityService.recordCommand(
        robot.getId(),
        null,
        CommandType.DISPATCH,
        "goal: " + location.getName() + ", floor: " + floor.getCode(),
        CommandExecutionStatus.EXECUTING,
        operator.email());
    activityService.recordEvent(
        robot.getId(),
        null,
        EventSeverity.INFO,
        "COMMAND",
        "Manual dispatch requested for " + robot.getLabel() + " to " + location.getName());
    activityService.captureSnapshot(robot);
  }

  @Transactional
  public void pause(Long robotId, SessionOperator operator) {
    RobotEntity robot = findRobot(robotId);
    TaskEntity task = taskService.findActiveTaskForRobot(robot.getId());
    if (task == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "No active task to pause");
    }

    LocalDateTime now = LocalDateTime.now();
    task.pause(now);
    taskRepository.save(task);

    robot.pause(now);
    robotRepository.save(robot);

    activityService.recordCommand(
        robot.getId(),
        task.getId(),
        CommandType.PAUSE,
        "",
        CommandExecutionStatus.DONE,
        operator.email());
    activityService.recordEvent(
        robot.getId(),
        task.getId(),
        EventSeverity.WARN,
        "TASK",
        "Task " + task.getTaskCode() + " paused by " + operator.email());
    activityService.captureSnapshot(robot);
  }

  @Transactional
  public void resume(Long robotId, SessionOperator operator) {
    RobotEntity robot = findRobot(robotId);
    TaskEntity task = taskService.findActiveTaskForRobot(robot.getId());
    if (task == null || task.getStatus() != TaskStatus.PAUSED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "No paused task to resume");
    }

    LocalDateTime now = LocalDateTime.now();
    task.resume(now);
    taskRepository.save(task);

    robot.markNavigating(now);
    robotRepository.save(robot);

    activityService.recordCommand(
        robot.getId(),
        task.getId(),
        CommandType.RESUME,
        "",
        CommandExecutionStatus.DONE,
        operator.email());
    activityService.recordEvent(
        robot.getId(),
        task.getId(),
        EventSeverity.INFO,
        "TASK",
        "Task " + task.getTaskCode() + " resumed by " + operator.email());
    activityService.captureSnapshot(robot);
  }

  @Transactional
  public void emergencyStop(Long robotId, SessionOperator operator) {
    RobotEntity robot = findRobot(robotId);
    TaskEntity task = taskService.findActiveTaskForRobot(robot.getId());
    LocalDateTime now = LocalDateTime.now();

    robot.emergencyStop("Emergency stop engaged", now);
    robotRepository.save(robot);

    if (task != null) {
      task.fail("Emergency stop engaged by operator", now);
      taskRepository.save(task);
    }

    activityService.recordCommand(
        robot.getId(),
        task == null ? null : task.getId(),
        CommandType.EMERGENCY_STOP,
        "",
        CommandExecutionStatus.DONE,
        operator.email());
    activityService.recordEvent(
        robot.getId(),
        task == null ? null : task.getId(),
        EventSeverity.ERROR,
        "COMMAND",
        "Emergency stop triggered for " + robot.getLabel() + " by " + operator.email());
    activityService.captureSnapshot(robot);
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

  private TaskEntity taskForEvent(com.indoory.backend.entity.EventLogEntity event) {
    if (event.getTaskId() == null) {
      return null;
    }
    return taskRepository.findById(event.getTaskId()).orElse(null);
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
