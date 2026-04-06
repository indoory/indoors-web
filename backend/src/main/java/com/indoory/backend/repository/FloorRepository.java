package com.indoory.backend.repository;

import com.indoory.backend.entity.FloorEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FloorRepository extends JpaRepository<FloorEntity, Long> {

  List<FloorEntity> findAllByMapIdOrderByOrderIndexAsc(Long mapId);

  List<FloorEntity> findAllByOrderByOrderIndexAsc();
}
