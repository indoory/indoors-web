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
@Table(name = "command_logs")
@Getter
@Setter
@NoArgsConstructor
public class CommandLogEntity {

	@Id
	@GeneratedValue(strategy = GenerationType.IDENTITY)
	private Long id;

	@Column(name = "robot_id", nullable = false)
	private Long robotId;

	@Column(name = "task_id")
	private Long taskId;

	@Enumerated(EnumType.STRING)
	@Column(name = "command_type", nullable = false)
	private CommandType commandType;

	@Column(nullable = false)
	private String parameters;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private CommandExecutionStatus status;

	@Column(name = "issued_by", nullable = false)
	private String issuedBy;

	@Column(name = "created_at", nullable = false)
	private LocalDateTime createdAt;
}
