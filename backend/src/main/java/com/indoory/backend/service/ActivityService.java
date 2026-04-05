package com.indoory.backend.service;

import java.time.LocalDateTime;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.indoory.backend.entity.CommandExecutionStatus;
import com.indoory.backend.entity.CommandLogEntity;
import com.indoory.backend.entity.CommandType;
import com.indoory.backend.entity.EventLogEntity;
import com.indoory.backend.entity.EventSeverity;
import com.indoory.backend.entity.RobotEntity;
import com.indoory.backend.entity.RobotStateSnapshotEntity;
import com.indoory.backend.repository.CommandLogRepository;
import com.indoory.backend.repository.EventLogRepository;
import com.indoory.backend.repository.RobotStateSnapshotRepository;

import lombok.RequiredArgsConstructor;

@Service
@RequiredArgsConstructor
public class ActivityService {

	private final CommandLogRepository commandLogRepository;
	private final EventLogRepository eventLogRepository;
	private final RobotStateSnapshotRepository robotStateSnapshotRepository;

	@Transactional
	public void recordEvent(
		Long robotId,
		Long taskId,
		EventSeverity severity,
		String type,
		String message
	) {
		EventLogEntity event = new EventLogEntity();
		event.setRobotId(robotId);
		event.setTaskId(taskId);
		event.setSeverity(severity);
		event.setType(type);
		event.setMessage(message);
		event.setCreatedAt(LocalDateTime.now());
		eventLogRepository.save(event);
	}

	@Transactional
	public void recordCommand(
		Long robotId,
		Long taskId,
		CommandType commandType,
		String parameters,
		CommandExecutionStatus status,
		String issuedBy
	) {
		CommandLogEntity command = new CommandLogEntity();
		command.setRobotId(robotId);
		command.setTaskId(taskId);
		command.setCommandType(commandType);
		command.setParameters(parameters == null ? "" : parameters);
		command.setStatus(status);
		command.setIssuedBy(issuedBy);
		command.setCreatedAt(LocalDateTime.now());
		commandLogRepository.save(command);
	}

	@Transactional
	public void captureSnapshot(RobotEntity robot) {
		RobotStateSnapshotEntity snapshot = new RobotStateSnapshotEntity();
		snapshot.setRobotId(robot.getId());
		snapshot.setStatus(robot.getStatus());
		snapshot.setBatteryLevel(robot.getBatteryLevel());
		snapshot.setPoseX(robot.getPoseX());
		snapshot.setPoseY(robot.getPoseY());
		snapshot.setYawDeg(robot.getYawDeg());
		snapshot.setRecordedAt(LocalDateTime.now());
		robotStateSnapshotRepository.save(snapshot);
	}
}
