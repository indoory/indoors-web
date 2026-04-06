package com.indoory.backend.service;

import com.indoory.backend.entity.EventSeverity;
import com.indoory.backend.entity.LocationEntity;
import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.TaskEntity;
import com.indoory.backend.entity.TaskStatus;
import com.indoory.backend.repository.LocationRepository;
import com.indoory.backend.repository.RobotRepository;
import com.indoory.backend.repository.TaskRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class SimulationService {

  private final TaskRepository taskRepository;
  private final RobotRepository robotRepository;
  private final LocationRepository locationRepository;
  private final ActivityService activityService;
  private final TaskService taskService;

  @Scheduled(fixedDelay = 5000)
  @Transactional
  public void tick() {
    List<TaskEntity> activeTasks =
        taskRepository.findAllByStatusInOrderByCreatedAtDesc(
            List.of(TaskStatus.ASSIGNED, TaskStatus.RUNNING));

    for (TaskEntity task : activeTasks) {
      if (task.getAssignedRobotId() == null) {
        continue;
      }

      RobotEntity robot = robotRepository.findById(task.getAssignedRobotId()).orElse(null);
      if (robot == null || robot.isStoppedForManualControl()) {
        continue;
      }

      LocationEntity pickup = locationRepository.findById(task.getPickupLocationId()).orElse(null);
      LocationEntity dropoff =
          locationRepository.findById(task.getDropoffLocationId()).orElse(null);
      if (pickup == null || dropoff == null) {
        continue;
      }

      LocalDateTime now = LocalDateTime.now();

      switch (task.getCurrentStage()) {
        case ROUTE_TO_PICKUP -> advanceToPickup(task, robot, pickup, now);
        case LOADING -> advanceLoading(task, robot, now);
        case ROUTE_TO_DROPOFF -> advanceToDropoff(task, robot, dropoff, now);
        default -> {}
      }
    }

    taskService.dispatchQueuedTasks();
  }

  private void advanceToPickup(
      TaskEntity task, RobotEntity robot, LocationEntity pickup, LocalDateTime now) {
    if (task.getStatus() == TaskStatus.ASSIGNED) {
      task.markRunning(now);
    }

    robot.markNavigating(now);
    moveRobot(robot, pickup, 0.42);

    if (reached(robot, pickup) || elapsed(task.getStageUpdatedAt(), now, 12)) {
      task.advanceToLoading(now);
      activityService.recordEvent(
          robot.getId(),
          task.getId(),
          EventSeverity.INFO,
          "TASK",
          "Task " + task.getTaskCode() + " reached pickup");
    }

    robotRepository.save(robot);
    taskRepository.save(task);
    activityService.captureSnapshot(robot);
  }

  private void advanceLoading(TaskEntity task, RobotEntity robot, LocalDateTime now) {
    robot.markPlanning(now);

    if (elapsed(task.getStageUpdatedAt(), now, 6)) {
      task.advanceToDropoff(now);
      robot.markNavigating(now);
      activityService.recordEvent(
          robot.getId(),
          task.getId(),
          EventSeverity.INFO,
          "TASK",
          "Task " + task.getTaskCode() + " pickup complete, navigating to dropoff");
    }

    robotRepository.save(robot);
    taskRepository.save(task);
    activityService.captureSnapshot(robot);
  }

  private void advanceToDropoff(
      TaskEntity task, RobotEntity robot, LocationEntity dropoff, LocalDateTime now) {
    robot.markNavigating(now);
    moveRobot(robot, dropoff, 0.46);

    if (reached(robot, dropoff) || elapsed(task.getStageUpdatedAt(), now, 15)) {
      task.complete(now);
      robot.markIdle(now);
      robot.updatePose(centerX(dropoff), centerY(dropoff));
      activityService.recordEvent(
          robot.getId(),
          task.getId(),
          EventSeverity.INFO,
          "TASK",
          "Task " + task.getTaskCode() + " completed successfully");
    }

    robotRepository.save(robot);
    taskRepository.save(task);
    activityService.captureSnapshot(robot);
  }

  private void moveRobot(RobotEntity robot, LocationEntity target, double weight) {
    double nextX =
        robot.getPoseX().doubleValue()
            + (centerX(target).doubleValue() - robot.getPoseX().doubleValue()) * weight;
    double nextY =
        robot.getPoseY().doubleValue()
            + (centerY(target).doubleValue() - robot.getPoseY().doubleValue()) * weight;

    robot.updatePose(
        BigDecimal.valueOf(nextX).setScale(2, RoundingMode.HALF_UP),
        BigDecimal.valueOf(nextY).setScale(2, RoundingMode.HALF_UP));
  }

  private boolean reached(RobotEntity robot, LocationEntity target) {
    double dx = robot.getPoseX().doubleValue() - centerX(target).doubleValue();
    double dy = robot.getPoseY().doubleValue() - centerY(target).doubleValue();
    return Math.sqrt(dx * dx + dy * dy) < 8;
  }

  private boolean elapsed(LocalDateTime from, LocalDateTime now, long seconds) {
    return Duration.between(from, now).getSeconds() >= seconds;
  }

  private BigDecimal centerX(LocationEntity location) {
    return location
        .getX()
        .add(location.getWidth().divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP));
  }

  private BigDecimal centerY(LocationEntity location) {
    return location
        .getY()
        .add(location.getHeight().divide(BigDecimal.valueOf(2), 2, RoundingMode.HALF_UP));
  }
}
