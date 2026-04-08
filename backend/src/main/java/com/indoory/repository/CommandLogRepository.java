package com.indoory.repository;

import com.indoory.entity.CommandLog;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommandLogRepository extends JpaRepository<CommandLog, Long> {

  List<CommandLog> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
