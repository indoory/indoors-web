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
   * 로봇이 이미 맵에 묶여 있으면 working DB 크기만 새로고침. 묶여 있지 않으면 (Unknown
   * session) 그대로 둔다 — 운영자/OCR 이 명시적으로 floor 를 지정해야만 mapId 가 채워진다.
   *
   * <p>이전 버전은 mapId==null 이면 'Untitled-{ts}' 를 자동 생성해 강제 재연결했으나,
   * 그게 "맵 삭제 → robot.mapId NULL 화" detach 를 즉시 무효화시켜서 운영자 제어를 빼앗는다.
   * 더 이상 자동 라벨링 X — Unknown session 은 정당한 상태로 인정.
   */
  @Transactional
  public void ensureCurrentMap(Robot robot) {
    Long mid = robot.getMapId();
    if (mid == null) return;
    var opt = mapRepository.findById(mid);
    if (opt.isEmpty()) {
      // 댕글링 참조 — 맵이 사라졌는데 robot.mapId 가 살아있는 (드물지만 가능한) 케이스.
      // detach 하고 Unknown session 으로 복귀.
      try {
        java.lang.reflect.Field f = Robot.class.getDeclaredField("mapId");
        java.lang.reflect.Field g = Robot.class.getDeclaredField("floorId");
        f.setAccessible(true); g.setAccessible(true);
        f.set(robot, null); g.set(robot, null);
        robotRepository.save(robot);
      } catch (Exception ignored) {}
      return;
    }
    // 옛날 버전은 path 가 ".ros/rtabmap.db" 면 isDraft=true 로 보고 매번 working DB
    // 로 path 갱신했는데, 이게 promote 후 STORAGE_DIR/{id}.db 로 옮긴 path 를
    // 다음 getRobots() 호출이 다시 working DB 로 덮어쓰는 sticky bug 였음.
    // 이제는 ensureCurrentMap 이 path 를 변경하지 않음 — promote/adopt 시점에
    // 한 번 set 된 path 가 그대로 유지된다. row 갱신은 명시적 save 시점에만.
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

  /** 세션 시작 시 floorId 갱신. mapId 와 함께 호출되는 게 일반적. */
  @Transactional
  public void assignFloorToRobot(Long robotId, Long floorId) {
    Robot robot = findRobot(robotId);
    try {
      java.lang.reflect.Field f = Robot.class.getDeclaredField("floorId");
      f.setAccessible(true);
      f.set(robot, floorId);
      robotRepository.save(robot);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to assign floorId", e);
    }
  }

  /** 컨트롤러가 robot.mapId 만 가볍게 조회할 때 사용. 외부 노출 OK. */
  @Transactional(readOnly = true)
  public Long getRobotMapId(Long robotId) {
    return findRobot(robotId).getMapId();
  }

  /** ROS 재시작 신호 — 모든 robot detach. adapter `_on_startup` 이 호출.
   *  반환 = detach 된 robot 수 (디버그/로그용). */
  @Transactional
  public int detachAllRobots() {
    int count = 0;
    for (Robot robot : robotRepository.findAll()) {
      try {
        var mapField = Robot.class.getDeclaredField("mapId");
        var floorField = Robot.class.getDeclaredField("floorId");
        mapField.setAccessible(true);
        floorField.setAccessible(true);
        mapField.set(robot, null);
        floorField.set(robot, null);
        robotRepository.save(robot);
        count++;
      } catch (Exception ignored) {}
    }
    return count;
  }

  /** Robot.mapId/floorId 둘 다 NULL 화 — Unknown session 강제 (운영자가 '다른 층으로'
   *  명시할 때 호출). 다음 health 응답에서 isDraft=true → frontend modal 자동 노출. */
  @Transactional
  public void detachRobotMapAndFloor(Long robotId) {
    Robot robot = findRobot(robotId);
    try {
      var mapField = Robot.class.getDeclaredField("mapId");
      var floorField = Robot.class.getDeclaredField("floorId");
      mapField.setAccessible(true);
      floorField.setAccessible(true);
      mapField.set(robot, null);
      floorField.set(robot, null);
      robotRepository.save(robot);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to detach robot " + robotId, e);
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

    // ESTOP 해제 — 활성 task 없어도 그냥 IDLE 로 되돌림. 한 번 EMERGENCY_STOP 이면
    // resume 시 무조건 reset (sticky 막음). adapter 도 풀어줌 (cmd_vel 0,0 잠시).
    if (robot.getStatus() == com.indoory.entity.Enum.RobotStatus.EMERGENCY_STOP) {
      robot.markIdle();
      robotRepository.save(robot);
      activityService.recordCommand(
          robot.getId(), null,
          CommandType.RESUME, "estop-clear",
          CommandExecutionStatus.DONE, operator.email());
      activityService.recordEvent(
          robot.getId(), null,
          EventSeverity.INFO, "ROBOT",
          "Emergency stop cleared by " + operator.email());
      adapterClient.resume();
      return;
    }

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

    // 1) adapter 에 cancel_event 호출 — SLAM/explore/spin 종료 + cmd_vel (0,0) burst.
    //    실제 모션이 즉시 멈춤.
    adapterClient.emergencyStop();

    // 2) 진행 중 task 가 있으면 fail 처리.
    if (task != null) {
      taskService.fail(task, "Emergency stop engaged by operator", now);
      taskRepository.save(task);
    }

    // 3) robot 상태는 IDLE 로 복귀 — sticky EMERGENCY_STOP 막음.
    //    멈춘 후 다시 명령 받을 준비된 상태가 자연스러움.
    robot.markIdle();
    robotRepository.save(robot);

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
