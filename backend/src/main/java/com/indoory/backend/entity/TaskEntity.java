package com.indoory.backend.entity;

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
@Table(name = "tasks")
@Getter
@Setter
@NoArgsConstructor
public class TaskEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "task_code", nullable = false, unique = true)
	private String taskCode;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private TaskType type;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private TaskStatus status;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private TaskPriority priority;

	@Column(name = "map_id", nullable = false)
	private Long mapId;

	@Column(name = "floor_id", nullable = false)
	private Long floorId;

	@Column(name = "pickup_location_id", nullable = false)
	private Long pickupLocationId;

	@Column(name = "dropoff_location_id", nullable = false)
	private Long dropoffLocationId;

	@Column(name = "assigned_robot_id")
	private Long assignedRobotId;

	@Enumerated(EnumType.STRING)
	@Column(name = "current_stage", nullable = false)
	private TaskStage currentStage;

	@Column(name = "created_at", nullable = false)
	private LocalDateTime createdAt;

	@Column(name = "assigned_at")
	private LocalDateTime assignedAt;

	@Column(name = "started_at")
	private LocalDateTime startedAt;

	@Column(name = "completed_at")
	private LocalDateTime completedAt;

	@Column(name = "canceled_at")
	private LocalDateTime canceledAt;

	@Column(name = "failure_reason")
	private String failureReason;

	@Column(name = "stage_updated_at", nullable = false)
	private LocalDateTime stageUpdatedAt;
}
