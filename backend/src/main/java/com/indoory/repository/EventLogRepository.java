package com.indoory.repository;

import com.indoory.entity.EventLog;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EventLogRepository extends JpaRepository<EventLog, Long> {

  List<EventLog> findAllByOrderByCreatedAtDesc();

  List<EventLog> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
