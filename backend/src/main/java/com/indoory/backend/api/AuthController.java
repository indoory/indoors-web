package com.indoory.backend.api;

import com.indoory.backend.service.AuthService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
@Tag(name = "Auth", description = "Operator authentication and session endpoints")
public class AuthController {

  private final AuthService authService;

  @Operation(
      summary = "Login",
      description = "Creates an operator session with email and password.")
  @PostMapping("/auth/login")
  public ApiDtos.LoginResponse login(
      @Valid @RequestBody ApiDtos.LoginRequest request, HttpServletRequest httpRequest) {
    return authService.login(request, httpRequest);
  }

  @Operation(summary = "Logout", description = "Invalidates the current operator session.")
  @PostMapping("/auth/logout")
  public void logout(HttpServletRequest request) {
    authService.logout(request);
  }

  @Operation(
      summary = "Current operator",
      description = "Returns the currently signed-in operator profile.")
  @GetMapping("/me")
  public ApiDtos.OperatorResponse me(Authentication authentication) {
    return authService.currentOperator(authentication);
  }
}
