# Indoory MVP API

This MVP normalizes the original CSV into `task` terminology and fixes path typos.

## Auth API

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

## Robot API

- `GET /api/robots`
- `GET /api/robots/{robotId}`
- `GET /api/robots/{robotId}/state`
- `GET /api/robots/{robotId}/pose`
- `PATCH /api/robots/{robotId}/label`
- `GET /api/robots/{robotId}/tasks`
- `GET /api/robots/{robotId}/commands`
- `POST /api/robots/{robotId}/commands/dispatch`
- `POST /api/robots/{robotId}/commands/pause`
- `POST /api/robots/{robotId}/commands/resume`
- `POST /api/robots/{robotId}/commands/emergency-stop`

## Task API

- `GET /api/tasks`
- `GET /api/tasks/{taskId}`
- `POST /api/tasks`
- `PATCH /api/tasks/{taskId}/cancel`

## Map API

- `GET /api/maps`
- `GET /api/maps/{mapId}`
- `GET /api/maps/current`
- `PATCH /api/maps/{mapId}/activate`
- `POST /api/maps/load`
- `GET /api/floors`

## Event and log API

- `GET /api/events`
- `GET /api/events/{eventId}`

## Task creation payload

```json
{
  "pickupLocationId": 201,
  "dropoffLocationId": 203,
  "priority": "NORMAL"
}
```

## Manual dispatch payload

```json
{
  "locationId": 203
}
```
