package com.indoory.repository;

import com.indoory.entity.Operator;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OperatorRepository extends JpaRepository<Operator, Long> {

  Optional<Operator> findByEmail(String email);
}
