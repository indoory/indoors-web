package com.indoory.backend.api;

import com.indoory.backend.config.SessionOperator;
import com.indoory.backend.service.TaskService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/tasks")
@RequiredArgsConstructor
@Tag(name = "Tasks", description = "Task queue, detail, creation, and cancellation endpoints")
public class TaskController {

  private final TaskService taskService;

  @Operation(
      summary = "List tasks",
      description = "Returns every delivery task in descending creation order.")
  @GetMapping
  public List<ApiDtos.TaskSummaryResponse> getTasks() {
    return taskService.getTasks();
  }

  @Operation(
      summary = "Get task detail",
      description = "Returns full detail and timeline information for a single task.")
  @GetMapping("/{taskId}")
  public ApiDtos.TaskDetailResponse getTask(@PathVariable Long taskId) {
    return taskService.getTask(taskId);
  }

  @Operation(
      summary = "Create task",
      description = "Creates a delivery task and attempts immediate auto-dispatch.")
  @PostMapping
  public ApiDtos.TaskDetailResponse createTask(
      @Valid @RequestBody ApiDtos.CreateTaskRequest request, Authentication authentication) {
    return taskService.createTask(request, (SessionOperator) authentication.getPrincipal());
  }

  @Operation(summary = "Cancel task", description = "Cancels a queued or active task.")
  @PatchMapping("/{taskId}/cancel")
  public void cancelTask(@PathVariable Long taskId, Authentication authentication) {
    taskService.cancelTask(taskId, (SessionOperator) authentication.getPrincipal());
  }
}
