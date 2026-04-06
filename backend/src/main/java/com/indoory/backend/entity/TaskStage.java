package com.indoory.backend.entity;

public enum TaskStage {
  QUEUED,
  ROUTE_TO_PICKUP,
  LOADING,
  ROUTE_TO_DROPOFF,
  COMPLETED,
  FAILED,
  CANCELED
}
