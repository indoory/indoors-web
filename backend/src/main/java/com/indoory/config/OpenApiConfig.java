package com.indoory.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

  @Bean
  OpenAPI indooryOpenApi() {
    return new OpenAPI()
        .info(
            new Info()
                .title("Indoory Control API")
                .version("v1")
                .description(
                    "Indoor delivery robot control APIs for operators, tasks, maps, robots, and events.")
                .contact(
                    new Contact().name("Indoory").url("https://github.com/indoory/indoors-web")));
  }
}
