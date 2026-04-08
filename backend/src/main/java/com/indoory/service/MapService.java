package com.indoory.service;

import com.indoory.controller.ApiDtos;
import com.indoory.entity.Enum.TaskStatus;
import com.indoory.entity.Floor;
import com.indoory.entity.IndoorMap;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.LocationRepository;
import com.indoory.repository.MapRepository;
import com.indoory.repository.RobotRepository;
import com.indoory.repository.TaskRepository;
import java.awt.image.BufferedImage;
import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import javax.imageio.ImageIO;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
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
  private final RobotAdapterClient adapterClient;

  @Transactional(readOnly = true)
  public List<ApiDtos.MapMetadataResponse> getMaps() {
    return mapRepository.findAll().stream().map(viewAssemblerService::toMapMetadata).toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.CurrentMapResponse getCurrentMap() {
    IndoorMap map =
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
  public ApiDtos.MapMetadataResponse updateNav2YamlUrl(Long mapId, String nav2YamlUrl) {
    IndoorMap map = findMap(mapId);
    map.setNav2YamlUrl(nav2YamlUrl);
    mapRepository.save(map);
    return viewAssemblerService.toMapMetadata(map);
  }

  @Transactional
  public void activate(Long mapId) {
    IndoorMap target = findMap(mapId);
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

  @Transactional
  public ApiDtos.FloorResponse createFloor(ApiDtos.CreateFloorRequest request) {
    int orderIndex =
        request.orderIndex() != null ? request.orderIndex() : (int) floorRepository.count();
    Floor floor = new Floor(request.mapId(), request.code(), request.name(), orderIndex);
    floorRepository.save(floor);
    return buildFloorResponse(floor);
  }

  @Transactional
  public ApiDtos.MapMetadataResponse createMap(ApiDtos.CreateMapRequest request) {
    IndoorMap map = new IndoorMap(request.code(), request.name());
    mapRepository.save(map);
    return viewAssemblerService.toMapMetadata(map);
  }

  @Transactional
  public ApiDtos.FloorResponse uploadFloorMapFile(Long floorId, MultipartFile file) {
    Floor floor = findFloor(floorId);
    try {
      long timestamp = System.currentTimeMillis();
      String pgmFilename = "floor_" + floorId + "_" + timestamp + ".pgm";
      String pngFilename = "floor_" + floorId + "_" + timestamp + ".png";

      Path uploadPath = Paths.get("uploads", "maps");
      if (!Files.exists(uploadPath)) {
        Files.createDirectories(uploadPath);
      }

      Path pgmPath = uploadPath.resolve(pgmFilename);
      Path pngPath = uploadPath.resolve(pngFilename);

      file.transferTo(pgmPath.toFile());

      convertPgmToPng(pgmPath, pngPath);

      floor.setMapPgmUrl("/uploads/maps/" + pgmFilename);
      floor.setMapImageUrl("/uploads/maps/" + pngFilename);
      floorRepository.save(floor);

      return buildFloorResponse(floor);
    } catch (IOException e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "Failed to process map file", e);
    }
  }

  private void convertPgmToPng(Path pgmPath, Path pngPath) throws IOException {
    try (BufferedInputStream bis = new BufferedInputStream(Files.newInputStream(pgmPath))) {
      String magic = readPgmToken(bis);
      if (!"P5".equals(magic)) {
        throw new IOException("Only binary PGM (P5) format is supported.");
      }
      int width = Integer.parseInt(readPgmToken(bis));
      int height = Integer.parseInt(readPgmToken(bis));
      int maxval = Integer.parseInt(readPgmToken(bis));

      BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_BYTE_GRAY);
      byte[] pixels = ((java.awt.image.DataBufferByte) image.getRaster().getDataBuffer()).getData();

      int offset = 0;
      int read;
      while (offset < pixels.length
          && (read = bis.read(pixels, offset, pixels.length - offset)) != -1) {
        offset += read;
      }
      ImageIO.write(image, "png", pngPath.toFile());
    }
  }

  private String readPgmToken(InputStream is) throws IOException {
    StringBuilder sb = new StringBuilder();
    int c;
    while ((c = is.read()) != -1) {
      if (Character.isWhitespace(c)) {
        if (sb.length() > 0) break;
      } else if (c == '#') {
        while ((c = is.read()) != -1 && c != '\n' && c != '\r') {}
      } else {
        sb.append((char) c);
      }
    }
    return sb.toString();
  }

  @Transactional
  public void deleteMap(Long mapId) {
    IndoorMap map = findMap(mapId);
    if (map.isActive()) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete active map");
    }
    // Check if there are robots or tasks on this map
    long robotCount =
        robotRepository.findAllByOrderByIdAsc().stream()
            .filter(robot -> robot.getMapId().equals(mapId))
            .count();
    if (robotCount > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete map with robots");
    }
    long taskCount =
        taskRepository.findAllByOrderByCreatedAtDesc().stream()
            .filter(task -> task.getMapId().equals(mapId))
            .count();
    if (taskCount > 0) {
      throw new ResponseStatusException(HttpStatus.CONFLICT, "Cannot delete map with tasks");
    }
    mapRepository.delete(map);
  }

  private ApiDtos.CurrentMapResponse buildMapResponse(IndoorMap map) {
    List<Floor> floors = floorRepository.findAllByMapIdOrderByOrderIndexAsc(map.getId());
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
        map.isActive(),
        map.getNav2YamlUrl(),
        floorResponses,
        robots,
        activeTasks);
  }

  private ApiDtos.FloorResponse buildFloorResponse(Floor floor) {
    return viewAssemblerService.toFloor(
        floor,
        locationRepository.findAllByFloorIdOrderByIdAsc(floor.getId()).stream()
            .map(location -> viewAssemblerService.toLocation(location, floor))
            .toList());
  }

  private IndoorMap findMap(Long id) {
    return mapRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Map not found"));
  }

  private Floor findFloor(Long id) {
    return floorRepository
        .findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Floor not found"));
  }
}
