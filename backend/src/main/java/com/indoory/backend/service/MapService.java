package com.indoory.backend.service;

import com.indoory.backend.api.ApiDtos;
import com.indoory.backend.entity.FloorEntity;
import com.indoory.backend.entity.MapEntity;
import com.indoory.backend.entity.TaskStatus;
import com.indoory.backend.repository.FloorRepository;
import com.indoory.backend.repository.LocationRepository;
import com.indoory.backend.repository.MapRepository;
import com.indoory.backend.repository.RobotRepository;
import com.indoory.backend.repository.TaskRepository;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class MapService {

  private final MapRepository mapRepository;
  private final FloorRepository floorRepository;
  private final LocationRepository locationRepository;
  private final RobotRepository robotRepository;
  private final TaskRepository taskRepository;
  private final TaskService taskService;
  private final ViewAssemblerService viewAssemblerService;

  @Transactional(readOnly = true)
  public List<ApiDtos.MapMetadataResponse> getMaps() {
    return mapRepository.findAll().stream().map(viewAssemblerService::toMapMetadata).toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.CurrentMapResponse getCurrentMap() {
    MapEntity map =
        mapRepository
            .findFirstByActiveTrue()
            .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No active map"));
    return buildMapResponse(map);
  }

  @Transactional(readOnly = true)
  public ApiDtos.CurrentMapResponse getMap(Long mapId) {
    return buildMapResponse(findMap(mapId));
  }

  @Transactional(readOnly = true)
  public List<ApiDtos.FloorResponse> getFloors() {
    return floorRepository.findAllByOrderByOrderIndexAsc().stream()
        .map(
            floor ->
                viewAssemblerService.toFloor(
                    floor,
                    locationRepository.findAllByFloorIdOrderByIdAsc(floor.getId()).stream()
                        .map(location -> viewAssemblerService.toLocation(location, floor))
                        .toList()))
        .toList();
  }

  @Transactional
  public void activate(Long mapId) {
    MapEntity target = findMap(mapId);
    mapRepository
        .findAll()
        .forEach(
            map -> {
              if (map.getId().equals(target.getId())) {
                map.activate();
              } else {
                map.deactivate();
              }
              mapRepository.save(map);
            });
  }

  @Transactional
  public void load(Long mapId) {
    activate(mapId);
  }

  private ApiDtos.CurrentMapResponse buildMapResponse(MapEntity map) {
    List<FloorEntity> floors = floorRepository.findAllByMapIdOrderByOrderIndexAsc(map.getId());
    List<ApiDtos.FloorResponse> floorResponses =
        floors.stream()
            .map(
                floor ->
                    viewAssemblerService.toFloor(
                        floor,
                        locationRepository.findAllByFloorIdOrderByIdAsc(floor.getId()).stream()
                            .map(location -> viewAssemblerService.toLocation(location, floor))
                            .toList()))
            .toList();

    List<ApiDtos.MapRobotResponse> robots =
        robotRepository.findAllByOrderByIdAsc().stream()
            .filter(robot -> robot.getMapId().equals(map.getId()))
            .map(
                robot ->
                    viewAssemblerService.toMapRobot(
                        robot,
                        findFloor(robot.getFloorId()),
                        taskService.findActiveTaskForRobot(robot.getId())))
            .toList();

    List<ApiDtos.MapTaskResponse> activeTasks =
        taskRepository
            .findAllByStatusInOrderByCreatedAtDesc(
                List.of(
                    TaskStatus.ASSIGNED, TaskStatus.RUNNING, TaskStatus.PAUSED, TaskStatus.CREATED))
            .stream()
            .filter(task -> task.getMapId().equals(map.getId()))
            .map(
                task ->
                    viewAssemblerService.toMapTask(
                        task,
                        findFloor(task.getFloorId()),
                        task.getAssignedRobotId() == null
                            ? null
                            : robotRepository.findById(task.getAssignedRobotId()).orElse(null)))
            .toList();

    return new ApiDtos.CurrentMapResponse(
        map.getId(),
        map.getCode(),
        map.getName(),
        map.getVersion(),
        map.getScaleMetersPerPixel(),
        map.isActive(),
        floorResponses,
        robots,
        activeTasks);
  }

  private MapEntity findMap(Long id) {
    return mapRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Map not found"));
  }

  private FloorEntity findFloor(Long id) {
    return floorRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Floor not found"));
  }
}
