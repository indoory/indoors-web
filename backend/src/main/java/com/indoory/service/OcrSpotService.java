package com.indoory.service;

import com.indoory.controller.ApiDtos;
import com.indoory.entity.OcrSpot;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.OcrSpotRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * OCR-detected spot 영속화. adapter 의 vision pipeline 이 confirmed 또는 충분히
 * 관찰된 candidate track 을 batch 로 upsert. UI 는 floor 진입 시 list fetch.
 *
 * <p>운영자 수동 등록 {@link com.indoory.entity.Location} 과 분리 — Location 은
 * nav goal 의 source-of-truth, OcrSpot 은 자동 라벨링 기록.
 */
@Service
@RequiredArgsConstructor
public class OcrSpotService {

  private final OcrSpotRepository ocrSpotRepository;
  private final FloorRepository floorRepository;

  @Transactional(readOnly = true)
  public List<ApiDtos.OcrSpotResponse> listByFloor(Long floorId) {
    requireFloor(floorId);
    return ocrSpotRepository.findAllByFloorIdOrderByIdAsc(floorId).stream()
        .map(this::toDto)
        .toList();
  }

  /** Batch upsert — (floor_id, track_id) 기준 기존 row 갱신, 없으면 신규 row. */
  @Transactional
  public List<ApiDtos.OcrSpotResponse> upsertBatch(
      Long floorId, ApiDtos.OcrSpotUpsertBatchRequest req) {
    requireFloor(floorId);
    List<ApiDtos.OcrSpotResponse> out = new java.util.ArrayList<>();
    if (req == null || req.spots() == null) return out;
    for (ApiDtos.OcrSpotUpsertRequest s : req.spots()) {
      if (s.trackId() == null || s.trackId().isBlank()) continue;
      OcrSpot row = ocrSpotRepository
          .findByFloorIdAndTrackId(floorId, s.trackId())
          .orElseGet(() -> new OcrSpot(floorId, s.trackId()));
      row.setRoomId(s.roomId());
      row.setX(s.x());
      row.setY(s.y());
      row.setConfidence(s.confidence());
      row.setObservations(s.observations());
      row.setConfirmed(s.confirmed());
      ocrSpotRepository.save(row);
      out.add(toDto(row));
    }
    return out;
  }

  /** Floor 단위 전체 삭제 — adapter 의 reset 또는 운영자 수동 cleanup 용. */
  @Transactional
  public int clearFloor(Long floorId) {
    requireFloor(floorId);
    return ocrSpotRepository.deleteByFloorIdIn(java.util.List.of(floorId));
  }

  /** Map 삭제 시 그 map 의 모든 floor 의 spot 정리 — MapService 에서 호출. */
  @Transactional
  public int clearByFloorIds(java.util.Collection<Long> floorIds) {
    if (floorIds == null || floorIds.isEmpty()) return 0;
    return ocrSpotRepository.deleteByFloorIdIn(floorIds);
  }

  private void requireFloor(Long floorId) {
    if (floorId == null || floorRepository.findById(floorId).isEmpty()) {
      throw new ResponseStatusException(
          HttpStatus.NOT_FOUND, "floor not found: " + floorId);
    }
  }

  private ApiDtos.OcrSpotResponse toDto(OcrSpot s) {
    return new ApiDtos.OcrSpotResponse(
        s.getId(), s.getFloorId(), s.getTrackId(), s.getRoomId(),
        s.getX(), s.getY(), s.getConfidence(), s.getObservations(), s.isConfirmed());
  }
}
