package com.indoory.repository;

import com.indoory.entity.Enum.TaskStatus;
import com.indoory.entity.Task;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TaskRepository extends JpaRepository<Task, Long> {

  List<Task> findAllByOrderByCreatedAtDesc();

  List<Task> findAllByAssignedRobotIdOrderByCreatedAtDesc(Long assignedRobotId);

  List<Task> findAllByStatusInOrderByCreatedAtDesc(Collection<TaskStatus> statuses);

  List<Task> findAllByStatusOrderByCreatedAtAsc(TaskStatus status);

  Optional<Task> findTopByOrderByIdDesc();

  Optional<Task> findFirstByAssignedRobotIdAndStatusInOrderByCreatedAtDesc(
      Long assignedRobotId, Collection<TaskStatus> statuses);
}
