package com.indoory.controller;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public final class ApiDtos {

  private ApiDtos() {}

  public record LoginRequest(String email, String password) {}

  public record RobotLabelRequest(String label) {}

  public record CreateRobotRequest(
      String robotCode,
      String label,
      Long mapId,
      Long floorId,
      BigDecimal poseX,
      BigDecimal poseY) {}

  public record CreateMapRequest(String code, String name) {}

  public record CreateFloorRequest(Long mapId, String code, String name, Integer orderIndex) {}

  public record Nav2YamlUrlRequest(String nav2YamlUrl) {}

  public record TelemetryRequest(
      String status, boolean online, Double x, Double y, double yawDeg) {}

  public record SlamSaveRequest(String mapName) {}

  public record InitialPoseRequest(double x, double y, double yaw) {}

  public record DispatchCommandRequest(Long locationId) {}

  public record CreateTaskRequest(Long pickupLocationId, Long dropoffLocationId, String priority) {}

  public record OperatorResponse(
      Long id, String name, String email, String role, LocalDateTime lastLoginAt) {}

  public record LoginResponse(OperatorResponse operator) {}

  public record RobotStateResponse(
      String status, Integer batteryLevel, boolean online, LocalDateTime updatedAt) {}

  public record RobotPoseResponse(
      BigDecimal x, BigDecimal y, BigDecimal yawDeg, String floorCode, Long mapId) {}

  public record RobotSummaryResponse(
      Long id,
      String robotCode,
      String label,
      String status,
      boolean online,
      Integer batteryLevel,
      String floorCode,
      Long mapId,
      String mapName,
      Long currentTaskId,
      String currentTaskCode,
      LocalDateTime updatedAt) {}

  public record TaskSummaryResponse(
      Long id,
      String taskCode,
      String type,
      String status,
      String priority,
      String floorCode,
      String pickupLocationName,
      String dropoffLocationName,
      Long assignedRobotId,
      String assignedRobotLabel,
      LocalDateTime createdAt,
      LocalDateTime completedAt,
      String failureReason,
      String progressLabel) {}

  public record TaskDetailResponse(
      Long id,
      String taskCode,
      String type,
      String status,
      String priority,
      String floorCode,
      String pickupLocationName,
      String dropoffLocationName,
      Long assignedRobotId,
      String assignedRobotLabel,
      LocalDateTime createdAt,
      LocalDateTime completedAt,
      String failureReason,
      String progressLabel,
      String currentStage) {}

  public record CommandLogResponse(
      Long id,
      LocalDateTime createdAt,
      String commandType,
      String parameters,
      String status,
      String issuedBy) {}

  public record EventLogResponse(
      Long id,
      LocalDateTime createdAt,
      String severity,
      String robotLabel,
      String type,
      String message,
      String taskCode) {}

  public record LocationResponse(
      Long id, String name, Long floorId, String type, BigDecimal x, BigDecimal y) {}

  public record FloorResponse(
      Long id,
      String code,
      String name,
      Integer orderIndex,
      String mapImageUrl,
      String mapPgmUrl,
      List<LocationResponse> locations) {}

  public record MapMetadataResponse(
      Long id, String code, String name, boolean active, String nav2YamlUrl) {}

  public record MapRobotResponse(
      Long robotId,
      String label,
      String status,
      Integer batteryLevel,
      String floorCode,
      BigDecimal x,
      BigDecimal y,
      BigDecimal yawDeg,
      String activeTaskCode,
      Long destinationLocationId) {}

  public record MapTaskResponse(
      Long id,
      String taskCode,
      String status,
      String floorCode,
      Long assignedRobotId,
      String assignedRobotLabel,
      Long pickupLocationId,
      Long dropoffLocationId,
      String progressLabel) {}

  public record CurrentMapResponse(
      Long id,
      String code,
      String name,
      boolean active,
      String nav2YamlUrl,
      List<FloorResponse> floors,
      List<MapRobotResponse> robots,
      List<MapTaskResponse> activeTasks) {}

  public record RobotDetailResponse(
      RobotSummaryResponse robot,
      RobotStateResponse state,
      RobotPoseResponse pose,
      TaskDetailResponse activeTask,
      List<CommandLogResponse> commandHistory,
      List<TaskSummaryResponse> taskHistory,
      List<EventLogResponse> events) {}
}
