package com.indoory.backend.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class RobotEntityTest {

  @Test
  void robotLifecycleUsesExplicitStateMethods() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    RobotEntity robot =
        RobotEntity.builder()
            .id(7L)
            .robotCode("RBT-7")
            .label("Courier 7")
            .serialNumber("SN-7")
            .status(RobotStatus.IDLE)
            .online(true)
            .batteryLevel(82)
            .mapId(1L)
            .floorId(2L)
            .poseX(BigDecimal.ZERO)
            .poseY(BigDecimal.ZERO)
            .yawDeg(BigDecimal.ZERO)
            .environment("SIMULATED_ROS")
            .localizationState("Converged")
            .updatedAt(createdAt)
            .build();

    LocalDateTime planningAt = createdAt.plusSeconds(5);
    LocalDateTime navigatingAt = planningAt.plusSeconds(5);
    LocalDateTime pausedAt = navigatingAt.plusSeconds(5);
    LocalDateTime idleAt = pausedAt.plusSeconds(5);
    LocalDateTime stoppedAt = idleAt.plusSeconds(5);

    robot.rename("Courier Alpha");
    robot.markPlanning(planningAt);
    robot.markNavigating(navigatingAt);
    robot.updatePose(BigDecimal.valueOf(10.50), BigDecimal.valueOf(21.25));
    robot.pause(pausedAt);
    robot.markIdle(idleAt);
    robot.emergencyStop("Emergency stop engaged", stoppedAt);

    assertThat(robot.getLabel()).isEqualTo("Courier Alpha");
    assertThat(robot.getPoseX()).isEqualByComparingTo("10.50");
    assertThat(robot.getPoseY()).isEqualByComparingTo("21.25");
    assertThat(robot.getStatus()).isEqualTo(RobotStatus.EMERGENCY_STOP);
    assertThat(robot.getWarning()).isEqualTo("Emergency stop engaged");
    assertThat(robot.getUpdatedAt()).isEqualTo(stoppedAt);
    assertThat(robot.isStoppedForManualControl()).isTrue();
  }
}
