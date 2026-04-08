package com.indoory.repository;

import com.indoory.entity.Floor;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface FloorRepository extends JpaRepository<Floor, Long> {

  List<Floor> findAllByMapIdOrderByOrderIndexAsc(Long mapId);

  List<Floor> findAllByOrderByOrderIndexAsc();
}
