package com.indoory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "maps")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IndoorMap extends BaseEntity {

  @Column(nullable = false, unique = true)
  private String code;

  @Column(nullable = false)
  private String name;

  // DB schema 의 maps.active NOT NULL 컬럼 매핑. 기본 true — 새 맵은 active 로 생성.
  // 운영자가 비활성화 (archive) 하려면 별도 endpoint 에서 setActive(false).
  @Column(nullable = false)
  private boolean active = true;

  @Column(name = "nav2_yaml_url")
  private String nav2YamlUrl;

  // RTAB-Map .db 는 파일시스템에 저장 (PostgreSQL bytea 1GB 한계 회피).
  // 경로만 DB 에 보존. 블롭 자체는 indoory.maps.storageDir/{id}.db.
  @Column(name = "rtabmap_db_path")
  private String rtabmapDbPath;

  @Column(name = "rtabmap_db_size")
  private Long rtabmapDbSize;

  @Column(name = "rtabmap_db_saved_at")
  private Instant rtabmapDbSavedAt;

  public IndoorMap(String code, String name) {
    this.code = code;
    this.name = name;
  }

  public void setNav2YamlUrl(String nav2YamlUrl) {
    this.nav2YamlUrl = nav2YamlUrl;
  }

  public void recordRtabmapDb(String path, long size) {
    this.rtabmapDbPath = path;
    this.rtabmapDbSize = size;
    this.rtabmapDbSavedAt = Instant.now();
  }
}
