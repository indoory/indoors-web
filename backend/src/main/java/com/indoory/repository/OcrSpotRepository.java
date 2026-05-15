package com.indoory.repository;

import com.indoory.entity.OcrSpot;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface OcrSpotRepository extends JpaRepository<OcrSpot, Long> {

  List<OcrSpot> findAllByFloorIdOrderByIdAsc(Long floorId);

  Optional<OcrSpot> findByFloorIdAndTrackId(Long floorId, String trackId);

  /** Map 삭제 시 그 map 의 floor 들에 속한 spot 일괄 정리. */
  @Modifying
  @Query("delete from OcrSpot s where s.floorId in :floorIds")
  int deleteByFloorIdIn(@Param("floorIds") Collection<Long> floorIds);
}
