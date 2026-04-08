package com.indoory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "floors")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Floor extends BaseEntity {

  public Floor(Long mapId, String code, String name, Integer orderIndex) {
    this.mapId = mapId;
    this.code = code;
    this.name = name;
    this.orderIndex = orderIndex;
  }

  @Column(name = "map_id", nullable = false)
  private Long mapId;

  @Column(nullable = false)
  private String code;

  @Column(nullable = false)
  private String name;

  @Column(name = "order_index", nullable = false)
  private Integer orderIndex;

  @Setter
  @Column(name = "map_image_url")
  private String mapImageUrl;

  @Setter
  @Column(name = "map_pgm_url")
  private String mapPgmUrl;
}
