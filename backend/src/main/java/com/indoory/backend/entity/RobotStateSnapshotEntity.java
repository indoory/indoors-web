package com.indoory.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "robot_state_snapshots")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RobotStateSnapshotEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "robot_id", nullable = false)
  private Long robotId;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private RobotStatus status;

  @Column(name = "battery_level", nullable = false)
  private Integer batteryLevel;

  @Column(name = "pose_x", nullable = false, precision = 10, scale = 2)
  private BigDecimal poseX;

  @Column(name = "pose_y", nullable = false, precision = 10, scale = 2)
  private BigDecimal poseY;

  @Column(name = "yaw_deg", nullable = false, precision = 10, scale = 2)
  private BigDecimal yawDeg;

  @Column(name = "recorded_at", nullable = false)
  private LocalDateTime recordedAt;

  public static RobotStateSnapshotEntity capture(RobotEntity robot, LocalDateTime recordedAt) {
    Objects.requireNonNull(robot, "robot must not be null");
    return RobotStateSnapshotEntity.builder()
        .robotId(Objects.requireNonNull(robot.getId(), "robotId must not be null"))
        .status(Objects.requireNonNull(robot.getStatus(), "status must not be null"))
        .batteryLevel(
            Objects.requireNonNull(robot.getBatteryLevel(), "batteryLevel must not be null"))
        .poseX(Objects.requireNonNull(robot.getPoseX(), "poseX must not be null"))
        .poseY(Objects.requireNonNull(robot.getPoseY(), "poseY must not be null"))
        .yawDeg(Objects.requireNonNull(robot.getYawDeg(), "yawDeg must not be null"))
        .recordedAt(Objects.requireNonNull(recordedAt, "recordedAt must not be null"))
        .build();
  }
}
