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

  @Transactional
  public List<ApiDtos.RobotSummaryResponse> getRobots() {
    return robotRepository.findAllByOrderByIdAsc().stream()
        .map(
            robot -> {
              ensureCurrentMap(robot);
              Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
              Floor floor = robot.getFloorId() == null ? null : findFloorOrNull(robot.getFloorId());
              IndoorMap map = robot.getMapId() == null ? null : findMapOrNull(robot.getMapId());
              return viewAssemblerService.toRobotSummary(robot, activeTask, floor, map);
            })
        .toList();
  }

  /**
   * 로봇이 항상 현재 매핑 세션에 대응하는 IndoorMap 을 가지고 있도록 보장.
   *
   * <p>mapId 가 null 이거나 referenced map 이 삭제됐으면 'Untitled-{ts}' 새 row 생성 후 연결.
   * 새 row 의 rtabmap_db_path 는 ~/.ros/rtabmap.db (working DB) 을 가리키게 함 →
   * RTAB-Map 의 작업 파일과 RDB row 가 1:1 연결. size 도 매번 fetch 시 갱신해
   * 사용자가 실시간으로 누적량 확인 가능.
   */
  @Transactional
  public void ensureCurrentMap(Robot robot) {
    java.nio.file.Path workingDb = java.nio.file.Paths.get(
        System.getProperty("user.home"), ".ros", "rtabmap.db");
    Long mid = robot.getMapId();
    IndoorMap map;
    if (mid != null) {
      var opt = mapRepository.findById(mid);
      if (opt.isPresent()) {
        map = opt.get();
        // draft 상태(Untitled — snapshot 으로 promote 안 됨)면 working file 크기 갱신.
        boolean isDraft = "Untitled".equals(map.getName())
            || map.getRtabmapDbPath() == null
            || map.getRtabmapDbPath().contains(".ros/rtabmap.db");
        if (isDraft && java.nio.file.Files.exists(workingDb)) {
          try {
            map.recordRtabmapDb(workingDb.toString(), java.nio.file.Files.size(workingDb));
            mapRepository.save(map);
          } catch (Exception ignored) {}
        }
        return;
      }
    }
    // 신규 Untitled 생성 — working file 가리키게.
    String code = "session-" + System.currentTimeMillis();
    IndoorMap fresh = new IndoorMap(code, "Untitled");
    if (java.nio.file.Files.exists(workingDb)) {
      try {
        fresh.recordRtabmapDb(workingDb.toString(), java.nio.file.Files.size(workingDb));
      } catch (Exception ignored) {}
    }
    mapRepository.save(fresh);
    try {
      java.lang.reflect.Field f = Robot.class.getDeclaredField("mapId");
      f.setAccessible(true);
      f.set(robot, fresh.getId());
      robotRepository.save(robot);
    } catch (Exception ignored) {}
  }

  @Transactional
  public ApiDtos.RobotDetailResponse getRobot(Long robotId) {
    Robot robot = findRobot(robotId);
    Task activeTask = taskService.findActiveTaskForRobot(robot.getId());
    ensureCurrentMap(robot);
    Floor floor = robot.getFloorId() == null ? null : findFloorOrNull(robot.getFloorId());
    IndoorMap map = robot.getMapId() == null ? null : findMapOrNull(robot.getMapId());

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
        robot,
        robot.getMapId() == null ? null : findMapOrNull(robot.getMapId()),
        robot.getFloorId() == null ? null : findFloorOrNull(robot.getFloorId()));
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

  /** 사용자가 'Save Map' 또는 'Load Map' 후 robot.mapId 갱신. Unknown session 종료. */
  @Transactional
  public void assignMapToRobot(Long robotId, Long mapId) {
    Robot robot = findRobot(robotId);
    java.lang.reflect.Field f;
    try {
      f = Robot.class.getDeclaredField("mapId");
      f.setAccessible(true);
      f.set(robot, mapId);
      robotRepository.save(robot);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to assign mapId", e);
    }
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

  /** "Unknown session" 안전 — id 가 NULL/없는 경우 예외 안 던지고 null 반환. */
  private Floor findFloorOrNull(Long id) {
    return id == null ? null : floorRepository.findById(id).orElse(null);
  }

  private IndoorMap findMapOrNull(Long id) {
    return id == null ? null : mapRepository.findById(id).orElse(null);
  }

  private Location findLocation(Long id) {
    return locationRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Location not found"));
  }
}
