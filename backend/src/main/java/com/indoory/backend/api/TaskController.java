package com.indoory.backend.api;

import java.util.List;

import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.indoory.backend.config.SessionOperator;
import com.indoory.backend.service.TaskService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
public class TaskController {

	private final TaskService taskService;

	@GetMapping
	public List<ApiDtos.TaskSummaryResponse> getTasks() {
		return taskService.getTasks();
	}

	@GetMapping("/{taskId}")
	public ApiDtos.TaskDetailResponse getTask(@PathVariable Long taskId) {
		return taskService.getTask(taskId);
	}

	@PostMapping
	public ApiDtos.TaskDetailResponse createTask(
		@Valid @RequestBody ApiDtos.CreateTaskRequest request,
		Authentication authentication
	) {
		return taskService.createTask(request, (SessionOperator) authentication.getPrincipal());
	}

	@PatchMapping("/{taskId}/cancel")
	public void cancelTask(@PathVariable Long taskId, Authentication authentication) {
		taskService.cancelTask(taskId, (SessionOperator) authentication.getPrincipal());
	}
}
