package com.indoory.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "tasks")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
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

  public static TaskEntity createDelivery(
      String taskCode,
      TaskPriority priority,
      Long mapId,
      Long floorId,
      Long pickupLocationId,
      Long dropoffLocationId,
      LocalDateTime createdAt) {
    LocalDateTime timestamp = Objects.requireNonNull(createdAt, "createdAt must not be null");
    return TaskEntity.builder()
        .taskCode(Objects.requireNonNull(taskCode, "taskCode must not be null"))
        .type(TaskType.DELIVERY)
        .status(TaskStatus.CREATED)
        .priority(Objects.requireNonNull(priority, "priority must not be null"))
        .mapId(Objects.requireNonNull(mapId, "mapId must not be null"))
        .floorId(Objects.requireNonNull(floorId, "floorId must not be null"))
        .pickupLocationId(
            Objects.requireNonNull(pickupLocationId, "pickupLocationId must not be null"))
        .dropoffLocationId(
            Objects.requireNonNull(dropoffLocationId, "dropoffLocationId must not be null"))
        .currentStage(TaskStage.QUEUED)
        .createdAt(timestamp)
        .stageUpdatedAt(timestamp)
        .build();
  }

  public void assignTo(Long robotId, LocalDateTime assignedAt) {
    this.assignedRobotId = Objects.requireNonNull(robotId, "robotId must not be null");
    this.assignedAt = Objects.requireNonNull(assignedAt, "assignedAt must not be null");
    this.status = TaskStatus.ASSIGNED;
    updateStage(TaskStage.ROUTE_TO_PICKUP, assignedAt);
    this.failureReason = null;
    this.canceledAt = null;
  }

  public void markRunning(LocalDateTime startedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(startedAt, "startedAt must not be null");
    this.status = TaskStatus.RUNNING;
    if (this.startedAt == null) {
      this.startedAt = timestamp;
    }
  }

  public void advanceToLoading(LocalDateTime updatedAt) {
    updateStage(TaskStage.LOADING, updatedAt);
  }

  public void advanceToDropoff(LocalDateTime updatedAt) {
    updateStage(TaskStage.ROUTE_TO_DROPOFF, updatedAt);
  }

  public void pause(LocalDateTime updatedAt) {
    this.status = TaskStatus.PAUSED;
    this.stageUpdatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }

  public void resume(LocalDateTime updatedAt) {
    this.status = TaskStatus.RUNNING;
    this.stageUpdatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }

  public void cancel(LocalDateTime canceledAt) {
    LocalDateTime timestamp = Objects.requireNonNull(canceledAt, "canceledAt must not be null");
    this.status = TaskStatus.CANCELED;
    updateStage(TaskStage.CANCELED, timestamp);
    this.canceledAt = timestamp;
    this.failureReason = null;
  }

  public void fail(String failureReason, LocalDateTime failedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(failedAt, "failedAt must not be null");
    this.status = TaskStatus.FAILED;
    updateStage(TaskStage.FAILED, timestamp);
    this.failureReason = Objects.requireNonNullElse(failureReason, "Task execution failed");
    this.canceledAt = timestamp;
  }

  public void complete(LocalDateTime completedAt) {
    LocalDateTime timestamp = Objects.requireNonNull(completedAt, "completedAt must not be null");
    this.status = TaskStatus.DONE;
    updateStage(TaskStage.COMPLETED, timestamp);
    this.completedAt = timestamp;
    this.failureReason = null;
  }

  public boolean isTerminal() {
    return this.status == TaskStatus.DONE
        || this.status == TaskStatus.CANCELED
        || this.status == TaskStatus.FAILED;
  }

  private void updateStage(TaskStage nextStage, LocalDateTime updatedAt) {
    this.currentStage = Objects.requireNonNull(nextStage, "nextStage must not be null");
    this.stageUpdatedAt = Objects.requireNonNull(updatedAt, "updatedAt must not be null");
  }
}
