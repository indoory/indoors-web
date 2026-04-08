package com.indoory.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class RobotTest {

  @Test
  void robotLifecycleUsesExplicitStateMethods() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    Robot robot =
        Robot.builder()
            .robotCode("RBT-7")
            .label("Courier 7")
            .status(BaseEntity.RobotStatus.IDLE)
            .online(true)
            .batteryLevel(82)
            .mapId(1L)
            .floorId(2L)
            .poseX(BigDecimal.ZERO)
            .poseY(BigDecimal.ZERO)
            .yawDeg(BigDecimal.ZERO)
            .build();
    ReflectionTestUtils.setField(robot, "id", 7L);
    ReflectionTestUtils.setField(robot, "createdAt", createdAt);
    ReflectionTestUtils.setField(robot, "updatedAt", createdAt);

    LocalDateTime planningAt = createdAt.plusSeconds(5);
    LocalDateTime navigatingAt = planningAt.plusSeconds(5);
    LocalDateTime pausedAt = navigatingAt.plusSeconds(5);
    LocalDateTime idleAt = pausedAt.plusSeconds(5);
    LocalDateTime stoppedAt = idleAt.plusSeconds(5);

    robot.rename("Courier Alpha");
    robot.markPlanning();
    robot.markNavigating();
    robot.updatePose(BigDecimal.valueOf(10.50), BigDecimal.valueOf(21.25));
    robot.pause();
    robot.markIdle();
    robot.emergencyStop("Emergency stop engaged");

    assertThat(robot.getLabel()).isEqualTo("Courier Alpha");
    assertThat(robot.getPoseX()).isEqualByComparingTo("10.50");
    assertThat(robot.getPoseY()).isEqualByComparingTo("21.25");
    assertThat(robot.getStatus()).isEqualTo(BaseEntity.RobotStatus.EMERGENCY_STOP);
    assertThat(robot.getWarning()).isEqualTo("Emergency stop engaged");
    assertThat(robot.isStoppedForManualControl()).isTrue();
  }
}
