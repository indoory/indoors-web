package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.RobotEntity;

public interface RobotRepository extends JpaRepository<RobotEntity, Long> {

	List<RobotEntity> findAllByOrderByIdAsc();
}
