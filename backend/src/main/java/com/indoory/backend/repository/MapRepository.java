package com.indoory.backend.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.MapEntity;

public interface MapRepository extends JpaRepository<MapEntity, Long> {

	Optional<MapEntity> findFirstByActiveTrue();
}
