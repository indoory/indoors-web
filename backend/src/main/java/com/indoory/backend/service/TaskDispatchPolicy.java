package com.indoory.backend.service;

import java.util.Comparator;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Component;

import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.RobotStatus;

@Component
public class TaskDispatchPolicy {

	public RobotEntity selectRobot(List<RobotEntity> robots, Set<Long> busyRobotIds, Long mapId, Long floorId) {
		return robots.stream()
			.filter(RobotEntity::isOnline)
			.filter(robot -> robot.getStatus() == RobotStatus.IDLE)
			.filter(robot -> robot.getBatteryLevel() >= 20)
			.filter(robot -> !busyRobotIds.contains(robot.getId()))
			.sorted(
				Comparator
					.comparing((RobotEntity robot) -> !robot.getMapId().equals(mapId))
					.thenComparing(robot -> !robot.getFloorId().equals(floorId))
					.thenComparing(RobotEntity::getBatteryLevel, Comparator.reverseOrder())
					.thenComparing(RobotEntity::getUpdatedAt, Comparator.reverseOrder())
			)
			.findFirst()
			.orElse(null);
	}
}
