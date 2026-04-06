# Indoory

Indoory is an MVP control web for indoor autonomous delivery robots. The repository is split into a React + Tailwind frontend and a Java Spring Boot backend that exposes operator, robot, task, map, and event APIs.

## Structure

- `frontend/`: React 19, Vite, Tailwind CSS 4, React Query, React Router
- `backend/`: Spring Boot 3.5, Spring Security session auth, JPA, Flyway, PostgreSQL
- `mockup/`: reference-only mockup assets kept outside runtime code
- `docs/`: architecture and API notes for the MVP
- `infra/`: local infrastructure files for development

## MVP scope

- operator login
- dashboard
- robot list and robot detail
- task list and task creation
- semantic map view
- event and telemetry log view

Out of scope for this MVP:

- operator management UI
- settings UI
- building registration
- semantic map generation and editing
- package inventory screens

## Local development

Prerequisites:

- Node.js 20+
- npm 10+
- JDK 21
- Docker Desktop or a local PostgreSQL instance

### 1. Start PostgreSQL

```bash
docker compose -f infra/docker-compose.yml up -d
```

### 2. Run the backend

```bash
cd backend
./gradlew bootRun
```

The backend listens on `http://localhost:8080`.
Swagger UI is available at `http://localhost:8080/swagger-ui.html`.

### 3. Run the frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend listens on `http://localhost:5173` and proxies `/api` requests to the backend.

## Seeded operator account

- Email: `admin@indoory.io`
- Password: `password123`

## Environment

Copy values from `.env.example` if you want to override the defaults. The backend uses:

- `SPRING_DATASOURCE_URL`
- `SPRING_DATASOURCE_USERNAME`
- `SPRING_DATASOURCE_PASSWORD`

The frontend uses:

- `VITE_API_BASE_URL`

## Notes

- `Task` terminology is used everywhere. Legacy `mission` naming has been removed.
- Git uses a single root `.gitignore`.
- The backend currently simulates ROS execution through a scheduled adapter loop so the control UI stays live without a hardware dependency.
- Backend Java code is formatted with Google Java Format through Spotless.
- Backend domain entities avoid public setters and expose behavior through builder/factory and domain methods.
- ArchUnit tests enforce the layered contract: `api`, `service`, `repository`, `entity`, and `config`.
