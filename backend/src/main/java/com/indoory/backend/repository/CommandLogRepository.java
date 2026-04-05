package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.CommandLogEntity;

public interface CommandLogRepository extends JpaRepository<CommandLogEntity, Long> {

	List<CommandLogEntity> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
