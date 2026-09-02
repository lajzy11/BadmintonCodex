-- V1 does not expose username changes. RLS limits the row; column privileges
-- separately limit which profile fields an authenticated client can update.

revoke update on table public.profiles from authenticated;
grant update (display_name) on table public.profiles to authenticated;
