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

  // RTAB-Map 작업 DB (라이브) — 모든 draft 가 이걸 가리킴.
  private static final Path WORKING_DB =
      Paths.get(System.getProperty("user.home"), ".ros", "rtabmap.db");

  /**
   * 'Untitled' draft 에 이름 부여 = 영구 저장 승격.
   *
   * <p>이전엔 cosmetic rename 만 했음. 이젠 ~/.ros/rtabmap.db (라이브 작업본)
   * 을 /var/indoory/maps/{id}.db 로 복사 → 영구 snapshot. row 의 path/size/
   * saved_at + name 모두 갱신. 다음 fetch 에서 새 Untitled 가 자동 생성돼
   * 라이브 working file 을 다시 가리킴.
   */
  @Transactional
  public IndoorMap renameMap(Long mapId, String name) {
    IndoorMap map = findMap(mapId);
    try {
      java.lang.reflect.Field nameField = IndoorMap.class.getDeclaredField("name");
      nameField.setAccessible(true);
      nameField.set(map, name);

      // working file 이 있으면 snapshot 으로 복사 (영구 저장).
      if (Files.exists(WORKING_DB)) {
        if (!Files.exists(STORAGE_DIR)) Files.createDirectories(STORAGE_DIR);
        Path target = STORAGE_DIR.resolve(map.getId() + ".db");
        Files.copy(WORKING_DB, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        map.recordRtabmapDb(target.toString(), Files.size(target));
      }
      return mapRepository.save(map);
    } catch (Exception e) {
      throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "rename failed", e);
    }
  }

  /**
   * 현재 맵 폐기.
   *
   * <p>snapshot 파일 (/var/indoory/maps/) 이 연결돼 있으면 그것만 삭제. ~/.ros/
   * rtabmap.db 같은 working file 은 절대 건드리지 않음 (다른 세션 영향 위험).
   * row 삭제 후 다음 robot fetch 시 새 Untitled 자동 생성.
   */
  @Transactional
  public void discardMap(Long mapId) {
    IndoorMap map = findMap(mapId);
    String path = map.getRtabmapDbPath();
    if (path != null && path.startsWith(STORAGE_DIR.toString())) {
      try { Files.deleteIfExists(Paths.get(path)); } catch (IOException ignored) {}
    }
    mapRepository.delete(map);
  }

  /**
   * "Unknown session" 의 현재 rtabmap.db 를 새 맵으로 저장.
   *
   * <p>사용자가 SLAM 한 뒤 "이게 X층이야" 라고 이름 붙이는 시점에 호출. 새 IndoorMap row
   * 만들고 디스크의 ~/.ros/rtabmap.db 를 /var/indoory/maps/{id}.db 로 복사. 호출자가
   * 받은 mapId 로 robot.mapId 갱신하면 더 이상 Unknown 이 아님.
   */
  @Transactional
  public IndoorMap createMapFromCurrentSession(String name, String code) {
    String resolvedCode = (code == null || code.isBlank())
        ? "map-" + System.currentTimeMillis() : code;
    IndoorMap map = new IndoorMap(resolvedCode, name);
    mapRepository.save(map);
    Path live = Paths.get(System.getProperty("user.home"), ".ros", "rtabmap.db");
    if (Files.exists(live)) {
      try {
        if (!Files.exists(STORAGE_DIR)) Files.createDirectories(STORAGE_DIR);
        Path target = STORAGE_DIR.resolve(map.getId() + ".db");
        Files.copy(live, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        map.recordRtabmapDb(target.toString(), Files.size(target));
        mapRepository.save(map);
      } catch (IOException e) {
        // 메타는 만들고 blob 은 비워둠. 이후 수동 save 로 채울 수 있음.
      }
    }
    return map;
  }

  // ── RTAB-Map .db (파일시스템 저장) ────────────────────────────────────
  // PostgreSQL bytea 1GB 한계 회피. DB 에는 path/size/timestamp 만, 실제 blob 은
  // /var/indoory/maps/{id}.db 로 저장.
  private static final Path STORAGE_DIR = Paths.get(
      System.getenv().getOrDefault("INDOORY_MAP_STORAGE", "/var/indoory/maps"));

  @Transactional
  public void saveRtabmapDb(Long mapId, byte[] blob) {
    IndoorMap map = findMap(mapId);
    try {
      if (!Files.exists(STORAGE_DIR)) Files.createDirectories(STORAGE_DIR);
      Path target = STORAGE_DIR.resolve(mapId + ".db");
      Files.write(target, blob);
      map.recordRtabmapDb(target.toString(), blob.length);
      mapRepository.save(map);
    } catch (IOException e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to write blob to disk", e);
    }
  }

  @Transactional(readOnly = true)
  public byte[] getRtabmapDb(Long mapId) {
    IndoorMap map = findMap(mapId);
    String path = map.getRtabmapDbPath();
    if (path == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no rtabmap_db on map " + mapId);
    }
    try {
      return Files.readAllBytes(Paths.get(path));
    } catch (IOException e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to read blob: " + path, e);
    }
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

  // 라이브 태스크가 점유 중인 상태들. DONE/CANCELED/FAILED 는 이력일 뿐이라 차단 X.
  private static final List<TaskStatus> LIVE_TASK_STATUSES =
      List.of(TaskStatus.CREATED, TaskStatus.ASSIGNED, TaskStatus.RUNNING, TaskStatus.PAUSED);

  @Transactional
  public void deleteMap(Long mapId) {
    IndoorMap map = findMap(mapId);

    // 라이브 태스크가 점유 중이면 차단 (실제로 이 맵의 좌표계를 쓰며 동작 중).
    // Robot.mapId 는 차단 사유가 아니다 — 그건 단지 "마지막으로 라벨링된 곳" 메타데이터일 뿐.
    // 삭제 시 dangling 로봇은 자동 detach (mapId/floorId = NULL → Unknown session 복귀).
    // OCR / 사용자 입력으로 다음 세션 시작될 때 새로 라벨링됨.
    long liveTaskCount =
        taskRepository.findAllByOrderByCreatedAtDesc().stream()
            .filter(task -> java.util.Objects.equals(task.getMapId(), mapId))
            .filter(task -> LIVE_TASK_STATUSES.contains(task.getStatus()))
            .count();
    if (liveTaskCount > 0) {
      throw new ResponseStatusException(
          HttpStatus.CONFLICT,
          "Cannot delete map: " + liveTaskCount + " live task(s) still in progress");
    }

    // 이 맵을 가리키는 로봇 detach — reflection 으로 mapId/floorId 둘 다 null 화.
    robotRepository.findAllByOrderByIdAsc().stream()
        .filter(robot -> java.util.Objects.equals(robot.getMapId(), mapId))
        .forEach(this::detachRobotFromMap);

    // 이 맵에 묶인 종료된 task 들도 mapId 끊어주기 (FK 가 없어도 정합성 보장).
    taskRepository.findAllByOrderByCreatedAtDesc().stream()
        .filter(task -> java.util.Objects.equals(task.getMapId(), mapId))
        .forEach(this::detachTaskFromMap);

    // snapshot blob 만 삭제. working file (~/.ros/rtabmap.db) 은 공유 자원이라 보존.
    String path = map.getRtabmapDbPath();
    if (path != null && path.startsWith(STORAGE_DIR.toString())) {
      try { Files.deleteIfExists(Paths.get(path)); } catch (IOException ignored) {}
    }

    mapRepository.delete(map);
  }

  // mapId/floorId 컬럼은 도메인 메서드가 없어서 reflection 으로만 비울 수 있다
  // (assignMapToRobot 도 같은 방식). 미래에 Robot 에 detach() 메서드 추가하면 정리.
  private void detachRobotFromMap(com.indoory.entity.Robot robot) {
    try {
      var mapField = com.indoory.entity.Robot.class.getDeclaredField("mapId");
      var floorField = com.indoory.entity.Robot.class.getDeclaredField("floorId");
      mapField.setAccessible(true);
      floorField.setAccessible(true);
      mapField.set(robot, null);
      floorField.set(robot, null);
      robotRepository.save(robot);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to detach robot " + robot.getId(), e);
    }
  }

  private void detachTaskFromMap(com.indoory.entity.Task task) {
    try {
      var mapField = com.indoory.entity.Task.class.getDeclaredField("mapId");
      mapField.setAccessible(true);
      mapField.set(task, null);
      taskRepository.save(task);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "failed to detach task " + task.getId(), e);
    }
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
