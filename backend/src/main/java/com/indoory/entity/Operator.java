package com.indoory.entity;

import com.indoory.entity.Enum.OperatorRole;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import java.time.LocalDateTime;
import java.util.Objects;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "operators")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Operator extends BaseEntity {

  public Operator(String email, String password, String name, OperatorRole role) {
    this.email = email;
    this.password = password;
    this.name = name;
    this.role = role;
  }

  @Column(nullable = false, unique = true)
  private String email;

  @Column(nullable = false)
  private String password;

  @Column(nullable = false)
  private String name;

  @Enumerated(EnumType.STRING)
  @Column(nullable = false)
  private OperatorRole role;

  @Column(name = "last_login_at")
  private LocalDateTime lastLoginAt;

  public void recordLoginAt(LocalDateTime loggedInAt) {
    this.lastLoginAt = Objects.requireNonNull(loggedInAt, "loggedInAt must not be null");
  }
}
