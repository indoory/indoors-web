package com.indoory.backend.repository;

import com.indoory.backend.entity.OperatorEntity;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OperatorRepository extends JpaRepository<OperatorEntity, Long> {

  Optional<OperatorEntity> findByEmail(String email);
}
