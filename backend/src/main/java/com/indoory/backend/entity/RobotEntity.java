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
@Table(name = "robots")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RobotEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "robot_code", nullable = false, unique = true)
  private String robotCode;

  @Column(nullable = false)
  private String label;

  @Column(name = "serial_number", nullable = false)
  private String serialNumber;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private RobotStatus status;

  @Column(nullable = false)
  private boolean online;

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

  @Column(nullable = false)
  private String environment;

  @Column(name = "localization_state", nullable = false)
  private String localizationState;

  private String warning;

  @Column(name = "updated_at", nullable = false)
  private LocalDateTime updatedAt;

  public void rename(String nextLabel) {
    this.label = requireText(nextLabel, "label");
  }

  public void markPlanning(LocalDateTime updatedAt) {
    this.status = RobotStatus.PLANNING;
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    this.warning = null;
  }

  public void markNavigating(LocalDateTime updatedAt) {
    this.status = RobotStatus.NAVIGATING;
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    this.warning = null;
  }

  public void pause(LocalDateTime updatedAt) {
    this.status = RobotStatus.PAUSED;
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }

  public void markIdle(LocalDateTime updatedAt) {
    this.status = RobotStatus.IDLE;
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
    this.warning = null;
  }

  public void emergencyStop(String warningMessage, LocalDateTime updatedAt) {
    this.status = RobotStatus.EMERGENCY_STOP;
    this.warning = requireText(warningMessage, "warningMessage");
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }

  public void updatePose(BigDecimal nextPoseX, BigDecimal nextPoseY) {
    this.poseX = Objects.requireNonNull(nextPoseX, "nextPoseX must not be null");
    this.poseY = Objects.requireNonNull(nextPoseY, "nextPoseY must not be null");
  }

  public void touch(LocalDateTime updatedAt) {
    this.updatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }

  public boolean isStoppedForManualControl() {
    return this.status == RobotStatus.PAUSED || this.status == RobotStatus.EMERGENCY_STOP;
  }

  private String requireText(String value, String fieldName) {
    String normalized = Objects.requireNonNull(value, fieldName + " must not be null").trim();
    if (normalized.isEmpty()) {
      throw new IllegalArgumentException(fieldName + " must not be blank");
    }
    return normalized;
  }
}
