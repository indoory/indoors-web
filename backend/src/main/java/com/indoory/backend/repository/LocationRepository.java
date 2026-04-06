package com.indoory.backend.repository;

import com.indoory.backend.entity.LocationEntity;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LocationRepository extends JpaRepository<LocationEntity, Long> {

  List<LocationEntity> findAllByFloorIdOrderByIdAsc(Long floorId);
}
