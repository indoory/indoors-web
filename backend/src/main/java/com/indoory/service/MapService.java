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
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
@Slf4j
public class MapService {

  private final MapRepository mapRepository;
  private final FloorRepository floorRepository;
  private final LocationRepository locationRepository;
  private final RobotRepository robotRepository;
  private final TaskRepository taskRepository;
  private final TaskService taskService;
  private final ViewAssemblerService viewAssemblerService;
  private final RobotAdapterClient adapterClient;
  private final OcrSpotService ocrSpotService;

  @Transactional(readOnly = true)
  public List<ApiDtos.MapMetadataResponse> getMaps() {
    return mapRepository.findAll().stream().map(viewAssemblerService::toMapMetadata).toList();
  }

  @Transactional(readOnly = true)
  public ApiDtos.MapsListResponse getMapsList() {
    int parcelPickupCount =
        (int) locationRepository.countByType(com.indoory.entity.Enum.LocationType.PARCEL_PICKUP);
    return new ApiDtos.MapsListResponse(parcelPickupCount, getMaps());
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
      try {
        boolean deleted = Files.deleteIfExists(Paths.get(path));
        log.info("discardMap[{}]: blob {} {}", mapId, path,
            deleted ? "deleted" : "not present");
      } catch (IOException e) {
        // 권한/lock/disk fail — silently swallow 하면 "삭제했는데 파일 남음"
        // 증상 진단 불가. 명시적 ERROR 로 backend.log 에 흔적 남기기.
        log.error("discardMap[{}]: failed to delete blob {} — {}",
            mapId, path, e.toString());
      }
    }
    mapRepository.delete(map);
    // OCR spot 초기화 (deleteMap 과 동일 이유 — 좌표계 무효).
    try { adapterClient.setOcrFloor(""); } catch (Exception ignored) {}
  }

  /**
   * "Unknown session" 의 현재 rtabmap.db 를 새 맵으로 저장.
   *
   * <p>사용자가 SLAM 한 뒤 "이게 X층이야" 라고 이름 붙이는 시점에 호출. 새 IndoorMap row
   * 만들고 디스크의 ~/.ros/rtabmap.db 를 /var/indoory/maps/{id}.db 로 복사. 호출자가
   * 받은 mapId 로 robot.mapId 갱신하면 더 이상 Unknown 이 아님.
   */
  /**
   * 기존 draft IndoorMap row 를 floor code/name 으로 _승급_ — row 재사용 + working DB
   * snapshot 으로 promote. 옛 mesh 보존, robot.mapId 변경 안 됨.
   *
   * <p>code 컬럼이 unique 라 일반 setter 없음 — reflection 으로 set 후 save.
   * (renameMap 의 name 만 변경하던 것과 같은 패턴 + code 까지 확장.)
   */
  @Transactional
  public IndoorMap promoteDraftToFloor(Long mapId, String newCode, String newName) {
    IndoorMap map = findMap(mapId);
    try {
      var codeF = IndoorMap.class.getDeclaredField("code");
      var nameF = IndoorMap.class.getDeclaredField("name");
      codeF.setAccessible(true);
      nameF.setAccessible(true);
      codeF.set(map, newCode);
      nameF.set(map, newName);
      if (Files.exists(WORKING_DB)) {
        if (!Files.exists(STORAGE_DIR)) Files.createDirectories(STORAGE_DIR);
        Path target = STORAGE_DIR.resolve(map.getId() + ".db");
        Files.copy(WORKING_DB, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        map.recordRtabmapDb(target.toString(), Files.size(target));
      }
      return mapRepository.save(map);
    } catch (Exception e) {
      throw new ResponseStatusException(
          HttpStatus.INTERNAL_SERVER_ERROR, "promote draft failed", e);
    }
  }

  /**
   * row 가 draft (= 사용자가 floor 이름 안 정한 임시) 인지 판단.
   * - name == "Untitled" 또는
   * - code 가 임시 prefix ("session-", "map-") 시작
   * 둘 중 하나면 draft. 사용자가 명시적 floor code 입력했으면 둘 다 아니어서 false.
   */
  public boolean isDraftMap(IndoorMap map) {
    if (map == null) return false;
    if ("Untitled".equals(map.getName())) return true;
    String code = map.getCode();
    return code != null && (code.startsWith("session-") || code.startsWith("map-"));
  }

  /**
   * 현재 working DB 를 (code, name) 의 새 IndoorMap 으로 _adopt_ — 매핑 mesh 보존.
   *
   * <p>사용자가 매핑한 후 floor 입력하는 시점에서 사용. 옛 createMapFromCurrentSession
   * 과 비슷하지만 "Untitled" 가정 없이 운영자 입력 floor code/name 으로 바로 row 생성.
   * 호출 후 RobotController.startSession 이 robot.mapId 갱신.
   *
   * <p>working DB 가 없으면 row 만 만들고 snapshot 은 비워둠 (다음 매핑 진행 후
   * setFloor blob 업로드 시 채워짐).
   */
  @Transactional
  public IndoorMap adoptCurrentSession(String code, String name) {
    IndoorMap map = new IndoorMap(code, name);
    mapRepository.save(map);
    if (Files.exists(WORKING_DB)) {
      try {
        if (!Files.exists(STORAGE_DIR)) Files.createDirectories(STORAGE_DIR);
        Path target = STORAGE_DIR.resolve(map.getId() + ".db");
        Files.copy(WORKING_DB, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        map.recordRtabmapDb(target.toString(), Files.size(target));
        mapRepository.save(map);
      } catch (IOException ignored) {
        // snapshot 실패해도 row 는 살림. 다음 명시적 save 시 채워짐.
      }
    }
    return map;
  }

  @Transactional
  public IndoorMap createMapFromCurrentSession(String name, String code) {
    // 매번 새 row 생성. 이름 중복 허용 — 사용자가 같은 이름으로 여러 번 저장하면
    // 그만큼 row 가 늘어나며 각자 별도 id 와 blob 을 가짐 (버전처럼 동작).
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

  /**
   * RTAB-Map 이 maps/{id}.db 에 직접 incremental write 한 경우, entity 의
   * rtabmapDbSize/SavedAt 컬럼이 stale 함. 디스크 stat 으로 갱신만 수행.
   * 파일 자체는 안 건드림 (RTAB-Map 의 SQLite handle 보호).
   */
  @Transactional
  public ApiDtos.MapMetadataResponse refreshRtabmapDbMetadata(Long mapId) {
    IndoorMap map = findMap(mapId);
    String path = map.getRtabmapDbPath();
    if (path != null) {
      try {
        Path p = Paths.get(path);
        if (Files.exists(p)) {
          map.recordRtabmapDb(path, Files.size(p));
          mapRepository.save(map);
        }
      } catch (IOException ignored) {
        // 디스크 read 실패해도 entity 는 그대로. 다음 시도 때 재시도.
      }
    }
    return viewAssemblerService.toMapMetadata(map);
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

    // 강제 삭제 정책: 어떤 참조든 차단 사유 X.
    //   - Robot.mapId/floorId  → null 화 (Unknown session 복귀)
    //   - Live task            → CANCELED 처리 + mapId 끊기 (이전엔 차단 사유)
    //   - 종료된 task          → mapId 끊기
    //   - Floor 행             → cascade delete (Floor.mapId NOT NULL 이므로
    //                            dangling row 가 다음 시작 시 NPE 유발)
    //   - snapshot blob        → 디스크에서 함께 삭제 (working file ~/.ros/rtabmap.db
    //                            는 공유 자원이라 절대 안 건드림)
    robotRepository.findAllByOrderByIdAsc().stream()
        .filter(robot -> java.util.Objects.equals(robot.getMapId(), mapId))
        .forEach(this::detachRobotFromMap);

    taskRepository.findAllByOrderByCreatedAtDesc().stream()
        .filter(task -> java.util.Objects.equals(task.getMapId(), mapId))
        .forEach(task -> {
          if (LIVE_TASK_STATUSES.contains(task.getStatus())) {
            cancelLiveTask(task);
          }
          detachTaskFromMap(task);
        });

    // Floor 행 삭제 — Floor.mapId 가 NOT NULL 이라 detach 불가능, 행 자체 제거.
    // Location 은 floorId 만 가진 dangling FK 이므로 floor 삭제 전에 cascade 정리.
    // (PARCEL_PICKUP 이 시스템 전역 카운트라 orphan 1개라도 남으면 무결성 깨짐.)
    // OcrSpot 도 같은 floor 종속 — vision pipeline 누적 라벨, 좌표계 무효화되면 의미 X.
    var floorsToDelete = floorRepository.findAllByMapIdOrderByOrderIndexAsc(mapId);
    if (!floorsToDelete.isEmpty()) {
      var floorIds = floorsToDelete.stream().map(Floor::getId).toList();
      locationRepository.deleteAllByFloorIdIn(floorIds);
      ocrSpotService.clearByFloorIds(floorIds);
    }
    floorsToDelete.forEach(floorRepository::delete);

    String path = map.getRtabmapDbPath();
    if (path != null && path.startsWith(STORAGE_DIR.toString())) {
      try {
        boolean deleted = Files.deleteIfExists(Paths.get(path));
        log.info("deleteMap[{}]: blob {} {}", mapId, path,
            deleted ? "deleted" : "not present");
      } catch (IOException e) {
        // silent swallow 대신 명시적 ERROR — 사용자 "삭제했는데 안 됨" 보고 추적용.
        log.error("deleteMap[{}]: failed to delete blob {} — {}",
            mapId, path, e.toString());
      }
    }

    mapRepository.delete(map);

    // OCR spot 도 같이 초기화 — 삭제된 맵 좌표계 위에 잡혔던 트랙은 무효.
    // setOcrFloor('') 가 floor_hint 변경 + adapter cache clear + WS empty push 까지
    // 일괄 처리. adapter 가 미실행이어도 silent skip 이라 안전.
    try { adapterClient.setOcrFloor(""); } catch (Exception ignored) {}
  }

  /** 라이브 task 를 CANCELED 로 강제 종료. Robot 쪽 단방향 관계(Task.assignedRobotId)
   *  라 별도 처리 불필요 — task status 만 바꾸면 history 로 남음. */
  private void cancelLiveTask(com.indoory.entity.Task task) {
    try {
      var statusField = com.indoory.entity.Task.class.getDeclaredField("status");
      statusField.setAccessible(true);
      statusField.set(task, TaskStatus.CANCELED);
      taskRepository.save(task);
    } catch (Exception ignored) {}
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
