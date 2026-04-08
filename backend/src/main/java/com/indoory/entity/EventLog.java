package com.indoory.entity;

import com.indoory.entity.Enum.EventSeverity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
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
public class EventLog extends BaseEntity {

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
}
