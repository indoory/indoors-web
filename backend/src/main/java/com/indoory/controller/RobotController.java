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
  public void startSlamExplore(@PathVariable Long robotId) {
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
  public void stopSlam(@PathVariable Long robotId) {
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
    if (map.getRtabmapDbPath() == null) {
      return Map.of("ok", false, "reason", "no rtabmap_db saved on map " + map.getId());
    }
    try {
      byte[] blob = java.nio.file.Files.readAllBytes(
          java.nio.file.Paths.get(map.getRtabmapDbPath()));
      adapterClient.setFloor(floor.getCode(), blob);
      return Map.of("ok", true, "floorCode", floor.getCode(), "blobBytes", blob.length);
    } catch (java.io.IOException e) {
      return Map.of("ok", false, "reason", "failed to read blob: " + e.getMessage());
    }
  }

  @Operation(
      summary = "Spin & relocalize",
      description = "로봇이 한 바퀴 회전하면서 RTAB-Map BoW 매칭으로 맵 위 자기 위치 추정.")
  @PostMapping("/{robotId}/relocalize")
  public Map<String, Object> relocalize(@PathVariable Long robotId) {
    return adapterClient.relocalize();
  }

  @Operation(summary = "Delete robot", description = "Deletes a robot.")
  @DeleteMapping("/{robotId}")
  public void deleteRobot(@PathVariable Long robotId, Authentication authentication) {
    robotService.deleteRobot(robotId, (SessionOperator) authentication.getPrincipal());
  }
}
