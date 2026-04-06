package com.indoory.backend.repository;

import com.indoory.backend.entity.RobotEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RobotRepository extends JpaRepository<RobotEntity, Long> {

  List<RobotEntity> findAllByOrderByIdAsc();
}
