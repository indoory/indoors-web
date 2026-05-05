package com.indoory.service;

import com.indoory.config.AdapterProperties;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestTemplate;

/**
 * Forwards robot commands from the control server (8080) to the ROS2 adapter (8000).
 *
 * <p>All calls are best-effort: failures are logged but do not propagate to the caller, so the
 * management DB is always updated regardless of adapter reachability.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class RobotAdapterClient {

  // Adapter always uses a single robot ID "robot-1" regardless of management DB robot IDs.
  private static final String ADAPTER_ROBOT_ID = "robot-1";

  private final AdapterProperties properties;
  private final RestTemplateBuilder restTemplateBuilder;

  /** Forwards a dispatch command with the target locationId to the adapter. */
  public void dispatch(Long locationId) {
    if (!properties.isEnabled()) return;
    post(
        "/api/robots/" + ADAPTER_ROBOT_ID + "/commands/dispatch", Map.of("locationId", locationId));
  }

  /** Forwards a pause command to the adapter. */
  public void pause() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/commands/pause", null);
  }

  /** Forwards a resume command to the adapter. */
  public void resume() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/commands/resume", null);
  }

  /** Forwards an emergency-stop command to the adapter. */
  public void emergencyStop() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/commands/emergency-stop", null);
  }

  // ── SLAM ─────────────────────────────────────────────────────────────────

  public void startSlam() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/slam/start", null);
  }

  public void startSlamExplore() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/slam/explore/start", null);
  }

  /**
   * Polls the adapter for explore status. Returns the raw response map (e.g. {@code
   * {"exploreStatus":"idle"}}), or an empty map if the adapter is unreachable.
   */
  public Map<String, Object> getSlamExploreStatus() {
    if (!properties.isEnabled()) return Map.of();
    return get("/api/robots/" + ADAPTER_ROBOT_ID + "/slam/explore/status");
  }

  /** mapId 가 함께 전달되어야 어댑터가 Spring 의 /api/maps/{mapId}/rtabmap-db 로 blob 푸시할 수 있다. */
  public void saveSlam(Long mapId, String mapName) {
    if (!properties.isEnabled()) return;
    post(
        "/api/robots/" + ADAPTER_ROBOT_ID + "/slam/save",
        Map.of("mapId", mapId, "mapName", mapName == null ? "" : mapName));
  }

  /** 해당 층의 rtabmap .db blob 을 어댑터에 multipart 로 전달, 어댑터가 rtabmap reload 트리거. */
  public void setFloor(String floorCode, byte[] dbBlob) {
    if (!properties.isEnabled()) return;
    String url = properties.getBaseUrl() + "/api/robots/" + ADAPTER_ROBOT_ID
        + "/floor/set?floorCode=" + floorCode;
    try {
      RestTemplate rt = restTemplateBuilder.build();
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.MULTIPART_FORM_DATA);
      MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
      ByteArrayResource res = new ByteArrayResource(dbBlob) {
        @Override public String getFilename() { return floorCode + ".db"; }
      };
      body.add("file", res);
      rt.postForEntity(url, new HttpEntity<>(body, headers), Void.class);
      log.info("Adapter floor/set sent: {} ({} bytes)", floorCode, dbBlob.length);
    } catch (Exception e) {
      log.warn("Adapter floor/set failed: {} — {}", floorCode, e.getMessage());
    }
  }

  /** 회전·재로컬 트리거. 어댑터가 동기 spin 후 수렴 여부 JSON 반환. */
  public Map<String, Object> relocalize() {
    if (!properties.isEnabled()) return Map.of("converged", false, "skipped", true);
    String url = properties.getBaseUrl() + "/api/robots/" + ADAPTER_ROBOT_ID + "/slam/relocalize";
    try {
      RestTemplate rt = restTemplateBuilder.build();
      return rt.exchange(
          url, HttpMethod.POST, new HttpEntity<>(null, null),
          new ParameterizedTypeReference<Map<String, Object>>() {}).getBody();
    } catch (Exception e) {
      log.warn("Adapter relocalize failed: {}", e.getMessage());
      return Map.of("converged", false, "error", e.getMessage());
    }
  }

  public void stopSlam() {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/slam/stop", null);
  }

  // ── Map & pose ───────────────────────────────────────────────────────────

  /** Tells the adapter to load the given map (by its code, e.g. "floor1"). */
  public void loadMap(String mapCode) {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/map", Map.of("mapId", mapCode));
  }

  /** Sets the robot's initial pose on the adapter. */
  public void setInitialPose(double x, double y, double yaw) {
    if (!properties.isEnabled()) return;
    post("/api/robots/" + ADAPTER_ROBOT_ID + "/initial-pose", Map.of("x", x, "y", y, "yaw", yaw));
  }

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  private Map<String, Object> get(String path) {
    String url = properties.getBaseUrl() + path;
    try {
      RestTemplate restTemplate = restTemplateBuilder.build();
      return restTemplate
          .exchange(
              url, HttpMethod.GET, null, new ParameterizedTypeReference<Map<String, Object>>() {})
          .getBody();
    } catch (Exception e) {
      log.warn("Adapter GET failed: {} — {}", url, e.getMessage());
      return Map.of();
    }
  }

  private void post(String path, Object body) {
    String url = properties.getBaseUrl() + path;
    try {
      RestTemplate restTemplate = restTemplateBuilder.build();
      HttpHeaders headers = new HttpHeaders();
      headers.setContentType(MediaType.APPLICATION_JSON);
      HttpEntity<Object> entity = new HttpEntity<>(body, headers);
      restTemplate.postForEntity(url, entity, Void.class);
      log.info("Adapter command sent: POST {}", url);
    } catch (Exception e) {
      log.warn("Adapter command failed: POST {} — {}", url, e.getMessage());
    }
  }
}
