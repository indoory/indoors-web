INSERT INTO operators (id, email, password, name, role, last_login_at, created_at)
VALUES
    (1, 'admin@indoory.io', 'password123', 'Indoory Admin', 'ADMIN', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '120 days');

INSERT INTO maps (id, code, name, version, scale_meters_per_pixel, active, created_at)
VALUES
    (1, 'hq-semantic-map', 'Indoory HQ Semantic Map', 'v1.3', 0.05, TRUE, NOW() - INTERVAL '90 days');

INSERT INTO floors (id, map_id, code, name, order_index, width, height, view_box)
VALUES
    (1, 1, 'B1', 'B1 Basement Floor', 1, 800, 560, '0 0 800 560'),
    (2, 1, '1F', '1F First Floor', 2, 800, 560, '0 0 800 560'),
    (3, 1, '2F', '2F Second Floor', 3, 800, 560, '0 0 800 560');

INSERT INTO locations (id, floor_id, code, name, type, x, y, width, height)
VALUES
    (101, 1, 'B1-LOBBY', 'Lobby-B1', 'LOBBY', 80, 60, 150, 120),
    (102, 1, 'B1-KITCHEN', 'Kitchen-B1', 'ROOM', 90, 330, 150, 120),
    (103, 1, 'B1-STORAGE', 'Storage-B1', 'STORAGE', 260, 330, 120, 120),
    (104, 1, 'B1-ROOM-102', 'Room-B102', 'ROOM', 520, 320, 120, 120),
    (105, 1, 'B1-ELEVATOR', 'Elevator-B1', 'ELEVATOR', 650, 300, 100, 180),
    (201, 2, '1F-LOBBY', 'Lobby', 'LOBBY', 80, 60, 140, 140),
    (202, 2, '1F-RECEPTION', 'Reception', 'RECEPTION', 250, 60, 120, 140),
    (203, 2, '1F-ROOM-101', 'Room-101', 'ROOM', 400, 60, 110, 140),
    (204, 2, '1F-ROOM-103', 'Room-103', 'ROOM', 530, 60, 110, 140),
    (205, 2, '1F-ROOM-105', 'Room-105', 'ROOM', 660, 60, 100, 140),
    (206, 2, '1F-KITCHEN', 'Kitchen', 'ROOM', 90, 330, 140, 120),
    (207, 2, '1F-STORAGE', 'Storage', 'STORAGE', 250, 330, 120, 120),
    (208, 2, '1F-ROOM-108', 'Room-108', 'ROOM', 530, 330, 110, 120),
    (209, 2, '1F-ELEVATOR', 'Elevator-1F', 'ELEVATOR', 660, 320, 100, 180),
    (301, 3, '2F-LAB-201', 'Lab-201', 'LAB', 90, 70, 150, 140),
    (302, 3, '2F-OFFICE-205', 'Office-205', 'OFFICE', 510, 70, 130, 140),
    (303, 3, '2F-OFFICE-208', 'Office-208', 'OFFICE', 520, 330, 130, 120),
    (304, 3, '2F-ELEVATOR', 'Elevator-2F', 'ELEVATOR', 660, 300, 100, 180);

INSERT INTO robots (
    id, robot_code, label, serial_number, status, online, battery_level, map_id, floor_id,
    pose_x, pose_y, yaw_deg, environment, localization_state, warning, updated_at
)
VALUES
    (1, 'RBT-001', 'Robot-01', 'SN-001', 'NAVIGATING', TRUE, 78, 1, 1, 215, 370, 42, 'SIMULATED_ROS', 'Converged', NULL, NOW() - INTERVAL '10 seconds'),
    (2, 'RBT-002', 'Robot-02', 'SN-002', 'NAVIGATING', TRUE, 63, 1, 2, 350, 260, 8, 'SIMULATED_ROS', 'Converged', NULL, NOW() - INTERVAL '8 seconds'),
    (3, 'RBT-003', 'Robot-03', 'SN-003', 'IDLE', TRUE, 12, 1, 2, 305, 380, 0, 'SIMULATED_ROS', 'Converged', 'Battery level below 15%', NOW() - INTERVAL '1 minute'),
    (4, 'RBT-004', 'Robot-04', 'SN-004', 'IDLE', TRUE, 92, 1, 2, 300, 370, 180, 'SIMULATED_ROS', 'Converged', NULL, NOW() - INTERVAL '30 seconds'),
    (5, 'RBT-005', 'Robot-05', 'SN-005', 'ERROR', TRUE, 45, 1, 3, 545, 190, 0, 'SIMULATED_ROS', 'Diverged', 'Localization failure', NOW() - INTERVAL '2 minutes'),
    (6, 'RBT-006', 'Robot-06', 'SN-006', 'PLANNING', TRUE, 70, 1, 2, 455, 260, 90, 'SIMULATED_ROS', 'Converged', NULL, NOW() - INTERVAL '12 seconds'),
    (7, 'RBT-007', 'Robot-07', 'SN-007', 'OFFLINE', FALSE, 18, 1, 3, 620, 340, 0, 'SIMULATED_ROS', 'Unknown', NULL, NOW() - INTERVAL '2 hours'),
    (8, 'RBT-008', 'Robot-08', 'SN-008', 'OFFLINE', FALSE, 80, 1, 2, 150, 140, 0, 'SIMULATED_ROS', 'Unknown', NULL, NOW() - INTERVAL '5 hours');

INSERT INTO tasks (
    id, task_code, type, status, priority, map_id, floor_id, pickup_location_id, dropoff_location_id,
    assigned_robot_id, current_stage, created_at, assigned_at, started_at, completed_at, canceled_at, failure_reason, stage_updated_at
)
VALUES
    (4038, 'TSK-4038', 'DELIVERY', 'DONE', 'NORMAL', 1, 2, 201, 203, 2, 'COMPLETED', NOW() - INTERVAL '3 hours', NOW() - INTERVAL '2 hours 58 minutes', NOW() - INTERVAL '2 hours 56 minutes', NOW() - INTERVAL '2 hours 30 minutes', NULL, NULL, NOW() - INTERVAL '2 hours 30 minutes'),
    (4039, 'TSK-4039', 'DELIVERY', 'FAILED', 'HIGH', 1, 3, 301, 302, 5, 'FAILED', NOW() - INTERVAL '2 hours', NOW() - INTERVAL '1 hour 58 minutes', NOW() - INTERVAL '1 hour 55 minutes', NULL, NOW() - INTERVAL '1 hour 49 minutes', 'Localization error', NOW() - INTERVAL '1 hour 49 minutes'),
    (4040, 'TSK-4040', 'DELIVERY', 'DONE', 'LOW', 1, 2, 205, 201, 4, 'COMPLETED', NOW() - INTERVAL '90 minutes', NOW() - INTERVAL '88 minutes', NOW() - INTERVAL '85 minutes', NOW() - INTERVAL '60 minutes', NULL, NULL, NOW() - INTERVAL '60 minutes'),
    (4041, 'TSK-4041', 'DELIVERY', 'DONE', 'NORMAL', 1, 1, 103, 102, 1, 'COMPLETED', NOW() - INTERVAL '70 minutes', NOW() - INTERVAL '68 minutes', NOW() - INTERVAL '66 minutes', NOW() - INTERVAL '45 minutes', NULL, NULL, NOW() - INTERVAL '45 minutes'),
    (4042, 'TSK-4042', 'DELIVERY', 'RUNNING', 'HIGH', 1, 1, 102, 104, 1, 'ROUTE_TO_DROPOFF', NOW() - INTERVAL '45 minutes', NOW() - INTERVAL '44 minutes', NOW() - INTERVAL '42 minutes', NULL, NULL, NULL, NOW() - INTERVAL '6 minutes'),
    (4043, 'TSK-4043', 'DELIVERY', 'RUNNING', 'HIGH', 1, 2, 202, 208, 2, 'ROUTE_TO_DROPOFF', NOW() - INTERVAL '28 minutes', NOW() - INTERVAL '27 minutes', NOW() - INTERVAL '26 minutes', NULL, NULL, NULL, NOW() - INTERVAL '4 minutes'),
    (4044, 'TSK-4044', 'DELIVERY', 'ASSIGNED', 'NORMAL', 1, 2, 201, 204, 6, 'ROUTE_TO_PICKUP', NOW() - INTERVAL '3 minutes', NOW() - INTERVAL '2 minutes', NULL, NULL, NULL, NULL, NOW() - INTERVAL '2 minutes'),
    (4045, 'TSK-4045', 'DELIVERY', 'CREATED', 'NORMAL', 1, 2, 201, 205, NULL, 'QUEUED', NOW() - INTERVAL '2 minutes', NULL, NULL, NULL, NULL, NULL, NOW() - INTERVAL '2 minutes');

INSERT INTO command_logs (id, robot_id, task_id, command_type, parameters, status, issued_by, created_at)
VALUES
    (1, 1, 4042, 'DISPATCH', 'pickup: Kitchen-B1, dropoff: Room-B102', 'EXECUTING', 'admin@indoory.io', NOW() - INTERVAL '44 minutes'),
    (2, 2, 4043, 'DISPATCH', 'pickup: Reception, dropoff: Room-108', 'EXECUTING', 'admin@indoory.io', NOW() - INTERVAL '27 minutes'),
    (3, 6, 4044, 'DISPATCH', 'pickup: Lobby, dropoff: Room-103', 'EXECUTING', 'admin@indoory.io', NOW() - INTERVAL '2 minutes'),
    (4, 5, 4039, 'EMERGENCY_STOP', '', 'DONE', 'admin@indoory.io', NOW() - INTERVAL '109 minutes');

INSERT INTO event_logs (id, robot_id, task_id, severity, type, message, created_at)
VALUES
    (1, 5, 4039, 'ERROR', 'LOCALIZATION', 'Localization failure detected on Robot-05', NOW() - INTERVAL '109 minutes'),
    (2, 3, NULL, 'WARN', 'BATTERY', 'Battery level below 15% threshold for Robot-03', NOW() - INTERVAL '56 minutes'),
    (3, 1, 4041, 'INFO', 'TASK', 'Task TSK-4041 completed successfully', NOW() - INTERVAL '45 minutes'),
    (4, 2, 4043, 'INFO', 'TASK', 'Task TSK-4043 pickup complete, navigating to dropoff', NOW() - INTERVAL '4 minutes'),
    (5, 6, 4044, 'INFO', 'TASK', 'Task TSK-4044 auto-assigned to Robot-06', NOW() - INTERVAL '2 minutes'),
    (6, NULL, 4045, 'WARN', 'TASK', 'Task TSK-4045 queued because no robot is currently available', NOW() - INTERVAL '2 minutes'),
    (7, 1, 4042, 'INFO', 'NAVIGATION', 'Robot-01 is navigating to Room-B102', NOW() - INTERVAL '6 minutes'),
    (8, NULL, NULL, 'INFO', 'SYSTEM', 'Simulated ROS adapter online with 6 connected robots', NOW() - INTERVAL '3 hours');

INSERT INTO robot_state_snapshots (id, robot_id, status, battery_level, pose_x, pose_y, yaw_deg, recorded_at)
VALUES
    (1, 1, 'NAVIGATING', 78, 210, 360, 42, NOW() - INTERVAL '15 minutes'),
    (2, 1, 'NAVIGATING', 78, 215, 370, 42, NOW() - INTERVAL '5 minutes'),
    (3, 2, 'NAVIGATING', 63, 330, 245, 8, NOW() - INTERVAL '12 minutes'),
    (4, 2, 'NAVIGATING', 63, 350, 260, 8, NOW() - INTERVAL '4 minutes'),
    (5, 3, 'IDLE', 12, 305, 380, 0, NOW() - INTERVAL '1 minute'),
    (6, 4, 'IDLE', 92, 300, 370, 180, NOW() - INTERVAL '1 minute'),
    (7, 5, 'ERROR', 45, 545, 190, 0, NOW() - INTERVAL '2 minutes'),
    (8, 6, 'PLANNING', 70, 455, 260, 90, NOW() - INTERVAL '1 minute');

SELECT setval('operators_id_seq', (SELECT MAX(id) FROM operators));
SELECT setval('maps_id_seq', (SELECT MAX(id) FROM maps));
SELECT setval('floors_id_seq', (SELECT MAX(id) FROM floors));
SELECT setval('locations_id_seq', (SELECT MAX(id) FROM locations));
SELECT setval('robots_id_seq', (SELECT MAX(id) FROM robots));
SELECT setval('tasks_id_seq', (SELECT MAX(id) FROM tasks));
SELECT setval('command_logs_id_seq', (SELECT MAX(id) FROM command_logs));
SELECT setval('event_logs_id_seq', (SELECT MAX(id) FROM event_logs));
SELECT setval('robot_state_snapshots_id_seq', (SELECT MAX(id) FROM robot_state_snapshots));
