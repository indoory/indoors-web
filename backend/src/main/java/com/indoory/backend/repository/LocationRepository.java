package com.indoory.backend.repository;

import java.util.List;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.LocationEntity;

public interface LocationRepository extends JpaRepository<LocationEntity, Long> {

	List<LocationEntity> findAllByFloorIdOrderByIdAsc(Long floorId);
}
