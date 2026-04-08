package com.indoory.controller;

import com.indoory.service.MapService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
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

  @Operation(summary = "List maps", description = "Returns all semantic map metadata entries.")
  @GetMapping("/maps")
  public List<ApiDtos.MapMetadataResponse> getMaps() {
    return mapService.getMaps();
  }

  @Operation(
      summary = "Get current map",
      description = "Returns the active map with floors, locations, robots, and active tasks.")
  @GetMapping("/maps/current")
  public ApiDtos.CurrentMapResponse getCurrentMap() {
    return mapService.getCurrentMap();
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
      summary = "Activate map",
      description = "Marks a specific semantic map as the active map.")
  @PatchMapping("/maps/{mapId}/activate")
  public void activate(@PathVariable Long mapId) {
    mapService.activate(mapId);
  }

  public record MapLoadRequest(Long mapId) {}

  @Operation(summary = "Load map", description = "Loads and activates a specific map by id.")
  @PostMapping("/maps/load")
  public void load(@RequestBody MapLoadRequest payload) {
    mapService.load(payload.mapId());
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
}
