package com.indoory.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class TaskTest {

  @Test
  void createDeliveryInitializesQueuedTaskDefaults() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);

    Task task = newTask("TSK-4001", BaseEntity.TaskPriority.HIGH, createdAt);

    assertThat(task.getTaskCode()).isEqualTo("TSK-4001");
    assertThat(task.getType()).isEqualTo(BaseEntity.TaskType.DELIVERY);
    assertThat(task.getStatus()).isEqualTo(BaseEntity.TaskStatus.CREATED);
    assertThat(task.getCurrentStage()).isEqualTo(BaseEntity.TaskStage.QUEUED);
    assertThat(task.getCreatedAt()).isEqualTo(createdAt);
    assertThat(task.getStageUpdatedAt()).isEqualTo(createdAt);
    assertThat(task.getAssignedRobotId()).isNull();
  }

  @Test
  void taskOnlyKeepsMinimalMutableFields() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    Task task = newTask("TSK-4002", BaseEntity.TaskPriority.NORMAL, createdAt);
    LocalDateTime completedAt = createdAt.plusMinutes(1);

    task.setAssignedRobotId(99L);
    task.setStatus(BaseEntity.TaskStatus.DONE);
    task.setCurrentStage(BaseEntity.TaskStage.COMPLETED);
    task.setCompletedAt(completedAt);
    task.setFailureReason(null);
    task.setStageUpdatedAt(completedAt);

    assertThat(task.getAssignedRobotId()).isEqualTo(99L);
    assertThat(task.getStatus()).isEqualTo(BaseEntity.TaskStatus.DONE);
    assertThat(task.getCurrentStage()).isEqualTo(BaseEntity.TaskStage.COMPLETED);
    assertThat(task.getCompletedAt()).isEqualTo(completedAt);
    assertThat(task.getFailureReason()).isNull();
    assertThat(task.getStageUpdatedAt()).isEqualTo(completedAt);
  }

  @Test
  void taskCanStoreFailureReason() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    Task task = newTask("TSK-4003", BaseEntity.TaskPriority.URGENT, createdAt);
    LocalDateTime failedAt = createdAt.plusMinutes(2);

    task.setAssignedRobotId(100L);
    task.setStatus(BaseEntity.TaskStatus.FAILED);
    task.setCurrentStage(BaseEntity.TaskStage.FAILED);
    task.setFailureReason("Emergency stop engaged by operator");
    task.setStageUpdatedAt(failedAt);

    assertThat(task.getStatus()).isEqualTo(BaseEntity.TaskStatus.FAILED);
    assertThat(task.getCurrentStage()).isEqualTo(BaseEntity.TaskStage.FAILED);
    assertThat(task.getFailureReason()).isEqualTo("Emergency stop engaged by operator");
    assertThat(task.getStageUpdatedAt()).isEqualTo(failedAt);
  }

  private Task newTask(String taskCode, BaseEntity.TaskPriority priority, LocalDateTime createdAt) {
    Task task =
        Task.builder()
            .taskCode(taskCode)
            .type(BaseEntity.TaskType.DELIVERY)
            .status(BaseEntity.TaskStatus.CREATED)
            .priority(priority)
            .mapId(10L)
            .floorId(20L)
            .pickupLocationId(30L)
            .dropoffLocationId(40L)
            .currentStage(BaseEntity.TaskStage.QUEUED)
            .stageUpdatedAt(createdAt)
            .build();
    ReflectionTestUtils.setField(task, "createdAt", createdAt);
    ReflectionTestUtils.setField(task, "updatedAt", createdAt);
    return task;
  }
}
