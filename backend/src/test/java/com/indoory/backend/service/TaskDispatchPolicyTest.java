package com.indoory.backend.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.RobotStatus;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

class TaskDispatchPolicyTest {

  private final TaskDispatchPolicy policy = new TaskDispatchPolicy();

  @Test
  void prefersIdleRobotOnSameFloorBeforeHigherBatteryRobotElsewhere() {
    RobotEntity sameFloor =
        robot(1L, 1L, 2L, 48, LocalDateTime.now().minusSeconds(30), RobotStatus.IDLE, true);
    RobotEntity otherFloor = robot(2L, 1L, 3L, 95, LocalDateTime.now(), RobotStatus.IDLE, true);

    RobotEntity selected = policy.selectRobot(List.of(otherFloor, sameFloor), Set.of(), 1L, 2L);

    assertThat(selected).isNotNull();
    assertThat(selected.getId()).isEqualTo(1L);
  }

  @Test
  void skipsRobotsThatAreBusyOfflineOrBelowBatteryThreshold() {
    RobotEntity busyRobot = robot(1L, 1L, 2L, 90, LocalDateTime.now(), RobotStatus.IDLE, true);
    RobotEntity lowBatteryRobot =
        robot(2L, 1L, 2L, 10, LocalDateTime.now(), RobotStatus.IDLE, true);
    RobotEntity navigatingRobot =
        robot(3L, 1L, 2L, 80, LocalDateTime.now(), RobotStatus.NAVIGATING, true);
    RobotEntity offlineRobot = robot(4L, 1L, 2L, 80, LocalDateTime.now(), RobotStatus.IDLE, false);
    RobotEntity availableRobot =
        robot(5L, 1L, 2L, 55, LocalDateTime.now().minusSeconds(10), RobotStatus.IDLE, true);

    RobotEntity selected =
        policy.selectRobot(
            List.of(busyRobot, lowBatteryRobot, navigatingRobot, offlineRobot, availableRobot),
            Set.of(1L),
            1L,
            2L);

    assertThat(selected).isNotNull();
    assertThat(selected.getId()).isEqualTo(5L);
  }

  private RobotEntity robot(
      Long id,
      Long mapId,
      Long floorId,
      int battery,
      LocalDateTime updatedAt,
      RobotStatus status,
      boolean online) {
    return RobotEntity.builder()
        .id(id)
        .robotCode("RBT-" + id)
        .label("Robot-" + id)
        .serialNumber("SN-" + id)
        .status(status)
        .online(online)
        .batteryLevel(battery)
        .mapId(mapId)
        .floorId(floorId)
        .poseX(BigDecimal.ZERO)
        .poseY(BigDecimal.ZERO)
        .yawDeg(BigDecimal.ZERO)
        .environment("SIMULATED_ROS")
        .localizationState("Converged")
        .updatedAt(updatedAt)
        .build();
  }
}
