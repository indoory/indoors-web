package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.RobotStateSnapshotEntity;

public interface RobotStateSnapshotRepository extends JpaRepository<RobotStateSnapshotEntity, Long> {

	List<RobotStateSnapshotEntity> findTop20ByRobotIdOrderByRecordedAtDesc(Long robotId);
}
