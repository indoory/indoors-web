package com.indoory.backend.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "command_logs")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
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

  public static CommandLogEntity create(
      Long robotId,
      Long taskId,
      CommandType commandType,
      String parameters,
      CommandExecutionStatus status,
      String issuedBy,
      LocalDateTime createdAt) {
    return CommandLogEntity.builder()
        .robotId(Objects.requireNonNull(robotId, "robotId must not be null"))
        .taskId(taskId)
        .commandType(Objects.requireNonNull(commandType, "commandType must not be null"))
        .parameters(Objects.requireNonNullElse(parameters, ""))
        .status(Objects.requireNonNull(status, "status must not be null"))
        .issuedBy(Objects.requireNonNull(issuedBy, "issuedBy must not be null"))
        .createdAt(Objects.requireNonNull(createdAt, "createdAt must not be null"))
        .build();
  }
}
