package com.indoory.backend.repository;

import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;

import com.indoory.backend.entity.OperatorEntity;

public interface OperatorRepository extends JpaRepository<OperatorEntity, Long> {

	Optional<OperatorEntity> findByEmail(String email);
}
