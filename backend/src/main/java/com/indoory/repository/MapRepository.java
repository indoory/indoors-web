package com.indoory.repository;

import com.indoory.entity.IndoorMap;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MapRepository extends JpaRepository<IndoorMap, Long> {

  Optional<IndoorMap> findFirstByActiveTrue();
}
