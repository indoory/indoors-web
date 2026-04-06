package com.indoory.backend.repository;

import com.indoory.backend.entity.TaskEntity;
import com.indoory.backend.entity.TaskStatus;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskRepository extends JpaRepository<TaskEntity, Long> {

  List<TaskEntity> findAllByOrderByCreatedAtDesc();

  List<TaskEntity> findAllByAssignedRobotIdOrderByCreatedAtDesc(Long assignedRobotId);

  List<TaskEntity> findAllByStatusInOrderByCreatedAtDesc(Collection<TaskStatus> statuses);

  List<TaskEntity> findAllByStatusOrderByCreatedAtAsc(TaskStatus status);

  Optional<TaskEntity> findTopByOrderByIdDesc();

  Optional<TaskEntity> findFirstByAssignedRobotIdAndStatusInOrderByCreatedAtDesc(
      Long assignedRobotId, Collection<TaskStatus> statuses);
}
