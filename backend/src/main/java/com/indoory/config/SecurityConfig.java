package com.indoory.config;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

  @Bean
  SecurityFilterChain securityFilterChain(
      HttpSecurity http, SessionAuthenticationFilter sessionAuthenticationFilter) throws Exception {
    return http.csrf(csrf -> csrf.disable())
        .cors(Customizer.withDefaults())
        .sessionManagement(
            session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
        .authorizeHttpRequests(
            authorize ->
                authorize
                    .requestMatchers(
                        "/api/auth/login",
                        "/swagger-ui.html",
                        "/swagger-ui/**",
                        "/v3/api-docs/**",
                        "/api/robots/*/telemetry",
                        // ros_adapter 가 세션 없이 푸시하는 multipart 엔드포인트.
                        // 같은 호스트에서만 호출되며 blob 내용은 로컬 ROS 산출물.
                        "/api/maps/*/rtabmap-db",
                        // ros_adapter ↔ backend server-to-server. ROS 재시작 신호
                        // (모든 robot detach) + OCR spot batch upsert/list. 같은
                        // 호스트 loopback 으로 호출되며 사용자 세션 없음.
                        "/api/robots/session/reset-all",
                        "/api/floors/*/ocr-spots",
                        "/api/floors/*/ocr-spots/batch")
                    .permitAll()
                    .anyRequest()
                    .authenticated())
        .exceptionHandling(
            handling ->
                handling.authenticationEntryPoint(
                    (request, response, authException) -> {
                      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                      response.setContentType("text/plain;charset=UTF-8");
                      response.getWriter().write("Authentication required");
                    }))
        .addFilterBefore(sessionAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
        .build();
  }
}
