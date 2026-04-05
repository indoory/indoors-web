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
import com.indoory.backend.service.RobotService;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/robots")
@RequiredArgsConstructor
public class RobotController {

	private final RobotService robotService;

	@GetMapping
	public List<ApiDtos.RobotSummaryResponse> getRobots() {
		return robotService.getRobots();
	}

	@GetMapping("/{robotId}")
	public ApiDtos.RobotDetailResponse getRobot(@PathVariable Long robotId) {
		return robotService.getRobot(robotId);
	}

	@GetMapping("/{robotId}/state")
	public ApiDtos.RobotStateResponse getRobotState(@PathVariable Long robotId) {
		return robotService.getRobotState(robotId);
	}

	@GetMapping("/{robotId}/pose")
	public ApiDtos.RobotPoseResponse getRobotPose(@PathVariable Long robotId) {
		return robotService.getRobotPose(robotId);
	}

	@PatchMapping("/{robotId}/label")
	public ApiDtos.RobotSummaryResponse renameRobot(
		@PathVariable Long robotId,
		@Valid @RequestBody ApiDtos.RobotLabelRequest request
	) {
		return robotService.renameRobot(robotId, request);
	}

	@GetMapping("/{robotId}/tasks")
	public List<ApiDtos.TaskSummaryResponse> getRobotTasks(@PathVariable Long robotId) {
		return robotService.getRobotTasks(robotId);
	}

	@GetMapping("/{robotId}/commands")
	public List<ApiDtos.CommandLogResponse> getRobotCommands(@PathVariable Long robotId) {
		return robotService.getRobotCommands(robotId);
	}

	@GetMapping("/{robotId}/logs")
	public List<ApiDtos.RobotStateSnapshotResponse> getRobotLogs(@PathVariable Long robotId) {
		return robotService.getRobotLogs(robotId);
	}

	@PostMapping("/{robotId}/commands/dispatch")
	public void dispatch(
		@PathVariable Long robotId,
		@Valid @RequestBody ApiDtos.DispatchCommandRequest request,
		Authentication authentication
	) {
		robotService.dispatch(robotId, request, (SessionOperator) authentication.getPrincipal());
	}

	@PostMapping("/{robotId}/commands/pause")
	public void pause(@PathVariable Long robotId, Authentication authentication) {
		robotService.pause(robotId, (SessionOperator) authentication.getPrincipal());
	}

	@PostMapping("/{robotId}/commands/resume")
	public void resume(@PathVariable Long robotId, Authentication authentication) {
		robotService.resume(robotId, (SessionOperator) authentication.getPrincipal());
	}

	@PostMapping("/{robotId}/commands/emergency-stop")
	public void emergencyStop(@PathVariable Long robotId, Authentication authentication) {
		robotService.emergencyStop(robotId, (SessionOperator) authentication.getPrincipal());
	}
}
