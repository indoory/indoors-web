package com.indoory.service;

import com.indoory.config.SessionOperator;
import com.indoory.controller.ApiDtos;
import com.indoory.entity.*;
import com.indoory.entity.Enum.*;
import com.indoory.repository.CommandLogRepository;
import com.indoory.repository.EventLogRepository;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.LocationRepository;
import com.indoory.repository.MapRepository;
import com.indoory.repository.RobotRepository;
import com.indoory.repository.TaskRepository;
import java.math.BigDecimal;
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
  private final FloorRepository floorRepository;
  private final MapRepository mapRepository;
  private final LocationRepository locationRepository;
  private final ViewAssemblerService viewAssemblerService;
  private final ActivityService activityService;
  private final TaskService taskService;
  private final RobotAdapterClient adapterClient;

  @Transactional(readOnly = true)
  public List<ApiDtos.RobotSummaryResponse> getRobots() {
    return robotRepository.findAllByOrderByIdAsc().stream()
        .map(
            robot -> {
              Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
              Floor floor = findFloor(robot.getFloorId());
              IndoorMap map = findMap(robot.getMapId());
              return viewAssemblerService.toRobotSummary(robot, activeTask, floor, map);
            })
        .toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotDetailResponse getRobot(Long robotId) {
    Robot robot = findRobot(robotId);
    Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
    Floor floor = findFloor(robot.getFloorId());
    IndoorMap map = findMap(robot.getMapId());

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
            .toList());
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotStateResponse getRobotState(Long robotId) {
    return viewAssemblerService.toRobotState(findRobot(robotId));
  }

  @Transactional(readOnly = true)
  public ApiDtos.RobotPoseResponse getRobotPose(Long robotId) {
    Robot robot = findRobot(robotId);
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

  @Transactional
  public void updateTelemetry(Long robotId, ApiDtos.TelemetryRequest request) {
    Robot robot = findRobot(robotId);
    RobotStatus newStatus =
        switch (request.status()) {
          case "BUSY" -> RobotStatus.NAVIGATING;
          case "ERROR" -> RobotStatus.ERROR;
          default -> RobotStatus.IDLE;
        };
    BigDecimal x = request.x() != null ? BigDecimal.valueOf(request.x()) : null;
    BigDecimal y = request.y() != null ? BigDecimal.valueOf(request.y()) : null;
    BigDecimal yaw = BigDecimal.valueOf(request.yawDeg());
    robot.applyTelemetry(newStatus, x, y, yaw);
    robotRepository.save(robot);
  }

  @Transactional
  public ApiDtos.RobotSummaryResponse renameRobot(Long robotId, ApiDtos.RobotLabelRequest request) {
    Robot robot = findRobot(robotId);
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
    Robot robot = findRobot(robotId);
    Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
    if (activeTask != null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Robot already has an active task");
    }

    Location location =
        locationRepository
            .findById(request.locationId())
            .orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Location not found"));
    Floor floor = findFloor(location.getFloorId());

    robot.markPlanning();
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

    adapterClient.dispatch(request.locationId());
  }

  @Transactional
  public void pause(Long robotId, SessionOperator operator) {
    Robot robot = findRobot(robotId);
    Task task = taskService.findActiveTaskForRobot(robot.getId());
    if (task == null) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "No active task to pause");
    }

    LocalDateTime now = LocalDateTime.now();
    taskService.pause(task, now);
    taskRepository.save(task);

    robot.pause();
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

    adapterClient.pause();
  }

  @Transactional
  public void resume(Long robotId, SessionOperator operator) {
    Robot robot = findRobot(robotId);
    Task task = taskService.findActiveTaskForRobot(robot.getId());
    if (task == null || task.getStatus() != TaskStatus.PAUSED) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "No paused task to resume");
    }

    LocalDateTime now = LocalDateTime.now();
    taskService.resume(task, now);
    taskRepository.save(task);

    robot.markNavigating();
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

    adapterClient.resume();
  }

  @Transactional
  public void emergencyStop(Long robotId, SessionOperator operator) {
    Robot robot = findRobot(robotId);
    Task task = taskService.findActiveTaskForRobot(robot.getId());
    LocalDateTime now = LocalDateTime.now();

    robot.emergencyStop("Emergency stop engaged");
    robotRepository.save(robot);

    if (task != null) {
      taskService.fail(task, "Emergency stop engaged by operator", now);
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

    adapterClient.emergencyStop();
  }

  @Transactional
  public ApiDtos.RobotSummaryResponse createRobot(
      ApiDtos.CreateRobotRequest request, SessionOperator operator) {
    IndoorMap map = findMap(request.mapId());
    Floor floor = findFloor(request.floorId());
    if (!floor.getMapId().equals(map.getId())) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Floor does not belong to the map");
    }

    Robot robot =
        Robot.builder()
            .robotCode(request.robotCode())
            .label(request.label())
            .status(RobotStatus.IDLE)
            .batteryLevel(100)
            .mapId(request.mapId())
            .floorId(request.floorId())
            .poseX(request.poseX() != null ? request.poseX() : BigDecimal.ZERO)
            .poseY(request.poseY() != null ? request.poseY() : BigDecimal.ZERO)
            .yawDeg(BigDecimal.ZERO)
            .build();
    robotRepository.save(robot);

    activityService.recordEvent(
        robot.getId(),
        null,
        EventSeverity.INFO,
        "ROBOT",
        "Robot " + robot.getLabel() + " created by " + operator.email());

    return viewAssemblerService.toRobotSummary(robot, null, floor, map);
  }

  @Transactional
  public void deleteRobot(Long robotId, SessionOperator operator) {
    Robot robot = findRobot(robotId);
    Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
    if (activeTask != null) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT, "Cannot delete robot with active task");
    }

    robotRepository.delete(robot);

    activityService.recordEvent(
        null,
        null,
        EventSeverity.WARN,
        "ROBOT",
        "Robot " + robot.getLabel() + " deleted by " + operator.email());
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

  private Task taskForEvent(EventLog event) {
    if (event.getTaskId() == null) {
      return null;
    }
    return taskRepository.findById(event.getTaskId()).orElse(null);
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
