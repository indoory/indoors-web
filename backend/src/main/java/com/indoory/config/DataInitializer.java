package com.indoory.config;

import com.indoory.entity.Enum.OperatorRole;
import com.indoory.entity.Enum.RobotStatus;
import com.indoory.entity.Operator;
import com.indoory.entity.Robot;
import com.indoory.repository.OperatorRepository;
import com.indoory.repository.RobotRepository;
import java.math.BigDecimal;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

/**
 * 첫 부팅 시 최소 시드. 운영자 + 로봇 1대 만 생성.
 *
 * <p>맵·층 은 의도적으로 시드 X — 시드된 가짜 맵 이 실제 SLAM 한 적 없는데도
 * "Building 1 / Office floor" 라고 거짓말하던 문제 회피. 사용자가 SLAM 후
 * 명시적으로 'Save Map' 으로 이름 붙여 저장할 때만 maps 테이블 row 생김.
 *
 * <p>로봇은 mapId/floorId NULL 로 시작 = "Unknown session". 사용자가 맵
 * 식별·저장하면 그 시점에 채워짐. 세션 종료 후 unknown 그대로 두면
 * ~/.ros/rtabmap.db 만 남고 DB 메타는 깨끗.
 */
@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

  private final OperatorRepository operatorRepository;
  private final RobotRepository robotRepository;

  @Override
  public void run(String... args) {
    seedOperator();
    seedRobot();
  }

  private void seedOperator() {
    if (operatorRepository.count() > 0) return;
    operatorRepository.save(
        new Operator("admin@indoory.io", "password123", "Admin", OperatorRole.ADMIN));
  }

  private void seedRobot() {
    if (robotRepository.count() > 0) return;
    Robot robot =
        Robot.builder()
            .robotCode("robot-1")
            .label("Robot 1")
            .status(RobotStatus.IDLE)
            .batteryLevel(100)
            .mapId(null)   // Unknown session
            .floorId(null)
            .poseX(BigDecimal.ZERO)
            .poseY(BigDecimal.ZERO)
            .yawDeg(BigDecimal.ZERO)
            .build();
    robotRepository.save(robot);
  }
}
