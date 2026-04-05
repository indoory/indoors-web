# Indoory MVP Architecture

## Overview

The MVP is intentionally split into a thin React control UI and a Java backend that owns orchestration, task assignment, session auth, and simulated robot execution.

## Layers

### Frontend

- React Router handles page-level navigation.
- React Query handles API state and polling.
- Tailwind utility classes keep the implementation close to the mockup without introducing a heavyweight component system.
- `AppShell` is the only real layout layer. Page content stays close to the screen-level mockup structure.

### Backend

- Controllers expose HTTP APIs.
- Services hold orchestration logic such as login, task assignment, command handling, and simulation.
- Repositories persist and query state from PostgreSQL through JPA.
- Flyway defines the schema and seed data.

## Runtime flow

1. An operator signs in through session-based auth.
2. The frontend polls robot, task, map, and event endpoints.
3. A delivery task is created with pickup, dropoff, and priority.
4. The backend auto-selects the best available robot.
5. The simulated ROS adapter advances the task through pickup, loading, and dropoff.
6. When a robot becomes available, queued tasks are re-evaluated and auto-assigned.

## Dispatch policy

Auto dispatch only considers robots that are:

- online
- `IDLE`
- above the 20% battery threshold
- not already tied to an active task

Selection preference:

1. same active map
2. same floor
3. higher battery
4. fresher heartbeat

## Simulation notes

- The backend does not talk to ROS directly in this MVP.
- Scheduled simulation updates move robots between task stages and emit event/snapshot history.
- Manual robot `dispatch` is kept separate from task creation and is stored as command history.
