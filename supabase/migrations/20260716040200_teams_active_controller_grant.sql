-- Clients need to know whether THIS device is a team's active controller,
-- to disable submit actions on the non-controlling partner's device.
-- active_controller_auth_id is a non-sensitive uuid, safe to expose.
grant select (active_controller_auth_id) on teams to anon, authenticated;
