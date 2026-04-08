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

@Entity
@Table(name = "locations")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Location extends BaseEntity {

  @Column(name = "floor_id", nullable = false)
  private Long floorId;

  @Column(nullable = false, unique = true)
  private String code;

  @Column(nullable = false)
  private String name;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private LocationType type;

  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal x;

  @Column(nullable = false, precision = 10, scale = 2)
  private BigDecimal y;
}
