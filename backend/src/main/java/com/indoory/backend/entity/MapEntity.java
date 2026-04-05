package com.indoory.backend.entity;

import java.math.BigDecimal;
import java.time.LocalDateTime;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "maps")
@Getter
@Setter
@NoArgsConstructor
public class MapEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(nullable = false, unique = true)
	private String code;

	@Column(nullable = false)
	private String name;

	@Column(nullable = false)
	private String version;

	@Column(name = "scale_meters_per_pixel", nullable = false)
	private BigDecimal scaleMetersPerPixel;

	@Column(nullable = false)
	private boolean active;

	@Column(name = "created_at", nullable = false)
	private LocalDateTime createdAt;
}
