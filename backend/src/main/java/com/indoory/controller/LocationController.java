package com.indoory.controller;

import com.indoory.service.LocationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Locations", description = "Spot CRUD endpoints (PARCEL_PICKUP enforced unique system-wide)")
public class LocationController {

  private final LocationService locationService;

  @Operation(summary = "Create spot", description = "Adds a spot to the floor.")
  @PostMapping("/floors/{floorId}/locations")
  public ApiDtos.LocationResponse createLocation(
      @PathVariable Long floorId, @RequestBody ApiDtos.CreateLocationRequest request) {
    return locationService.createLocation(floorId, request);
  }

  @Operation(summary = "Update spot", description = "Updates name/type/x/y. Code is immutable.")
  @PatchMapping("/locations/{id}")
  public ApiDtos.LocationResponse updateLocation(
      @PathVariable Long id, @RequestBody ApiDtos.UpdateLocationRequest request) {
    return locationService.updateLocation(id, request);
  }

  @Operation(summary = "Delete spot", description = "Removes the spot.")
  @DeleteMapping("/locations/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteLocation(@PathVariable Long id) {
    locationService.deleteLocation(id);
  }
}
