package com.indoory.backend.config;

import java.security.Principal;

public record SessionOperator(Long operatorId, String name, String email, String role) implements Principal {

	@Override
	public String getName() {
		return name;
	}
}
