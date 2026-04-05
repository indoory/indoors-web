package com.indoory.backend.entity;

import java.math.BigDecimal;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "locations")
@Getter
@Setter
@NoArgsConstructor
public class LocationEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

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

	@Column(nullable = false, precision = 10, scale = 2)
	private BigDecimal width;

	@Column(nullable = false, precision = 10, scale = 2)
	private BigDecimal height;
}
