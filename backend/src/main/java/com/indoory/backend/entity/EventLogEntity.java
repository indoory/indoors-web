package com.indoory.backend.entity;

import java.time.LocalDateTime;

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
@Table(name = "event_logs")
@Getter
@Setter
@NoArgsConstructor
public class EventLogEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "robot_id")
	private Long robotId;

	@Column(name = "task_id")
	private Long taskId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private EventSeverity severity;

	@Column(nullable = false)
	private String type;

	@Column(nullable = false, length = 1000)
	private String message;

	@Column(name = "created_at", nullable = false)
	private LocalDateTime createdAt;
}
