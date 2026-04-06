package com.indoory.backend.repository;

import com.indoory.backend.entity.CommandLogEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CommandLogRepository extends JpaRepository<CommandLogEntity, Long> {

  List<CommandLogEntity> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
