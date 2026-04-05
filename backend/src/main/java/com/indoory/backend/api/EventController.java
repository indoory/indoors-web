package com.indoory.backend.api;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.indoory.backend.service.EventService;

import lombok.RequiredArgsConstructor;

@RestController
@RequestMapping("/api/events")
@RequiredArgsConstructor
public class EventController {

	private final EventService eventService;

	@GetMapping
	public List<ApiDtos.EventLogResponse> getEvents() {
		return eventService.getEvents();
	}

	@GetMapping("/{eventId}")
	public ApiDtos.EventLogResponse getEvent(@PathVariable Long eventId) {
		return eventService.getEvent(eventId);
	}
}
