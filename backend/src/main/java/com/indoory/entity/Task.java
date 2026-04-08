package com.indoory.entity;

import com.indoory.entity.Enum.TaskPriority;
import com.indoory.entity.Enum.TaskStage;
import com.indoory.entity.Enum.TaskStatus;
import com.indoory.entity.Enum.TaskType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "tasks")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Task extends BaseEntity {

  @Column(name = "task_code", nullable = false, unique = true)
  private String taskCode;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private TaskType type;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  @Setter
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
  @Setter
  private Long assignedRobotId;

  @Enumerated(EnumType.STRING)
  @Column(name = "current_stage", nullable = false)
  @Setter
  private TaskStage currentStage;

  @Column(name = "completed_at")
  @Setter
  private LocalDateTime completedAt;

  @Column(name = "failure_reason")
  @Setter
  private String failureReason;

  @Column(name = "stage_updated_at", nullable = false)
  @Setter
  private LocalDateTime stageUpdatedAt;
}
