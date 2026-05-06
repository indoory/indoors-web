package com.indoory.config;

import com.indoory.entity.Enum.OperatorRole;
import com.indoory.entity.Enum.RobotStatus;
import com.indoory.entity.Floor;
import com.indoory.entity.IndoorMap;
import com.indoory.entity.Operator;
import com.indoory.entity.Robot;
import com.indoory.repository.FloorRepository;
import com.indoory.repository.MapRepository;
import com.indoory.repository.OperatorRepository;
import com.indoory.repository.RobotRepository;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * 첫 부팅 시 멀티세션 SLAM 시연용 최소 데이터 시드.
 *
 * <p>운영자 1, 맵 1 (active), 층 2 (office/hospital — elevator_teleport.py
 * BUILDINGS 와 코드 일치), 로봇 1. 어댑터의 ADAPTER_ROBOT_ID="robot-1" 은
 * Spring 의 Long id 와 무관한 식별자이므로 UI 가 robot.id=1 을 선택해도 어댑터
 * 호출은 항상 "robot-1" 슬러그로 변환된다.
 */
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

  private final OperatorRepository operatorRepository;
  private final MapRepository mapRepository;
  private final FloorRepository floorRepository;
  private final RobotRepository robotRepository;

  @Override
  public void run(String... args) {
    seedOperator();
    Long mapId = seedMap();
    Long officeFloorId = seedFloor(mapId, "office", "Office", 0);
    seedFloor(mapId, "hospital", "Hospital", 1);
    seedRobot(mapId, officeFloorId);
  }

  private void seedOperator() {
    if (operatorRepository.count() > 0) return;
    operatorRepository.save(
        new Operator("admin@indoory.io", "password123", "Admin", OperatorRole.ADMIN));
  }

  private Long seedMap() {
    return mapRepository
        .findFirstByActiveTrue()
        .map(IndoorMap::getId)
        .orElseGet(
            () -> {
              IndoorMap map = new IndoorMap("building1", "Building 1");
              map.activate();
              return mapRepository.save(map).getId();
            });
  }

  private Long seedFloor(Long mapId, String code, String name, int orderIndex) {
    return floorRepository.findAllByMapIdOrderByOrderIndexAsc(mapId).stream()
        .filter(f -> code.equals(f.getCode()))
        .findFirst()
        .map(Floor::getId)
        .orElseGet(() -> floorRepository.save(new Floor(mapId, code, name, orderIndex)).getId());
  }

  private void seedRobot(Long mapId, Long floorId) {
    if (robotRepository.count() > 0) return;
    Robot robot =
        Robot.builder()
            .robotCode("robot-1")
            .label("Robot 1")
            .status(RobotStatus.IDLE)
            .batteryLevel(100)
            .mapId(mapId)
            .floorId(floorId)
            .poseX(BigDecimal.valueOf(-3.00))
            .poseY(BigDecimal.valueOf(0.00))
            .yawDeg(BigDecimal.ZERO)
            .build();
    robotRepository.save(robot);
  }
}
