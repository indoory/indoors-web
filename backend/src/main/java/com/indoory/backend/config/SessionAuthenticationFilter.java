package com.indoory.backend.config;

import java.io.IOException;
import java.util.List;

import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.indoory.backend.repository.OperatorRepository;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class SessionAuthenticationFilter extends OncePerRequestFilter {

	public static final String SESSION_OPERATOR_ID = "operatorId";

	private final OperatorRepository operatorRepository;

	@Override
	protected void doFilterInternal(
		HttpServletRequest request,
		HttpServletResponse response,
		FilterChain filterChain
	) throws ServletException, IOException {
		HttpSession session = request.getSession(false);
		Object operatorId = session == null ? null : session.getAttribute(SESSION_OPERATOR_ID);

		if (operatorId instanceof Long id && SecurityContextHolder.getContext().getAuthentication() == null) {
			operatorRepository.findById(id).ifPresent(operator -> {
				SessionOperator principal = new SessionOperator(
					operator.getId(),
					operator.getName(),
					operator.getEmail(),
					operator.getRole().name()
				);

				UsernamePasswordAuthenticationToken authentication = new UsernamePasswordAuthenticationToken(
					principal,
					null,
					List.of(new SimpleGrantedAuthority("ROLE_" + operator.getRole().name()))
				);
				SecurityContextHolder.getContext().setAuthentication(authentication);
			});
		}

		filterChain.doFilter(request, response);
	}
}
