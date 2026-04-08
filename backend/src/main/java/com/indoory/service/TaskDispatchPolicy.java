package com.indoory.service;

import com.indoory.entity.Enum.RobotStatus;
import com.indoory.entity.Robot;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class TaskDispatchPolicy {

  private final int lowBatteryThreshold;

  public TaskDispatchPolicy(
      @Value("${indoory.dispatch.low-battery-threshold:20}") int lowBatteryThreshold) {
    this.lowBatteryThreshold = lowBatteryThreshold;
  }

  public Robot selectRobot(List<Robot> robots, Set<Long> busyRobotIds, Long mapId, Long floorId) {
    return robots.stream()
        .filter(robot -> robot.getStatus() != RobotStatus.OFFLINE)
        .filter(robot -> robot.getStatus() == RobotStatus.IDLE)
        .filter(robot -> robot.getBatteryLevel() >= lowBatteryThreshold)
        .filter(robot -> !busyRobotIds.contains(robot.getId()))
        .sorted(
            Comparator.comparing((Robot robot) -> !robot.getMapId().equals(mapId))
                .thenComparing(robot -> !robot.getFloorId().equals(floorId))
                .thenComparing(Robot::getBatteryLevel, Comparator.reverseOrder())
                .thenComparing(Robot::getUpdatedAt, Comparator.reverseOrder()))
        .findFirst()
        .orElse(null);
  }
}
