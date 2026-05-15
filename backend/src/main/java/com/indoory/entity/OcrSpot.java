package com.indoory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.math.BigDecimal;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 카메라 OCR 로 자동 인식·트래킹된 spot. 운영자 수동 등록 {@link Location} 과 분리 —
 * Location 은 nav goal 의 source-of-truth (ROOM/ELEVATOR/PARCEL_PICKUP 의미 단위),
 * OcrSpot 은 vision pipeline 이 누적해 가는 후보·확정 라벨 (room number 표지판 등).
 *
 * <p>Floor 종속 + (floor_id, track_id) unique. adapter 의 semantic_ocr_node 가
 * 같은 카메라 트랙에 동일 track_id 를 유지하므로 그 단위로 upsert.
 */
@Entity
@Table(
    name = "ocr_spots",
    uniqueConstraints = @UniqueConstraint(
        name = "uk_ocr_spot_floor_track",
        columnNames = {"floor_id", "track_id"}),
    indexes = {@Index(name = "idx_ocr_spot_floor", columnList = "floor_id")})
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OcrSpot extends BaseEntity {

  public OcrSpot(Long floorId, String trackId) {
    this.floorId = floorId;
    this.trackId = trackId;
  }

  @Column(name = "floor_id", nullable = false)
  private Long floorId;

  /** Vision pipeline 의 자체 트랙 식별자. 같은 표지판이 여러 frame 에 걸쳐 누적될 때 동일. */
  @Column(name = "track_id", nullable = false, length = 64)
  private String trackId;

  /** OCR 텍스트로 추정한 room id (예: "503"). 신뢰도 낮은 후보는 null. */
  @Setter
  @Column(name = "room_id", length = 64)
  private String roomId;

  @Setter
  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal x;

  @Setter
  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal y;

  /** 누적 신뢰도 (0..1). vision 측이 매 update 마다 갱신해 보냄. */
  @Setter
  @Column(nullable = false)
  private double confidence;

  /** 같은 트랙으로 누적된 관찰 횟수. */
  @Setter
  @Column(nullable = false)
  private int observations;

  /** vision 측이 "확정" 으로 승급한 트랙. UI 에서 색 분기에 사용. */
  @Setter
  @Column(nullable = false)
  private boolean confirmed;
}
