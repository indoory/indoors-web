package com.indoory.entity;

import com.indoory.entity.Enum.RobotStatus;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "robots")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Robot extends BaseEntity {

  @Column(name = "robot_code", nullable = false, unique = true)
  private String robotCode;

  @Column(nullable = false)
  private String label;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private RobotStatus status;

  @Column(name = "battery_level", nullable = false)
  private Integer batteryLevel;

  @Column(name = "map_id", nullable = false)
  private Long mapId;

  @Column(name = "floor_id", nullable = false)
  private Long floorId;

  @Column(name = "pose_x", nullable = false, precision = 10, scale = 2)
  private BigDecimal poseX;

  @Column(name = "pose_y", nullable = false, precision = 10, scale = 2)
  private BigDecimal poseY;

  @Column(name = "yaw_deg", nullable = false, precision = 10, scale = 2)
  private BigDecimal yawDeg;

  public void markPlanning() {
    this.status = RobotStatus.PLANNING;
  }

  public void markNavigating() {
    this.status = RobotStatus.NAVIGATING;
  }

  public void pause() {
    this.status = RobotStatus.PAUSED;
  }

  public void markIdle() {
    this.status = RobotStatus.IDLE;
  }

  public void emergencyStop(String warningMessage) {
    this.status = RobotStatus.EMERGENCY_STOP;
  }

  public void updatePose(BigDecimal nextPoseX, BigDecimal nextPoseY) {
    this.poseX = Objects.requireNonNull(nextPoseX, "nextPoseX must not be null");
    this.poseY = Objects.requireNonNull(nextPoseY, "nextPoseY must not be null");
  }

  public void applyTelemetry(RobotStatus newStatus, BigDecimal x, BigDecimal y, BigDecimal yaw) {
    this.status = newStatus;
    if (x != null) this.poseX = x;
    if (y != null) this.poseY = y;
    this.yawDeg = yaw;
  }

  public boolean isStoppedForManualControl() {
    return this.status == RobotStatus.PAUSED || this.status == RobotStatus.EMERGENCY_STOP;
  }

  public boolean isOnline() {
    return this.status != RobotStatus.OFFLINE;
  }

  public void rename(String newLabel) {
    if (newLabel == null || newLabel.isBlank()) {
      throw new IllegalArgumentException("Label must not be blank");
    }
    this.label = newLabel;
  }
}
