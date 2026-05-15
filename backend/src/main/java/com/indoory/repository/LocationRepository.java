package com.indoory.repository;

import com.indoory.entity.Enum.LocationType;
import com.indoory.entity.Location;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface LocationRepository extends JpaRepository<Location, Long> {

  List<Location> findAllByFloorIdOrderByIdAsc(Long floorId);

  long countByType(LocationType type);

  long countByTypeAndIdNot(LocationType type, Long id);

  Optional<Location> findFirstByType(LocationType type);

  void deleteAllByFloorIdIn(List<Long> floorIds);

  boolean existsByCode(String code);
}
