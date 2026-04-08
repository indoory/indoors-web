package com.indoory.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.indoory.entity.BaseEntity;
import com.indoory.entity.Robot;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class TaskDispatchPolicyTest {

  private final TaskDispatchPolicy policy = new TaskDispatchPolicy(20);

  @Test
  void prefersIdleRobotOnSameFloorBeforeHigherBatteryRobotElsewhere() {
    Robot sameFloor =
        robot(
            1L,
            1L,
            2L,
            48,
            LocalDateTime.now().minusSeconds(30),
            BaseEntity.RobotStatus.IDLE,
            true);
    Robot otherFloor =
        robot(2L, 1L, 3L, 95, LocalDateTime.now(), BaseEntity.RobotStatus.IDLE, true);

    Robot selected = policy.selectRobot(List.of(otherFloor, sameFloor), Set.of(), 1L, 2L);

    assertThat(selected).isNotNull();
    assertThat(selected.getId()).isEqualTo(1L);
  }

  @Test
  void skipsRobotsThatAreBusyOfflineOrBelowBatteryThreshold() {
    Robot busyRobot = robot(1L, 1L, 2L, 90, LocalDateTime.now(), BaseEntity.RobotStatus.IDLE, true);
    Robot lowBatteryRobot =
        robot(2L, 1L, 2L, 10, LocalDateTime.now(), BaseEntity.RobotStatus.IDLE, true);
    Robot navigatingRobot =
        robot(3L, 1L, 2L, 80, LocalDateTime.now(), BaseEntity.RobotStatus.NAVIGATING, true);
    Robot offlineRobot =
        robot(4L, 1L, 2L, 80, LocalDateTime.now(), BaseEntity.RobotStatus.IDLE, false);
    Robot availableRobot =
        robot(
            5L,
            1L,
            2L,
            55,
            LocalDateTime.now().minusSeconds(10),
            BaseEntity.RobotStatus.IDLE,
            true);

    Robot selected =
        policy.selectRobot(
            List.of(busyRobot, lowBatteryRobot, navigatingRobot, offlineRobot, availableRobot),
            Set.of(1L),
            1L,
            2L);

    assertThat(selected).isNotNull();
    assertThat(selected.getId()).isEqualTo(5L);
  }

  private Robot robot(
      Long id,
      Long mapId,
      Long floorId,
      int battery,
      LocalDateTime updatedAt,
      BaseEntity.RobotStatus status,
      boolean online) {
    Robot robot =
        Robot.builder()
            .robotCode("RBT-" + id)
            .label("Robot-" + id)
            .status(status)
            .online(online)
            .batteryLevel(battery)
            .mapId(mapId)
            .floorId(floorId)
            .poseX(BigDecimal.ZERO)
            .poseY(BigDecimal.ZERO)
            .yawDeg(BigDecimal.ZERO)
            .build();
    ReflectionTestUtils.setField(robot, "id", id);
    ReflectionTestUtils.setField(robot, "updatedAt", updatedAt);
    return robot;
  }
}
