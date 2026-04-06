package com.indoory.backend.repository;

import com.indoory.backend.entity.MapEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MapRepository extends JpaRepository<MapEntity, Long> {

  Optional<MapEntity> findFirstByActiveTrue();
}
