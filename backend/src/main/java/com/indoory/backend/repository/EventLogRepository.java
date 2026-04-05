package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.EventLogEntity;

public interface EventLogRepository extends JpaRepository<EventLogEntity, Long> {

	List<EventLogEntity> findAllByOrderByCreatedAtDesc();

	List<EventLogEntity> findAllByRobotIdOrderByCreatedAtDesc(Long robotId);
}
