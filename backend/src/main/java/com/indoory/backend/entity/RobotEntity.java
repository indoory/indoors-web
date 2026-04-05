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
@Table(name = "robots")
@Getter
@Setter
@NoArgsConstructor
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
}
