package com.indoory.repository;

import com.indoory.entity.Location;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LocationRepository extends JpaRepository<Location, Long> {

  List<Location> findAllByFloorIdOrderByIdAsc(Long floorId);
}
