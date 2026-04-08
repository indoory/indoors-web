package com.indoory.controller;

import com.indoory.service.EventService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/events")
@RequiredArgsConstructor
@Tag(name = "Events", description = "Event and log query endpoints")
public class EventController {

  private final EventService eventService;

  @Operation(
      summary = "List events",
      description = "Returns fleet, task, and system events in descending time order.")
  @GetMapping
  public List<ApiDtos.EventLogResponse> getEvents() {
    return eventService.getEvents();
  }

  @Operation(
      summary = "Get event detail",
      description = "Returns the detail for a single event entry.")
  @GetMapping("/{eventId}")
  public ApiDtos.EventLogResponse getEvent(@PathVariable Long eventId) {
    return eventService.getEvent(eventId);
  }
}
