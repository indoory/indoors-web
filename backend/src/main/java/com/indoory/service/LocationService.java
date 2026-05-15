package com.indoory.service;

import com.indoory.controller.ApiDtos;
import com.indoory.entity.Enum.LocationType;
import com.indoory.entity.Floor;
import com.indoory.entity.Location;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.LocationRepository;
import jakarta.transaction.Transactional;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class LocationService {

  private final LocationRepository locationRepository;
  private final FloorRepository floorRepository;
  private final ViewAssemblerService viewAssemblerService;

  @Transactional
  public ApiDtos.LocationResponse createLocation(Long floorId, ApiDtos.CreateLocationRequest request) {
    Floor floor = floorRepository
        .findById(floorId)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "floor not found: " + floorId));

    LocationType type = parseType(request.type());
    enforceParcelPickupUniqueness(type, null);

    String code = (request.code() == null || request.code().isBlank())
        ? generateUniqueCode(floorId, request.name())
        : request.code().trim();
    if (locationRepository.existsByCode(code)) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "location code already exists: " + code);
    }

    Location location = new Location(
        floorId,
        code,
        defaultIfBlank(request.name(), code),
        type,
        nonNull(request.x()),
        nonNull(request.y()));
    locationRepository.save(location);
    return viewAssemblerService.toLocation(location, floor);
  }

  @Transactional
  public ApiDtos.LocationResponse updateLocation(Long id, ApiDtos.UpdateLocationRequest request) {
    Location location = locationRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "location not found: " + id));

    LocationType type = parseType(request.type());
    enforceParcelPickupUniqueness(type, id);

    location.setName(defaultIfBlank(request.name(), location.getName()));
    location.setType(type);
    location.setX(nonNull(request.x()));
    location.setY(nonNull(request.y()));
    locationRepository.save(location);

    Floor floor = floorRepository
        .findById(location.getFloorId())
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "floor not found"));
    return viewAssemblerService.toLocation(location, floor);
  }

  @Transactional
  public void deleteLocation(Long id) {
    if (!locationRepository.existsById(id)) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "location not found: " + id);
    }
    locationRepository.deleteById(id);
  }

  private void enforceParcelPickupUniqueness(LocationType type, Long currentId) {
    if (type != LocationType.PARCEL_PICKUP) return;
    long collisions = currentId == null
        ? locationRepository.countByType(LocationType.PARCEL_PICKUP)
        : locationRepository.countByTypeAndIdNot(LocationType.PARCEL_PICKUP, currentId);
    if (collisions > 0) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "PARCEL_PICKUP already exists — only one parcel pickup is allowed system-wide");
    }
  }

  private LocationType parseType(String raw) {
    if (raw == null || raw.isBlank()) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "type is required");
    }
    try {
      return LocationType.valueOf(raw.trim().toUpperCase());
    } catch (IllegalArgumentException e) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown location type: " + raw);
    }
  }

  // floorId-{slug}[-N] 으로 충돌 회피. Location.code 가 system-wide unique.
  private String generateUniqueCode(Long floorId, String name) {
    String slug = (name == null ? "spot" : name)
        .trim()
        .toLowerCase()
        .replaceAll("[^a-z0-9]+", "-")
        .replaceAll("(^-|-$)", "");
    if (slug.isEmpty()) slug = "spot";
    String base = floorId + "-" + slug;
    if (!locationRepository.existsByCode(base)) return base;
    int n = 2;
    while (locationRepository.existsByCode(base + "-" + n)) {
      n++;
      if (n > 9999) {
        throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "could not generate unique code");
      }
    }
    return base + "-" + n;
  }

  private static String defaultIfBlank(String value, String fallback) {
    return (value == null || value.isBlank()) ? fallback : value.trim();
  }

  private static BigDecimal nonNull(BigDecimal v) {
    return v == null ? BigDecimal.ZERO : v;
  }
}
