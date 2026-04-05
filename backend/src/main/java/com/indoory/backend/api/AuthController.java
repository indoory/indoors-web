package com.indoory.backend.api;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.indoory.backend.service.AuthService;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class AuthController {

	private final AuthService authService;

	@PostMapping("/auth/login")
	public ApiDtos.LoginResponse login(
		@Valid @RequestBody ApiDtos.LoginRequest request,
		HttpServletRequest httpRequest
	) {
		return authService.login(request, httpRequest);
	}

	@PostMapping("/auth/logout")
	public void logout(HttpServletRequest request) {
		authService.logout(request);
	}

	@GetMapping("/me")
	public ApiDtos.OperatorResponse me(Authentication authentication) {
		return authService.currentOperator(authentication);
	}
}
