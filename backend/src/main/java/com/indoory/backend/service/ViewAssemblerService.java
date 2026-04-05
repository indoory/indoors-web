package com.indoory.backend.service;

import java.util.List;

import org.springframework.stereotype.Service;

import com.indoory.backend.api.ApiDtos;
import com.indoory.backend.entity.CommandLogEntity;
import com.indoory.backend.entity.EventLogEntity;
import com.indoory.backend.entity.FloorEntity;
import com.indoory.backend.entity.LocationEntity;
import com.indoory.backend.entity.MapEntity;
import com.indoory.backend.entity.OperatorEntity;
import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.RobotStateSnapshotEntity;
import com.indoory.backend.entity.TaskEntity;
import com.indoory.backend.entity.TaskStage;
import com.indoory.backend.entity.TaskStatus;

@Service
public class ViewAssemblerService {

	public ApiDtos.OperatorResponse toOperatorResponse(OperatorEntity operator) {
		return new ApiDtos.OperatorResponse(
			operator.getId(),
			operator.getName(),
			operator.getEmail(),
			operator.getRole().name(),
			operator.getLastLoginAt()
		);
	}

	public ApiDtos.RobotSummaryResponse toRobotSummary(
		RobotEntity robot,
		TaskEntity activeTask,
		FloorEntity floor,
		MapEntity map
	) {
		return new ApiDtos.RobotSummaryResponse(
			robot.getId(),
			robot.getRobotCode(),
			robot.getLabel(),
			robot.getSerialNumber(),
			robot.getStatus().name(),
			robot.isOnline(),
			robot.getBatteryLevel(),
			floor.getCode(),
			floor.getName(),
			map.getId(),
			map.getName(),
			activeTask == null ? null : activeTask.getId(),
			activeTask == null ? null : activeTask.getTaskCode(),
			robot.getUpdatedAt(),
			robot.getWarning(),
			robot.getEnvironment(),
			robot.getLocalizationState()
		);
	}

	public ApiDtos.RobotStateResponse toRobotState(RobotEntity robot) {
		return new ApiDtos.RobotStateResponse(
			robot.getStatus().name(),
			robot.getBatteryLevel(),
			robot.isOnline(),
			robot.getEnvironment(),
			robot.getLocalizationState(),
			robot.getUpdatedAt(),
			robot.getWarning()
		);
	}

	public ApiDtos.RobotPoseResponse toRobotPose(RobotEntity robot, MapEntity map, FloorEntity floor) {
		return new ApiDtos.RobotPoseResponse(
			robot.getPoseX(),
			robot.getPoseY(),
			robot.getYawDeg(),
			floor.getCode(),
			map.getId(),
			map.getName()
		);
	}

	public ApiDtos.TaskSummaryResponse toTaskSummary(
		TaskEntity task,
		FloorEntity floor,
		LocationEntity pickup,
		LocationEntity dropoff,
		RobotEntity assignedRobot
	) {
		return new ApiDtos.TaskSummaryResponse(
			task.getId(),
			task.getTaskCode(),
			task.getType().name(),
			task.getStatus().name(),
			task.getPriority().name(),
			floor.getCode(),
			pickup.getName(),
			dropoff.getName(),
			assignedRobot == null ? null : assignedRobot.getId(),
			assignedRobot == null ? null : assignedRobot.getLabel(),
			task.getCreatedAt(),
			task.getCompletedAt(),
			task.getFailureReason(),
			progressLabel(task)
		);
	}

	public ApiDtos.TaskDetailResponse toTaskDetail(
		TaskEntity task,
		FloorEntity floor,
		LocationEntity pickup,
		LocationEntity dropoff,
		RobotEntity assignedRobot
	) {
		ApiDtos.TaskSummaryResponse summary = toTaskSummary(task, floor, pickup, dropoff, assignedRobot);

		return new ApiDtos.TaskDetailResponse(
			summary.id(),
			summary.taskCode(),
			summary.type(),
			summary.status(),
			summary.priority(),
			summary.floorCode(),
			summary.pickupLocationName(),
			summary.dropoffLocationName(),
			summary.assignedRobotId(),
			summary.assignedRobotLabel(),
			summary.createdAt(),
			summary.completedAt(),
			summary.failureReason(),
			summary.progressLabel(),
			task.getCurrentStage().name(),
			stageLabel(task.getCurrentStage()),
			timeline(task)
		);
	}

	public ApiDtos.CommandLogResponse toCommandLog(CommandLogEntity command) {
		return new ApiDtos.CommandLogResponse(
			command.getId(),
			command.getCreatedAt(),
			command.getCommandType().name(),
			command.getParameters(),
			command.getStatus().name(),
			command.getIssuedBy()
		);
	}

	public ApiDtos.EventLogResponse toEventLog(
		EventLogEntity event,
		RobotEntity robot,
		TaskEntity task
	) {
		return new ApiDtos.EventLogResponse(
			event.getId(),
			event.getCreatedAt(),
			event.getSeverity().name(),
			robot == null ? null : robot.getLabel(),
			event.getType(),
			event.getMessage(),
			task == null ? null : task.getTaskCode()
		);
	}

	public ApiDtos.RobotStateSnapshotResponse toSnapshot(RobotStateSnapshotEntity snapshot) {
		return new ApiDtos.RobotStateSnapshotResponse(
			snapshot.getId(),
			snapshot.getRecordedAt(),
			snapshot.getStatus().name(),
			snapshot.getBatteryLevel(),
			snapshot.getPoseX(),
			snapshot.getPoseY(),
			snapshot.getYawDeg()
		);
	}

	public ApiDtos.LocationResponse toLocation(LocationEntity location, FloorEntity floor) {
		return new ApiDtos.LocationResponse(
			location.getId(),
			location.getCode(),
			location.getName(),
			floor.getId(),
			floor.getCode(),
			floor.getName(),
			location.getType().name(),
			location.getX(),
			location.getY(),
			location.getWidth(),
			location.getHeight()
		);
	}

	public ApiDtos.FloorResponse toFloor(FloorEntity floor, List<ApiDtos.LocationResponse> locations) {
		return new ApiDtos.FloorResponse(
			floor.getId(),
			floor.getCode(),
			floor.getName(),
			floor.getOrderIndex(),
			floor.getWidth(),
			floor.getHeight(),
			floor.getViewBox(),
			locations
		);
	}

	public ApiDtos.MapMetadataResponse toMapMetadata(MapEntity map) {
		return new ApiDtos.MapMetadataResponse(
			map.getId(),
			map.getCode(),
			map.getName(),
			map.getVersion(),
			map.getScaleMetersPerPixel(),
			map.isActive()
		);
	}

	public ApiDtos.MapRobotResponse toMapRobot(
		RobotEntity robot,
		FloorEntity floor,
		TaskEntity activeTask
	) {
		return new ApiDtos.MapRobotResponse(
			robot.getId(),
			robot.getLabel(),
			robot.getStatus().name(),
			robot.getBatteryLevel(),
			floor.getCode(),
			robot.getPoseX(),
			robot.getPoseY(),
			robot.getYawDeg(),
			activeTask == null ? null : activeTask.getTaskCode(),
			activeTask == null ? null : activeTask.getDropoffLocationId()
		);
	}

	public ApiDtos.MapTaskResponse toMapTask(
		TaskEntity task,
		FloorEntity floor,
		RobotEntity assignedRobot
	) {
		return new ApiDtos.MapTaskResponse(
			task.getId(),
			task.getTaskCode(),
			task.getStatus().name(),
			floor.getCode(),
			assignedRobot == null ? null : assignedRobot.getId(),
			assignedRobot == null ? null : assignedRobot.getLabel(),
			task.getPickupLocationId(),
			task.getDropoffLocationId(),
			progressLabel(task)
		);
	}

	private List<ApiDtos.TaskTimelineItemResponse> timeline(TaskEntity task) {
		return List.of(
			new ApiDtos.TaskTimelineItemResponse("created", "Created", "done", task.getCreatedAt()),
			new ApiDtos.TaskTimelineItemResponse(
				"assigned",
				"Assigned",
				task.getAssignedAt() != null ? "done" : "pending",
				task.getAssignedAt()
			),
			new ApiDtos.TaskTimelineItemResponse(
				"pickup",
				"Pickup reached",
				stateFor(task, TaskStage.LOADING),
				task.getCurrentStage() == TaskStage.LOADING || task.getCurrentStage() == TaskStage.ROUTE_TO_DROPOFF
					|| task.getCurrentStage() == TaskStage.COMPLETED ? task.getStageUpdatedAt() : null
			),
			new ApiDtos.TaskTimelineItemResponse(
				"dropoff",
				"Navigating to dropoff",
				stateFor(task, TaskStage.ROUTE_TO_DROPOFF),
				task.getCurrentStage() == TaskStage.ROUTE_TO_DROPOFF || task.getCurrentStage() == TaskStage.COMPLETED
					? task.getStageUpdatedAt() : null
			),
			new ApiDtos.TaskTimelineItemResponse(
				"complete",
				"Delivery complete",
				task.getStatus() == TaskStatus.DONE ? "done" : "pending",
				task.getCompletedAt()
			)
		);
	}

	private String stateFor(TaskEntity task, TaskStage stage) {
		if (task.getCurrentStage() == stage) {
			return "current";
		}

		if (task.getCurrentStage().ordinal() > stage.ordinal() || task.getStatus() == TaskStatus.DONE) {
			return "done";
		}

		return "pending";
	}

	private String progressLabel(TaskEntity task) {
		return switch (task.getStatus()) {
			case CREATED -> "Queued for auto dispatch";
			case ASSIGNED -> "Assigned and planning";
			case PAUSED -> "Paused by operator";
			case DONE -> "Delivery complete";
			case FAILED -> task.getFailureReason() == null ? "Task failed" : task.getFailureReason();
			case CANCELED -> "Canceled";
			case RUNNING -> stageLabel(task.getCurrentStage());
		};
	}

	private String stageLabel(TaskStage stage) {
		return switch (stage) {
			case QUEUED -> "Queued";
			case ROUTE_TO_PICKUP -> "Navigating to pickup";
			case LOADING -> "Loading item";
			case ROUTE_TO_DROPOFF -> "Navigating to dropoff";
			case COMPLETED -> "Delivery complete";
			case FAILED -> "Failed";
			case CANCELED -> "Canceled";
		};
	}
}
