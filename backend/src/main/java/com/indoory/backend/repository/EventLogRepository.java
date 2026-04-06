package com.indoory.backend.repository;

import com.indoory.backend.entity.EventLogEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EventLogRepository extends JpaRepository<EventLogEntity, Long> {

  List<EventLogEntity> findAllByOrderByCreatedAtDesc();

  List<EventLogEntity> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
