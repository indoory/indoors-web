package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.FloorEntity;

public interface FloorRepository extends JpaRepository<FloorEntity, Long> {

	List<FloorEntity> findAllByMapIdOrderByOrderIndexAsc(Long mapId);

	List<FloorEntity> findAllByOrderByOrderIndexAsc();
}
