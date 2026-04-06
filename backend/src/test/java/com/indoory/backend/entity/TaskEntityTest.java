package com.indoory.backend.entity;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class TaskEntityTest {

  @Test
  void createDeliveryInitializesQueuedTaskDefaults() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);

    TaskEntity task =
        TaskEntity.createDelivery("TSK-4001", TaskPriority.HIGH, 10L, 20L, 30L, 40L, createdAt);

    assertThat(task.getTaskCode()).isEqualTo("TSK-4001");
    assertThat(task.getType()).isEqualTo(TaskType.DELIVERY);
    assertThat(task.getStatus()).isEqualTo(TaskStatus.CREATED);
    assertThat(task.getCurrentStage()).isEqualTo(TaskStage.QUEUED);
    assertThat(task.getCreatedAt()).isEqualTo(createdAt);
    assertThat(task.getStageUpdatedAt()).isEqualTo(createdAt);
    assertThat(task.getAssignedRobotId()).isNull();
  }

  @Test
  void taskLifecycleUsesExplicitDomainTransitions() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    TaskEntity task =
        TaskEntity.createDelivery("TSK-4002", TaskPriority.NORMAL, 10L, 20L, 30L, 40L, createdAt);

    LocalDateTime assignedAt = createdAt.plusMinutes(1);
    LocalDateTime startedAt = assignedAt.plusSeconds(10);
    LocalDateTime loadingAt = startedAt.plusSeconds(20);
    LocalDateTime dropoffAt = loadingAt.plusSeconds(15);
    LocalDateTime pausedAt = dropoffAt.plusSeconds(5);
    LocalDateTime resumedAt = pausedAt.plusSeconds(8);
    LocalDateTime completedAt = resumedAt.plusSeconds(25);

    task.assignTo(99L, assignedAt);
    task.markRunning(startedAt);
    task.advanceToLoading(loadingAt);
    task.advanceToDropoff(dropoffAt);
    task.pause(pausedAt);
    task.resume(resumedAt);
    task.complete(completedAt);

    assertThat(task.getAssignedRobotId()).isEqualTo(99L);
    assertThat(task.getAssignedAt()).isEqualTo(assignedAt);
    assertThat(task.getStartedAt()).isEqualTo(startedAt);
    assertThat(task.getStatus()).isEqualTo(TaskStatus.DONE);
    assertThat(task.getCurrentStage()).isEqualTo(TaskStage.COMPLETED);
    assertThat(task.getCompletedAt()).isEqualTo(completedAt);
    assertThat(task.isTerminal()).isTrue();
  }

  @Test
  void failMarksTaskAsTerminalWithReason() {
    LocalDateTime createdAt = LocalDateTime.of(2026, 4, 6, 12, 0);
    TaskEntity task =
        TaskEntity.createDelivery("TSK-4003", TaskPriority.URGENT, 10L, 20L, 30L, 40L, createdAt);
    LocalDateTime failedAt = createdAt.plusMinutes(2);

    task.assignTo(100L, createdAt.plusMinutes(1));
    task.fail("Emergency stop engaged by operator", failedAt);

    assertThat(task.getStatus()).isEqualTo(TaskStatus.FAILED);
    assertThat(task.getCurrentStage()).isEqualTo(TaskStage.FAILED);
    assertThat(task.getFailureReason()).isEqualTo("Emergency stop engaged by operator");
    assertThat(task.getCanceledAt()).isEqualTo(failedAt);
    assertThat(task.isTerminal()).isTrue();
  }
}
