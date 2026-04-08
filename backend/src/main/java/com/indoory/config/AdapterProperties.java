package com.indoory.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "indoory.bridge")
public class AdapterProperties {

  private boolean enabled = false;
  private String baseUrl = "http://192.168.64.4:8000";
  private String sharedKey = "";

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public String getBaseUrl() {
    return baseUrl;
  }

  public void setBaseUrl(String baseUrl) {
    this.baseUrl = baseUrl;
  }

  public String getSharedKey() {
    return sharedKey;
  }

  public void setSharedKey(String sharedKey) {
    this.sharedKey = sharedKey;
  }
}
