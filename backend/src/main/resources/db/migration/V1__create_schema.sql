CREATE TABLE operators (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE maps (
    id BIGSERIAL PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(64) NOT NULL,
    scale_meters_per_pixel NUMERIC(10, 2) NOT NULL,
    active BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE floors (
    id BIGSERIAL PRIMARY KEY,
    map_id BIGINT NOT NULL REFERENCES maps(id),
    code VARCHAR(32) NOT NULL,
    name VARCHAR(255) NOT NULL,
    order_index INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    view_box VARCHAR(64) NOT NULL
);

CREATE TABLE locations (
    id BIGSERIAL PRIMARY KEY,
    floor_id BIGINT NOT NULL REFERENCES floors(id),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(32) NOT NULL,
    x NUMERIC(10, 2) NOT NULL,
    y NUMERIC(10, 2) NOT NULL,
    width NUMERIC(10, 2) NOT NULL,
    height NUMERIC(10, 2) NOT NULL
);

CREATE TABLE robots (
    id BIGSERIAL PRIMARY KEY,
    robot_code VARCHAR(64) NOT NULL UNIQUE,
    label VARCHAR(255) NOT NULL,
    serial_number VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    online BOOLEAN NOT NULL,
    battery_level INTEGER NOT NULL,
    map_id BIGINT NOT NULL REFERENCES maps(id),
    floor_id BIGINT NOT NULL REFERENCES floors(id),
    pose_x NUMERIC(10, 2) NOT NULL,
    pose_y NUMERIC(10, 2) NOT NULL,
    yaw_deg NUMERIC(10, 2) NOT NULL,
    environment VARCHAR(64) NOT NULL,
    localization_state VARCHAR(64) NOT NULL,
    warning VARCHAR(255),
    updated_at TIMESTAMP NOT NULL
);

CREATE TABLE tasks (
    id BIGSERIAL PRIMARY KEY,
    task_code VARCHAR(64) NOT NULL UNIQUE,
    type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    priority VARCHAR(32) NOT NULL,
    map_id BIGINT NOT NULL REFERENCES maps(id),
    floor_id BIGINT NOT NULL REFERENCES floors(id),
    pickup_location_id BIGINT NOT NULL REFERENCES locations(id),
    dropoff_location_id BIGINT NOT NULL REFERENCES locations(id),
    assigned_robot_id BIGINT REFERENCES robots(id),
    current_stage VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    assigned_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    canceled_at TIMESTAMP,
    failure_reason VARCHAR(255),
    stage_updated_at TIMESTAMP NOT NULL
);

CREATE TABLE command_logs (
    id BIGSERIAL PRIMARY KEY,
    robot_id BIGINT NOT NULL REFERENCES robots(id),
    task_id BIGINT REFERENCES tasks(id),
    command_type VARCHAR(32) NOT NULL,
    parameters VARCHAR(255) NOT NULL,
    status VARCHAR(32) NOT NULL,
    issued_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE event_logs (
    id BIGSERIAL PRIMARY KEY,
    robot_id BIGINT REFERENCES robots(id),
    task_id BIGINT REFERENCES tasks(id),
    severity VARCHAR(32) NOT NULL,
    type VARCHAR(64) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE robot_state_snapshots (
    id BIGSERIAL PRIMARY KEY,
    robot_id BIGINT NOT NULL REFERENCES robots(id),
    status VARCHAR(32) NOT NULL,
    battery_level INTEGER NOT NULL,
    pose_x NUMERIC(10, 2) NOT NULL,
    pose_y NUMERIC(10, 2) NOT NULL,
    yaw_deg NUMERIC(10, 2) NOT NULL,
    recorded_at TIMESTAMP NOT NULL
);
