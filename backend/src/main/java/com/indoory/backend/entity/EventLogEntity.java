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
@Table(name = "event_logs")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
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

  public static EventLogEntity create(
      Long robotId,
      Long taskId,
      EventSeverity severity,
      String type,
      String message,
      LocalDateTime createdAt) {
    return EventLogEntity.builder()
        .robotId(robotId)
        .taskId(taskId)
        .severity(Objects.requireNonNull(severity, "severity must not be null"))
        .type(Objects.requireNonNull(type, "type must not be null"))
        .message(Objects.requireNonNull(message, "message must not be null"))
        .createdAt(Objects.requireNonNull(createdAt, "createdAt must not be null"))
        .build();
  }
}
