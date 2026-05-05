package com.indoory.entity;

import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Lob;
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

  @Column(nullable = false)
  private boolean active;

  @Column(name = "nav2_yaml_url")
  private String nav2YamlUrl;

  // RTAB-Map .db 영속화. LAZY 로 무거운 blob 이 일반 SELECT 에 묻어가지 않게.
  @Lob
  @Basic(fetch = FetchType.LAZY)
  @Column(name = "rtabmap_db", columnDefinition = "bytea")
  private byte[] rtabmapDb;

  @Column(name = "rtabmap_db_saved_at")
  private Instant rtabmapDbSavedAt;

  public IndoorMap(String code, String name) {
    this.code = code;
    this.name = name;
    this.active = false;
  }

  public void setNav2YamlUrl(String nav2YamlUrl) {
    this.nav2YamlUrl = nav2YamlUrl;
  }

  public void activate() {
    this.active = true;
  }

  public void deactivate() {
    this.active = false;
  }

  public void replaceRtabmapDb(byte[] blob) {
    this.rtabmapDb = blob;
    this.rtabmapDbSavedAt = Instant.now();
  }
}
