package com.indoory.service;

import com.indoory.controller.ApiDtos;
import com.indoory.entity.*;
import com.indoory.entity.Enum.TaskStage;
import org.springframework.stereotype.Service;

@Service
public class ViewAssemblerService {

  public ApiDtos.OperatorResponse toOperatorResponse(Operator operator) {
    return new ApiDtos.OperatorResponse(
        operator.getId(),
        operator.getName(),
        operator.getEmail(),
        operator.getRole().name(),
        operator.getLastLoginAt());
  }

  public ApiDtos.RobotSummaryResponse toRobotSummary(
      Robot robot, Task activeTask, Floor floor, IndoorMap map) {
    return new ApiDtos.RobotSummaryResponse(
        robot.getId(),
        robot.getRobotCode(),
        robot.getLabel(),
        robot.getStatus().name(),
        !"OFFLINE".equals(robot.getStatus().name()),
        robot.getBatteryLevel(),
        floor.getCode(),
        map.getId(),
        map.getName(),
        activeTask == null ? null : activeTask.getId(),
        activeTask == null ? null : activeTask.getTaskCode(),
        robot.getUpdatedAt());
  }

  public ApiDtos.RobotStateResponse toRobotState(Robot robot) {
    return new ApiDtos.RobotStateResponse(
        robot.getStatus().name(),
        robot.getBatteryLevel(),
        !"OFFLINE".equals(robot.getStatus().name()),
        robot.getUpdatedAt());
  }

  public ApiDtos.RobotPoseResponse toRobotPose(Robot robot, IndoorMap map, Floor floor) {
    return new ApiDtos.RobotPoseResponse(
        robot.getPoseX(), robot.getPoseY(), robot.getYawDeg(), floor.getCode(), map.getId());
  }

  public ApiDtos.TaskSummaryResponse toTaskSummary(
      Task task, Floor floor, Location pickup, Location dropoff, Robot assignedRobot) {
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
        progressLabel(task));
  }

  public ApiDtos.TaskDetailResponse toTaskDetail(
      Task task, Floor floor, Location pickup, Location dropoff, Robot assignedRobot) {
    ApiDtos.TaskSummaryResponse summary =
        toTaskSummary(task, floor, pickup, dropoff, assignedRobot);
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
        task.getCurrentStage().name());
  }

  public ApiDtos.CommandLogResponse toCommandLog(CommandLog command) {
    return new ApiDtos.CommandLogResponse(
        command.getId(),
        command.getCreatedAt(),
        command.getCommandType().name(),
        command.getParameters(),
        command.getStatus().name(),
        command.getIssuedBy());
  }

  public ApiDtos.EventLogResponse toEventLog(EventLog event, Robot robot, Task task) {
    return new ApiDtos.EventLogResponse(
        event.getId(),
        event.getCreatedAt(),
        event.getSeverity().name(),
        robot == null ? null : robot.getLabel(),
        event.getType(),
        event.getMessage(),
        task == null ? null : task.getTaskCode());
  }

  public ApiDtos.LocationResponse toLocation(Location location, Floor floor) {
    return new ApiDtos.LocationResponse(
        location.getId(),
        location.getName(),
        floor.getId(),
        location.getType().name(),
        location.getX(),
        location.getY());
  }

  public ApiDtos.FloorResponse toFloor(
      Floor floor, java.util.List<ApiDtos.LocationResponse> locations) {
    return new ApiDtos.FloorResponse(
        floor.getId(),
        floor.getCode(),
        floor.getName(),
        floor.getOrderIndex(),
        floor.getMapImageUrl(),
        floor.getMapPgmUrl(),
        locations);
  }

  public ApiDtos.MapMetadataResponse toMapMetadata(IndoorMap map) {
    return new ApiDtos.MapMetadataResponse(
        map.getId(), map.getCode(), map.getName(), map.isActive(), map.getNav2YamlUrl());
  }

  public ApiDtos.MapRobotResponse toMapRobot(Robot robot, Floor floor, Task activeTask) {
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
        activeTask == null ? null : activeTask.getDropoffLocationId());
  }

  public ApiDtos.MapTaskResponse toMapTask(Task task, Floor floor, Robot assignedRobot) {
    return new ApiDtos.MapTaskResponse(
        task.getId(),
        task.getTaskCode(),
        task.getStatus().name(),
        floor.getCode(),
        assignedRobot == null ? null : assignedRobot.getId(),
        assignedRobot == null ? null : assignedRobot.getLabel(),
        task.getPickupLocationId(),
        task.getDropoffLocationId(),
        progressLabel(task));
  }

  private String progressLabel(Task task) {
    return switch (task.getStatus()) {
      case CREATED -> "Queued";
      case ASSIGNED -> "Assigned";
      case PAUSED -> "Paused";
      case DONE -> "Completed";
      case FAILED -> task.getFailureReason() == null ? "Failed" : task.getFailureReason();
      case CANCELED -> "Canceled";
      case RUNNING -> stageLabel(task.getCurrentStage());
    };
  }

  private String stageLabel(TaskStage stage) {
    return switch (stage) {
      case QUEUED -> "Queued";
      case ROUTE_TO_PICKUP -> "To pickup";
      case LOADING -> "Loading";
      case ROUTE_TO_DROPOFF -> "To dropoff";
      case COMPLETED -> "Completed";
      case FAILED -> "Failed";
      case CANCELED -> "Canceled";
    };
  }
}
