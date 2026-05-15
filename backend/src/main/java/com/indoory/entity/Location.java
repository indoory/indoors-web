package com.indoory.entity;

import com.indoory.entity.Enum.LocationType;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.math.BigDecimal;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "locations")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Location extends BaseEntity {

  public Location(Long floorId, String code, String name, LocationType type, BigDecimal x, BigDecimal y) {
    this.floorId = floorId;
    this.code = code;
    this.name = name;
    this.type = type;
    this.x = x;
    this.y = y;
  }

  @Column(name = "floor_id", nullable = false)
  private Long floorId;

  @Column(nullable = false, unique = true)
  private String code;

  @Setter
  @Column(nullable = false)
  private String name;

  @Setter
  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private LocationType type;

  @Setter
  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal x;

  @Setter
  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal y;
}
