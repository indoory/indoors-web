package com.indoory.backend.repository;

import com.indoory.backend.entity.RobotStateSnapshotEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RobotStateSnapshotRepository
    extends JpaRepository<RobotStateSnapshotEntity, Long> {

  List<RobotStateSnapshotEntity> findTop20ByRobotIdOrderByRecordedAtDesc(Long robotId);
}
