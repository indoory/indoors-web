package com.indoory.backend.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "robot_state_snapshots")
@Getter
@Setter
@NoArgsConstructor
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
}
