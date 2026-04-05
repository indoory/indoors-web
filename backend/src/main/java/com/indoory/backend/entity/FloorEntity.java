package com.indoory.backend.entity;

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
@Table(name = "floors")
@Getter
@Setter
@NoArgsConstructor
public class FloorEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "map_id", nullable = false)
	private Long mapId;

	@Column(nullable = false)
	private String code;

	@Column(nullable = false)
	private String name;

	@Column(name = "order_index", nullable = false)
	private Integer orderIndex;

	@Column(nullable = false)
	private Integer width;

	@Column(nullable = false)
	private Integer height;

	@Column(name = "view_box", nullable = false)
	private String viewBox;
}
