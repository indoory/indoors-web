package com.indoory.backend.architecture;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.classes;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.importer.ImportOption;
import com.tngtech.archunit.junit.AnalyzeClasses;
import com.tngtech.archunit.junit.ArchTest;
import com.tngtech.archunit.lang.ArchRule;
import org.springframework.web.bind.annotation.RestController;

@AnalyzeClasses(
    packages = "com.indoory.backend",
    importOptions = ImportOption.DoNotIncludeTests.class)
class LayeredArchitectureTest {

  @ArchTest
  static final ArchRule entitiesDoNotDependOnOuterLayers =
      noClasses()
          .that()
          .resideInAPackage("..entity..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("..api..", "..service..", "..repository..", "..config..");

  @ArchTest
  static final ArchRule repositoriesDoNotDependOnPresentationOrServices =
      noClasses()
          .that()
          .resideInAPackage("..repository..")
          .should()
          .dependOnClassesThat()
          .resideInAnyPackage("..api..", "..service..");

  @ArchTest
  static final ArchRule configDoesNotDependOnServices =
      noClasses()
          .that()
          .resideInAPackage("..config..")
          .should()
          .dependOnClassesThat()
          .resideInAPackage("..service..");

  @ArchTest
  static final ArchRule controllersDoNotDependOnRepositories =
      classes()
          .that()
          .areAnnotatedWith(RestController.class)
          .should()
          .onlyDependOnClassesThat()
          .resideInAnyPackage(
              "java..",
              "jakarta..",
              "io.swagger.v3..",
              "org.springframework..",
              "org.springdoc..",
              "lombok..",
              "com.indoory.backend.api..",
              "com.indoory.backend.service..",
              "com.indoory.backend.config..");
}
