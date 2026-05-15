package com.indoory.controller;

import com.indoory.config.SessionOperator;
import com.indoory.entity.Floor;
import com.indoory.entity.IndoorMap;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.MapRepository;
import com.indoory.service.RobotAdapterClient;
import com.indoory.service.RobotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/robots")
@RequiredArgsConstructor
@Tag(name = "Robots", description = "Robot inventory, state, pose, command, and history endpoints")
public class RobotController {

  private final RobotService robotService;
  private final RobotAdapterClient adapterClient;
  private final FloorRepository floorRepository;
  private final MapRepository mapRepository;
  private final com.indoory.service.MapService mapService;
  private final com.indoory.service.ActivityService activityService;

  @Operation(summary = "Create robot", description = "Creates a new robot.")
  @PostMapping
  public ApiDtos.RobotSummaryResponse createRobot(
      @Valid @RequestBody ApiDtos.CreateRobotRequest request, Authentication authentication) {
    return robotService.createRobot(request, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(summary = "List robots", description = "Returns the full robot fleet summary.")
  @GetMapping
  public List<ApiDtos.RobotSummaryResponse> getRobots() {
    return robotService.getRobots();
  }

  @Operation(
      summary = "Get robot detail",
      description = "Returns robot state, pose, active task, command history, and events.")
  @GetMapping("/{robotId}")
  public ApiDtos.RobotDetailResponse getRobot(@PathVariable Long robotId) {
    return robotService.getRobot(robotId);
  }

  @Operation(
      summary = "Get robot state",
      description = "Returns the latest status and health information for a robot.")
  @GetMapping("/{robotId}/state")
  public ApiDtos.RobotStateResponse getRobotState(@PathVariable Long robotId) {
    return robotService.getRobotState(robotId);
  }

  @Operation(
      summary = "Get robot pose",
      description = "Returns the latest pose for a robot on the active map.")
  @GetMapping("/{robotId}/pose")
  public ApiDtos.RobotPoseResponse getRobotPose(@PathVariable Long robotId) {
    return robotService.getRobotPose(robotId);
  }

  @Operation(summary = "Rename robot", description = "Updates the operator-visible robot label.")
  @PatchMapping("/{robotId}/label")
  public ApiDtos.RobotSummaryResponse renameRobot(
      @PathVariable Long robotId, @Valid @RequestBody ApiDtos.RobotLabelRequest request) {
    return robotService.renameRobot(robotId, request);
  }

  @Operation(
      summary = "Get robot task history",
      description = "Returns tasks previously assigned to a robot.")
  @GetMapping("/{robotId}/tasks")
  public List<ApiDtos.TaskSummaryResponse> getRobotTasks(@PathVariable Long robotId) {
    return robotService.getRobotTasks(robotId);
  }

  @Operation(summary = "Get command history", description = "Returns command history for a robot.")
  @GetMapping("/{robotId}/commands")
  public List<ApiDtos.CommandLogResponse> getRobotCommands(@PathVariable Long robotId) {
    return robotService.getRobotCommands(robotId);
  }

  @Operation(
      summary = "Dispatch robot",
      description = "Sends a direct robot dispatch command to a target location.")
  @PostMapping("/{robotId}/commands/dispatch")
  public void dispatch(
      @PathVariable Long robotId,
      @Valid @RequestBody ApiDtos.DispatchCommandRequest request,
      Authentication authentication) {
    // 진행 중 다른 long-running 명령 close — 1 robot = 1 active. RobotService.dispatch
    // 가 EXECUTING 으로 새 row 만드므로 그 직전에 close.
    activityService.closeActiveCommand(
        robotId, com.indoory.entity.Enum.CommandExecutionStatus.CANCELED,
        "superseded by DISPATCH");
    robotService.dispatch(robotId, request, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(
      summary = "Pause robot task",
      description = "Pauses the active task currently assigned to the robot.")
  @PostMapping("/{robotId}/commands/pause")
  public void pause(@PathVariable Long robotId, Authentication authentication) {
    robotService.pause(robotId, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(summary = "Resume robot task", description = "Resumes a paused task on the robot.")
  @PostMapping("/{robotId}/commands/resume")
  public void resume(@PathVariable Long robotId, Authentication authentication) {
    robotService.resume(robotId, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(
      summary = "Emergency stop",
      description =
          "Immediately transitions the robot into emergency stop and fails its active task.")
  @PostMapping("/{robotId}/commands/emergency-stop")
  public void emergencyStop(@PathVariable Long robotId, Authentication authentication) {
    robotService.emergencyStop(robotId, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(
      summary = "Update robot telemetry",
      description =
          "Receives live position and status updates from the adapter. No session auth required.")
  @PutMapping("/{robotId}/telemetry")
  public void updateTelemetry(
      @PathVariable Long robotId, @RequestBody ApiDtos.TelemetryRequest request) {
    robotService.updateTelemetry(robotId, request);
  }

  @Operation(
      summary = "Set initial pose",
      description = "Sends the robot's initial localization pose to the adapter.")
  @PostMapping("/{robotId}/initial-pose")
  public void setInitialPose(
      @PathVariable Long robotId, @RequestBody ApiDtos.InitialPoseRequest request) {
    adapterClient.setInitialPose(request.x(), request.y(), request.yaw());
  }

  // ── SLAM ──────────────────────────────────────────────────────────────────

  @Operation(summary = "Start SLAM", description = "Starts SLAM mapping on the adapter.")
  @PostMapping("/{robotId}/slam/start")
  public void startSlam(@PathVariable Long robotId) {
    adapterClient.startSlam();
  }

  @Operation(
      summary = "Start SLAM auto-explore",
      description = "Starts autonomous exploration for SLAM map building.")
  @PostMapping("/{robotId}/slam/explore/start")
  public void startSlamExplore(@PathVariable Long robotId, Authentication authentication) {
    String issuer = (authentication != null && authentication.getPrincipal() instanceof SessionOperator op)
        ? op.email() : "operator";
    // 옛 EXECUTING 명령 (다른 long-running) close → 1 robot = 1 active command 불변량.
    activityService.closeActiveCommand(
        robotId, com.indoory.entity.Enum.CommandExecutionStatus.CANCELED,
        "superseded by SLAM_EXPLORE_START");
    activityService.recordCommand(
        robotId, null, com.indoory.entity.Enum.CommandType.SLAM_EXPLORE_START,
        "{}", com.indoory.entity.Enum.CommandExecutionStatus.EXECUTING, issuer);
    adapterClient.startSlamExplore();
  }

  @Operation(
      summary = "Get SLAM explore status",
      description = "Returns explore status from the adapter. Poll until exploreStatus=idle.")
  @GetMapping("/{robotId}/slam/explore/status")
  public Map<String, Object> getSlamExploreStatus(@PathVariable Long robotId) {
    return adapterClient.getSlamExploreStatus();
  }

  @Operation(
      summary = "Save SLAM map",
      description =
          "어댑터가 RTAB-Map .db 백업 후 Spring 의 /api/maps/{mapId}/rtabmap-db 로 blob 푸시.")
  @PostMapping("/{robotId}/slam/save")
  public void saveSlam(@PathVariable Long robotId, @RequestBody ApiDtos.SlamSaveRequest request) {
    adapterClient.saveSlam(request.mapId(), request.mapName());
  }

  @Operation(summary = "Stop SLAM", description = "Stops the SLAM process on the adapter.")
  @PostMapping("/{robotId}/slam/stop")
  public void stopSlam(@PathVariable Long robotId, Authentication authentication) {
    String issuer = (authentication != null && authentication.getPrincipal() instanceof SessionOperator op)
        ? op.email() : "operator";
    // 진행 중 SLAM_EXPLORE_START 가 있으면 DONE 으로 close.
    activityService.closeActiveCommand(
        robotId, com.indoory.entity.Enum.CommandExecutionStatus.DONE, "stopped by operator");
    // SLAM_STOP 자체는 즉시 DONE 으로 record (이력 보존).
    activityService.recordCommand(
        robotId, null, com.indoory.entity.Enum.CommandType.SLAM_STOP,
        "{}", com.indoory.entity.Enum.CommandExecutionStatus.DONE, issuer);
    adapterClient.stopSlam();
  }

  // ── 멀티세션 SLAM 확장 ───────────────────────────────────────────────
  @Operation(
      summary = "Set robot floor (load .db)",
      description =
          "지정 floorId 의 부모 맵에 저장된 RTAB-Map .db blob 을 어댑터로 전송해 rtabmap reload.")
  @PostMapping("/{robotId}/floor/set")
  public Map<String, Object> setFloor(
      @PathVariable Long robotId, @RequestBody ApiDtos.FloorSetRequest request) {
    Floor floor =
        floorRepository
            .findById(request.floorId())
            .orElseThrow(() -> new IllegalArgumentException("floor not found"));
    IndoorMap map =
        mapRepository
            .findById(floor.getMapId())
            .orElseThrow(() -> new IllegalArgumentException("map not found"));

    // 맵이 저장돼 있으면: blob 푸시 → adapter 가 rtabmap localization 모드로 reload
    // 없으면 : adapter 에 fresh-mapping 신호 → rtabmap reset + mapping 모드 (새 맵)
    if (map.getRtabmapDbPath() != null) {
      java.nio.file.Path dbPath = java.nio.file.Paths.get(map.getRtabmapDbPath());
      if (java.nio.file.Files.exists(dbPath)) {
        try {
          long size = java.nio.file.Files.size(dbPath);
          adapterClient.setFloor(floor.getCode(), dbPath);
          return Map.of(
              "ok", true,
              "mode", "localization",
              "floorCode", floor.getCode(),
              "blobBytes", size);
        } catch (java.io.IOException e) {
          return Map.of("ok", false, "reason", "failed to stat db: " + e.getMessage());
        }
      } else {
        return Map.of("ok", false, "reason", "db file missing: " + dbPath);
      }
    } else {
      adapterClient.setFloorFresh(floor.getCode());
      return Map.of(
          "ok", true,
          "mode", "mapping",
          "floorCode", floor.getCode(),
          "note", "no saved map — starting fresh mapping");
    }
  }

  @Operation(
      summary = "Spin & relocalize",
      description = "로봇이 한 바퀴 회전하면서 RTAB-Map BoW 매칭으로 맵 위 자기 위치 추정.")
  @PostMapping("/{robotId}/relocalize")
  public Map<String, Object> relocalize(@PathVariable Long robotId, Authentication authentication) {
    String issuer = (authentication != null && authentication.getPrincipal() instanceof SessionOperator op)
        ? op.email() : "operator";
    activityService.closeActiveCommand(
        robotId, com.indoory.entity.Enum.CommandExecutionStatus.CANCELED,
        "superseded by RELOCALIZE");
    var cmd = activityService.recordCommand(
        robotId, null, com.indoory.entity.Enum.CommandType.RELOCALIZE,
        "{}", com.indoory.entity.Enum.CommandExecutionStatus.EXECUTING, issuer);
    Map<String, Object> result = adapterClient.relocalize();
    // adapter 응답에 따라 마무리. converged=true → DONE. 아니면 FAILED (정확히는
    // "spin 끝까지 매칭 X" 라 운영적으로 fail 로 표시 — 사용자가 다시 trigger 가능).
    boolean converged = Boolean.TRUE.equals(result.get("converged"));
    activityService.markCommandFinished(
        cmd.getId(),
        converged ? com.indoory.entity.Enum.CommandExecutionStatus.DONE
                  : com.indoory.entity.Enum.CommandExecutionStatus.FAILED,
        result.toString());
    return result;
  }

  @Operation(summary = "System health", description = "어댑터+시뮬+ROS 토픽 종합 헬스.")
  @GetMapping("/{robotId}/system/health")
  public Map<String, Object> systemHealth(@PathVariable Long robotId) {
    return adapterClient.systemHealth();
  }

  @Operation(summary = "Live pose", description = "어댑터에서 /odom 의 현재 pose 1회 조회.")
  @GetMapping("/{robotId}/system/pose")
  public Map<String, Object> livePose(@PathVariable Long robotId) {
    return adapterClient.lastPose();
  }

  @Operation(
      summary = "Load saved map",
      description = "저장된 맵을 로봇 세션에 로드하고 robot.mapId 갱신. Unknown session 종료.")
  @PostMapping("/{robotId}/load-map")
  public Map<String, Object> loadMap(
      @PathVariable Long robotId, @RequestBody ApiDtos.LoadMapRequest request) {
    IndoorMap map =
        mapRepository
            .findById(request.mapId())
            .orElseThrow(() -> new IllegalArgumentException("map not found"));
    if (map.getRtabmapDbPath() == null) {
      return Map.of("ok", false, "reason", "map has no saved blob");
    }
    try {
      java.nio.file.Path dbPath = java.nio.file.Paths.get(map.getRtabmapDbPath());
      long size = java.nio.file.Files.size(dbPath);
      adapterClient.setFloor(map.getCode(), dbPath);
      // Robot 의 mapId 갱신해 더 이상 Unknown 아니게.
      robotService.assignMapToRobot(robotId, map.getId());
      return Map.of(
          "ok", true,
          "mode", "localization",
          "mapId", map.getId(),
          "mapName", map.getName(),
          "blobBytes", size);
    } catch (java.io.IOException e) {
      return Map.of("ok", false, "reason", "failed to read blob: " + e.getMessage());
    }
  }

  @Operation(
      summary = "Start session on a floor",
      description =
          "사용자가 입력한 floorCode (예: '5F', 'B3F') 로 세션 시작. 같은 코드의 IndoorMap"
              + " 이 있으면 blob 로드 (localization), 없으면 IndoorMap+Floor 새로 생성하고"
              + " adapter 에 fresh-mapping 신호. 마지막에 OCR floor hint 도 갱신.")
  @PostMapping("/{robotId}/session/start")
  public Map<String, Object> startSession(
      @PathVariable Long robotId, @RequestBody ApiDtos.SessionStartRequest request) {
    String code = request.floorCode() == null ? "" : request.floorCode().trim();
    if (code.isEmpty()) {
      throw new IllegalArgumentException("floorCode required (use OCR-only endpoint for empty)");
    }
    String displayName = "FLOOR " + code.replaceAll("F$", "").replace("B", "B");

    // 1) IndoorMap 결정 — 3-단계 분기:
    //   (a) 같은 code 의 saved row 있음 → 그대로 사용 (재방문)
    //   (b) robot 이 draft row (Untitled / 임시 code) 에 보딩됐으면 그 row 를
    //       promote (code/name 변경 + working DB → snapshot). row 재사용 = 옛
    //       mesh 보존 + robot.mapId 변경 X. 매번 row 생기던 버그 fix.
    //   (c) robot 이 saved 다른 floor 에 보딩됐는데 새 code 입력 (의도적 floor
    //       전환) → 새 row 를 working DB snapshot 과 함께 생성 (adoptCurrentSession).
    Long currentMapId = robotService.getRobotMapId(robotId);
    IndoorMap currentMap = currentMapId != null
        ? mapRepository.findById(currentMapId).orElse(null) : null;
    IndoorMap map = mapRepository
        .findByCode(code)
        .orElseGet(() -> {
          if (currentMap != null && mapService.isDraftMap(currentMap)) {
            return mapService.promoteDraftToFloor(currentMap.getId(), code, displayName);
          }
          return mapService.adoptCurrentSession(code, displayName);
        });

    // 2) Floor 서브로우 — IndoorMap 이 새로 생성된 경우 함께 생성.
    //    code 매칭으로 1차 시도, 없으면 만든다. orderIndex 는 음수면 지하층 정렬.
    Floor floor = floorRepository.findAllByMapIdOrderByOrderIndexAsc(map.getId()).stream()
        .filter(f -> code.equalsIgnoreCase(f.getCode()))
        .findFirst()
        .orElseGet(() -> {
          int order = parseOrderIndex(code);
          return floorRepository.save(new Floor(map.getId(), code, displayName, order));
        });

    // 3) adapter: .db 있으면 load (localization), 없으면 fresh.
    // 6GB+ 누적 .db 도 처리: readAllBytes/byte[] (INT_MAX 한계 + heap OOM) 대신
    // Path 전달 → setFloor 가 FileSystemResource 로 chunk streaming.
    String mode;
    if (map.getRtabmapDbPath() != null) {
      java.nio.file.Path dbPath = java.nio.file.Paths.get(map.getRtabmapDbPath());
      if (java.nio.file.Files.exists(dbPath)) {
        adapterClient.setFloor(code, dbPath);
        mode = "localization";
      } else {
        adapterClient.setFloorFresh(code);
        mode = "mapping_fallback";
      }
    } else {
      adapterClient.setFloorFresh(code);
      mode = "mapping";
    }

    // 4) Robot 에 mapId / floorId 저장 → mapName 이 UI 에서 'Unknown' 안 됨.
    robotService.assignMapToRobot(robotId, map.getId());
    robotService.assignFloorToRobot(robotId, floor.getId());

    // 5) OCR floor hint + floorId — adapter 가 그 floor 로 spot 영속화 + 시드.
    adapterClient.setOcrFloor(code, floor.getId());

    // 6) SLAM 시작 — 사용자 멘탈모델 ("층 선택 = 세션 시작")에 맞게 slam_toolbox
    //    자동 spawn. 이미 떠있으면 noop. 이거 빠지면 /map 토픽 비어서 UI 가 빈 화면.
    adapterClient.startSlam();

    return Map.of(
        "ok", true,
        "mode", mode,
        "floorCode", code,
        "floorId", floor.getId(),
        "mapId", map.getId(),
        "mapName", map.getName(),
        "slamStarted", true);
  }

  @Operation(
      summary = "Reset robot session — Unknown session 강제",
      description =
          "robot.mapId/floorId 를 NULL 화 (=Unknown session). 운영자가 '다른 층으로 이동'"
              + " 등 명시적으로 보딩 다시 받고 싶을 때 호출. frontend 의 isDraft transition"
              + " 으로 floor modal 자동 노출.")
  @PostMapping("/{robotId}/session/reset")
  public Map<String, Object> resetSession(@PathVariable Long robotId) {
    robotService.detachRobotMapAndFloor(robotId);
    return Map.of("ok", true, "robotId", robotId, "state", "unknown_session");
  }

  @Operation(
      summary = "Reset all robot sessions",
      description =
          "ROS 재시작 시 adapter 가 startup event 에서 호출. 모든 robot 의 mapId/floorId"
              + " NULL 화 → frontend 의 isDraft 가 true 로 전이 → FloorPromptModal 자동 노출."
              + " 운영자가 '여기는 어디 층인가요' 다시 답하게 함. 단순 adapter restart 도"
              + " 보딩 재확인 trigger 로 취급 — 위치 신뢰 기준은 '세션' 이지 '레코드' 가 아님.")
  @PostMapping("/session/reset-all")
  public Map<String, Object> resetAllSessions() {
    int n = robotService.detachAllRobots();
    return Map.of("ok", true, "detached", n);
  }

  /** "5F" → 5, "B3F" → -3, "13F" → 13. */
  private static int parseOrderIndex(String code) {
    String upper = code.toUpperCase().replaceAll("F$", "");
    boolean basement = upper.startsWith("B");
    String digits = basement ? upper.substring(1) : upper;
    try {
      int n = Integer.parseInt(digits);
      return basement ? -n : n;
    } catch (NumberFormatException e) {
      return 0;
    }
  }

  @Operation(summary = "Delete robot", description = "Deletes a robot.")
  @DeleteMapping("/{robotId}")
  public void deleteRobot(@PathVariable Long robotId, Authentication authentication) {
    robotService.deleteRobot(robotId, (SessionOperator) authentication.getPrincipal());
  }
}
