package com.indoory.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "maps")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class IndoorMap extends BaseEntity {

  @Column(nullable = false, unique = true)
  private String code;

  @Column(nullable = false)
  private String name;

  @Column(nullable = false)
  private boolean active;

  @Column(name = "nav2_yaml_url")
  private String nav2YamlUrl;

  public IndoorMap(String code, String name) {
    this.code = code;
    this.name = name;
    this.active = false;
  }

  public void setNav2YamlUrl(String nav2YamlUrl) {
    this.nav2YamlUrl = nav2YamlUrl;
  }

  public void activate() {
    this.active = true;
  }

  public void deactivate() {
    this.active = false;
  }
}
