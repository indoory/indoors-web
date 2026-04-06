package com.indoory.backend.api;

import com.indoory.backend.service.MapService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Maps", description = "Map, floor, and active map management endpoints")
public class MapController {

  private final MapService mapService;

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
      summary = "Activate map",
      description = "Marks a specific semantic map as the active map.")
  @PatchMapping("/maps/{mapId}/activate")
  public void activate(@PathVariable Long mapId) {
    mapService.activate(mapId);
  }

  @Operation(summary = "Load map", description = "Loads and activates a specific map by id.")
  @PostMapping("/maps/load")
  public void load(@RequestBody java.util.Map<String, Long> payload) {
    mapService.load(payload.get("mapId"));
  }

  @Operation(
      summary = "List floors",
      description = "Returns every floor and its location metadata.")
  @GetMapping("/floors")
  public List<ApiDtos.FloorResponse> getFloors() {
    return mapService.getFloors();
  }
}
