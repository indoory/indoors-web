package com.indoory.backend.service;

import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.indoory.backend.api.ApiDtos;
import com.indoory.backend.config.SessionAuthenticationFilter;
import com.indoory.backend.config.SessionOperator;
import com.indoory.backend.entity.OperatorEntity;
import com.indoory.backend.repository.OperatorRepository;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class AuthService {

	private final OperatorRepository operatorRepository;
	private final ViewAssemblerService viewAssemblerService;

	@Transactional
	public ApiDtos.LoginResponse login(ApiDtos.LoginRequest request, HttpServletRequest httpRequest) {
		OperatorEntity operator = operatorRepository.findByEmail(request.email())
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password"));

		if (!operator.getPassword().equals(request.password())) {
			throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
		}

		operator.setLastLoginAt(java.time.LocalDateTime.now());
		operatorRepository.save(operator);

		HttpSession session = httpRequest.getSession(true);
		session.setAttribute(SessionAuthenticationFilter.SESSION_OPERATOR_ID, operator.getId());

		return new ApiDtos.LoginResponse(viewAssemblerService.toOperatorResponse(operator));
	}

	public void logout(HttpServletRequest request) {
		HttpSession session = request.getSession(false);
		if (session != null) {
			session.invalidate();
		}
	}

	@Transactional(readOnly = true)
	public ApiDtos.OperatorResponse currentOperator(Authentication authentication) {
		if (authentication == null || !(authentication.getPrincipal() instanceof SessionOperator principal)) {
			throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
		}

		OperatorEntity operator = operatorRepository.findById(principal.operatorId())
			.orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required"));

		return viewAssemblerService.toOperatorResponse(operator);
	}
}
