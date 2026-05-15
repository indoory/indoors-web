package com.indoory.controller;

import com.indoory.service.OcrSpotService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Floor 별 OCR-detected spot CRUD. adapter 의 vision pipeline 이 누적 batch 로 upsert,
 * UI 는 floor 진입 시 list fetch.
 */
@RestController
@RequestMapping("/api/floors")
@RequiredArgsConstructor
@Tag(name = "OcrSpots", description = "Floor-scoped OCR spot persistence")
public class OcrSpotController {

  private final OcrSpotService ocrSpotService;

  @Operation(summary = "List OCR spots on a floor")
  @GetMapping("/{floorId}/ocr-spots")
  public List<ApiDtos.OcrSpotResponse> list(@PathVariable Long floorId) {
    return ocrSpotService.listByFloor(floorId);
  }

  @Operation(
      summary = "Batch upsert OCR spots",
      description =
          "(floor_id, track_id) 기준 upsert. adapter 가 디바운스해서 confirmed/누적된"
              + " track 들을 한 번에 보냄.")
  @PostMapping("/{floorId}/ocr-spots/batch")
  public List<ApiDtos.OcrSpotResponse> upsertBatch(
      @PathVariable Long floorId, @RequestBody ApiDtos.OcrSpotUpsertBatchRequest req) {
    return ocrSpotService.upsertBatch(floorId, req);
  }

  @Operation(summary = "Clear all OCR spots on a floor")
  @DeleteMapping("/{floorId}/ocr-spots")
  public java.util.Map<String, Object> clear(@PathVariable Long floorId) {
    int n = ocrSpotService.clearFloor(floorId);
    return java.util.Map.of("ok", true, "deleted", n);
  }
}
