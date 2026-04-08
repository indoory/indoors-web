package com.indoory.repository;

import com.indoory.entity.Robot;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RobotRepository extends JpaRepository<Robot, Long> {

  List<Robot> findAllByOrderByIdAsc();
}
