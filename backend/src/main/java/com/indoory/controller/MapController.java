package com.indoory.controller;

import com.indoory.service.MapService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.io.IOException;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Maps", description = "Map, floor, and active map management endpoints")
public class MapController {

  private final MapService mapService;

  @Operation(summary = "Create map", description = "Creates a new map.")
  @PostMapping("/maps")
  public ApiDtos.MapMetadataResponse createMap(@RequestBody ApiDtos.CreateMapRequest request) {
    return mapService.createMap(request);
  }

  @Operation(
      summary = "Save current SLAM session as named map",
      description =
          "현재 ~/.ros/rtabmap.db (Unknown session) 를 주어진 이름으로 새 맵 row 생성 + blob 저장.")
  @PostMapping("/maps/save-session")
  public ApiDtos.MapMetadataResponse saveCurrentSession(
      @RequestBody ApiDtos.SaveSessionRequest request) {
    var map = mapService.createMapFromCurrentSession(request.name(), request.code());
    return new ApiDtos.MapMetadataResponse(
        map.getId(),
        map.getCode(),
        map.getName(),
        map.getNav2YamlUrl(),
        map.getRtabmapDbPath(),
        map.getRtabmapDbSize(),
        map.getRtabmapDbSavedAt());
  }

  @Operation(summary = "Rename map", description = "Untitled 맵에 이름 부여 (= 영구 저장).")
  @PatchMapping("/maps/{mapId}/name")
  public ApiDtos.MapMetadataResponse renameMap(
      @PathVariable Long mapId, @RequestBody ApiDtos.RenameMapRequest request) {
    var map = mapService.renameMap(mapId, request.name());
    return new ApiDtos.MapMetadataResponse(
        map.getId(),
        map.getCode(),
        map.getName(),
        map.getNav2YamlUrl(),
        map.getRtabmapDbPath(),
        map.getRtabmapDbSize(),
        map.getRtabmapDbSavedAt());
  }

  @Operation(
      summary = "Discard map",
      description = "맵 row + blob 파일 삭제. 다음 fetch 시 새 Untitled 자동 생성.")
  @DeleteMapping("/maps/{mapId}/discard")
  public void discardMap(@PathVariable Long mapId) {
    mapService.discardMap(mapId);
  }

  @Operation(summary = "List maps", description = "Returns all semantic map metadata entries.")
  @GetMapping("/maps")
  public List<ApiDtos.MapMetadataResponse> getMaps() {
    return mapService.getMaps();
  }

  @Operation(
      summary = "Get map detail",
      description = "Returns a specific map with floor and active entity overlays.")
  @GetMapping("/maps/{mapId}")
  public ApiDtos.CurrentMapResponse getMap(@PathVariable Long mapId) {
    return mapService.getMap(mapId);
  }

  @Operation(
      summary = "Set Nav2 YAML URL",
      description = "Sets the Nav2 map YAML file URL for an adapter to download and use.")
  @PatchMapping("/maps/{mapId}/nav2-yaml-url")
  public ApiDtos.MapMetadataResponse setNav2YamlUrl(
      @PathVariable Long mapId, @RequestBody ApiDtos.Nav2YamlUrlRequest request) {
    return mapService.updateNav2YamlUrl(mapId, request.nav2YamlUrl());
  }

  @Operation(
      summary = "List floors",
      description = "Returns every floor and its location metadata.")
  @GetMapping("/floors")
  public List<ApiDtos.FloorResponse> getFloors() {
    return mapService.getFloors();
  }

  @Operation(summary = "Create floor", description = "Creates a new floor under a map.")
  @PostMapping("/floors")
  public ApiDtos.FloorResponse createFloor(@RequestBody ApiDtos.CreateFloorRequest request) {
    return mapService.createFloor(request);
  }

  @Operation(
      summary = "Upload floor map",
      description = "Uploads a 2D PGM map file, saves it, and generates a PNG for web view.")
  @PostMapping(value = "/floors/{floorId}/map-file", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ApiDtos.FloorResponse uploadFloorMapFile(
      @PathVariable Long floorId, @RequestPart("file") MultipartFile file) {
    return mapService.uploadFloorMapFile(floorId, file);
  }

  @Operation(summary = "Delete map", description = "Deletes a map.")
  @DeleteMapping("/maps/{mapId}")
  public void deleteMap(@PathVariable Long mapId) {
    mapService.deleteMap(mapId);
  }

  // ── RTAB-Map .db blob (멀티세션 SLAM 영속화) ─────────────────────────
  @Operation(
      summary = "Upload RTAB-Map DB",
      description = "ros_adapter 가 백업한 RTAB-Map .db 파일을 multipart 로 업로드.")
  @PostMapping(
      value = "/maps/{mapId}/rtabmap-db",
      consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public void uploadRtabmapDb(
      @PathVariable Long mapId, @RequestPart("file") MultipartFile file) {
    try {
      mapService.saveRtabmapDb(mapId, file.getBytes());
    } catch (IOException e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to read uploaded blob", e);
    }
  }

  @Operation(
      summary = "Download RTAB-Map DB",
      description = "지정 맵의 RTAB-Map .db blob 다운로드 (octet-stream).")
  @GetMapping("/maps/{mapId}/rtabmap-db")
  public ResponseEntity<byte[]> downloadRtabmapDb(@PathVariable Long mapId) {
    byte[] blob = mapService.getRtabmapDb(mapId);
    return ResponseEntity.ok()
        .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"map" + mapId + ".db\"")
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .body(blob);
  }
}
