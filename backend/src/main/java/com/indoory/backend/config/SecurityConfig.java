package com.indoory.backend.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import jakarta.servlet.http.HttpServletResponse;

@Configuration
public class SecurityConfig {

	@Bean
	SecurityFilterChain securityFilterChain(
		HttpSecurity http,
		SessionAuthenticationFilter sessionAuthenticationFilter
	) throws Exception {
		return http
			.csrf(csrf -> csrf.disable())
			.cors(Customizer.withDefaults())
			.sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED))
			.authorizeHttpRequests(authorize -> authorize
				.requestMatchers("/api/auth/login").permitAll()
				.anyRequest().authenticated()
			)
			.exceptionHandling(handling -> handling.authenticationEntryPoint((request, response, authException) -> {
				response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
				response.setContentType("text/plain;charset=UTF-8");
				response.getWriter().write("Authentication required");
			}))
			.addFilterBefore(sessionAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
			.build();
	}
}
