package com.indoory.entity;

import com.indoory.entity.Enum.CommandExecutionStatus;
import com.indoory.entity.Enum.CommandType;
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
import lombok.Setter;

@Entity
@Table(name = "command_logs")
@Getter
@Builder(toBuilder = true)
@AllArgsConstructor(access = AccessLevel.PRIVATE)
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CommandLog extends BaseEntity {

  @Column(name = "robot_id", nullable = false)
  private Long robotId;

  @Column(name = "task_id")
  private Long taskId;

  @Enumerated(EnumType.STRING)
  @Column(name = "command_type", nullable = false)
  private CommandType commandType;

  @Column(nullable = false)
  private String parameters;

  // EXECUTING → DONE/FAILED/CANCELED 전이용. ActivityService.markFinished 가 set.
  @Setter
  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private CommandExecutionStatus status;

  @Column(name = "issued_by", nullable = false)
  private String issuedBy;

  // 실행 결과 (JSON 또는 plain string). converged=true/false, error msg 등.
  @Setter
  @Column(name = "result", length = 1024)
  private String result;
}
