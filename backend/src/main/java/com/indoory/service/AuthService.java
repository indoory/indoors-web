package com.indoory.service;

import com.indoory.config.SessionAuthenticationFilter;
import com.indoory.config.SessionOperator;
import com.indoory.controller.ApiDtos;
import com.indoory.entity.Operator;
import com.indoory.repository.OperatorRepository;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
@RequiredArgsConstructor
public class AuthService {

  private final OperatorRepository operatorRepository;
  private final ViewAssemblerService viewAssemblerService;

  @Transactional
  public ApiDtos.LoginResponse login(ApiDtos.LoginRequest request, HttpServletRequest httpRequest) {
    Operator operator =
        operatorRepository
            .findByEmail(request.email())
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Invalid email or password"));

    if (!operator.getPassword().equals(request.password())) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid email or password");
    }

    operator.recordLoginAt(java.time.LocalDateTime.now());
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
    if (authentication == null
        || !(authentication.getPrincipal() instanceof SessionOperator principal)) {
      throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Authentication required");
    }

    Operator operator =
        operatorRepository
            .findById(principal.operatorId())
            .orElseThrow(
                () ->
                    new ResponseStatusException(
                        HttpStatus.UNAUTHORIZED, "Authentication required"));

    return viewAssemblerService.toOperatorResponse(operator);
  }
}
