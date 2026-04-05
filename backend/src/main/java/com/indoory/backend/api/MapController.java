package com.indoory.backend.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.indoory.backend.service.MapService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class MapController {

	private final MapService mapService;

	@GetMapping("/maps")
	public List<ApiDtos.MapMetadataResponse> getMaps() {
		return mapService.getMaps();
	}

	@GetMapping("/maps/current")
	public ApiDtos.CurrentMapResponse getCurrentMap() {
		return mapService.getCurrentMap();
	}

	@GetMapping("/maps/{mapId}")
	public ApiDtos.CurrentMapResponse getMap(@PathVariable Long mapId) {
		return mapService.getMap(mapId);
	}

	@PatchMapping("/maps/{mapId}/activate")
	public void activate(@PathVariable Long mapId) {
		mapService.activate(mapId);
	}

	@PostMapping("/maps/load")
	public void load(@RequestBody java.util.Map<String, Long> payload) {
		mapService.load(payload.get("mapId"));
	}

	@GetMapping("/floors")
	public List<ApiDtos.FloorResponse> getFloors() {
		return mapService.getFloors();
	}
}
