package com.indoory.backend.api;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

public final class ApiDtos {

	private ApiDtos() {
	}

	public record LoginRequest(String email, String password) {
	}

	public record RobotLabelRequest(String label) {
	}

	public record DispatchCommandRequest(Long locationId) {
	}

	public record CreateTaskRequest(Long pickupLocationId, Long dropoffLocationId, String priority) {
	}

	public record OperatorResponse(
		Long id,
		String name,
		String email,
		String role,
		LocalDateTime lastLoginAt
	) {
	}

	public record LoginResponse(OperatorResponse operator) {
	}

	public record RobotStateResponse(
		String status,
		Integer batteryLevel,
		boolean online,
		String environment,
		String localizationState,
		LocalDateTime updatedAt,
		String warning
	) {
	}

	public record RobotPoseResponse(
		BigDecimal x,
		BigDecimal y,
		BigDecimal yawDeg,
		String floorCode,
		Long mapId,
		String mapName
	) {
	}

	public record RobotSummaryResponse(
		Long id,
		String robotCode,
		String label,
		String serialNumber,
		String status,
		boolean online,
		Integer batteryLevel,
		String floorCode,
		String floorName,
		Long mapId,
		String mapName,
		Long currentTaskId,
		String currentTaskCode,
		LocalDateTime updatedAt,
		String warning,
		String environment,
		String localizationState
	) {
	}

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
		String progressLabel
	) {
	}

	public record TaskTimelineItemResponse(
		String key,
		String label,
		String state,
		LocalDateTime timestamp
	) {
	}

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
		String currentStage,
		String currentStageLabel,
		List<TaskTimelineItemResponse> timeline
	) {
	}

	public record CommandLogResponse(
		Long id,
		LocalDateTime createdAt,
		String commandType,
		String parameters,
		String status,
		String issuedBy
	) {
	}

	public record EventLogResponse(
		Long id,
		LocalDateTime createdAt,
		String severity,
		String robotLabel,
		String type,
		String message,
		String taskCode
	) {
	}

	public record RobotStateSnapshotResponse(
		Long id,
		LocalDateTime recordedAt,
		String status,
		Integer batteryLevel,
		BigDecimal poseX,
		BigDecimal poseY,
		BigDecimal yawDeg
	) {
	}

	public record LocationResponse(
		Long id,
		String code,
		String name,
		Long floorId,
		String floorCode,
		String floorName,
		String type,
		BigDecimal x,
		BigDecimal y,
		BigDecimal width,
		BigDecimal height
	) {
	}

	public record FloorResponse(
		Long id,
		String code,
		String name,
		Integer orderIndex,
		Integer width,
		Integer height,
		String viewBox,
		List<LocationResponse> locations
	) {
	}

	public record MapMetadataResponse(
		Long id,
		String code,
		String name,
		String version,
		BigDecimal scaleMetersPerPixel,
		boolean active
	) {
	}

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
		Long destinationLocationId
	) {
	}

	public record MapTaskResponse(
		Long id,
		String taskCode,
		String status,
		String floorCode,
		Long assignedRobotId,
		String assignedRobotLabel,
		Long pickupLocationId,
		Long dropoffLocationId,
		String progressLabel
	) {
	}

	public record CurrentMapResponse(
		Long id,
		String code,
		String name,
		String version,
		BigDecimal scaleMetersPerPixel,
		boolean active,
		List<FloorResponse> floors,
		List<MapRobotResponse> robots,
		List<MapTaskResponse> activeTasks
	) {
	}

	public record RobotDetailResponse(
		RobotSummaryResponse robot,
		RobotStateResponse state,
		RobotPoseResponse pose,
		TaskDetailResponse activeTask,
		List<CommandLogResponse> commandHistory,
		List<TaskSummaryResponse> taskHistory,
		List<EventLogResponse> events,
		List<RobotStateSnapshotResponse> logs
	) {
	}
}
