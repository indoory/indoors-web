package com.indoory.config;

import com.indoory.entity.Enum.OperatorRole;
import com.indoory.entity.Operator;
import com.indoory.repository.OperatorRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DataInitializer implements CommandLineRunner {

  private final OperatorRepository operatorRepository;

  @Override
  public void run(String... args) {
    if (operatorRepository.count() == 0) {
      Operator defaultOperator =
          new Operator(
              "admin@indoory.io",
              "password123", // Make sure this matches frontend expectations
              "Admin",
              OperatorRole.ADMIN);
      operatorRepository.save(defaultOperator);
    }
  }
}
