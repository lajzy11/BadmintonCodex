-- New activity creation limits. NOT VALID preserves legacy rows while enforcing new writes.
alter table public.organizer_venues
  add constraint organizer_venues_name_max_length check (char_length(name) <= 60) not valid,
  add constraint organizer_venues_address_max_length check (address is null or char_length(address) <= 120) not valid,
  add constraint organizer_venues_floor_type_max_length check (floor_type is null or char_length(floor_type) <= 30) not valid,
  add constraint organizer_venues_note_max_length check (note is null or char_length(note) <= 200) not valid;

alter table public.activities
  add constraint activities_capacity_limit_v2 check (capacity_mode <> 'limited' or capacity_limit between 1 and 100) not valid,
  add constraint activities_custom_title_max_length check (custom_title is null or char_length(custom_title) <= 50) not valid,
  add constraint activities_shuttlecock_max_length check (shuttlecock is null or char_length(shuttlecock) <= 50) not valid,
  add constraint activities_contact_info_max_length check (contact_info is null or char_length(contact_info) <= 100) not valid,
  add constraint activities_description_max_length check (description is null or char_length(description) <= 500) not valid,
  add constraint activities_venue_snapshot_limits check (
    char_length(venue_snapshot->>'name') <= 60
    and coalesce(char_length(venue_snapshot->>'address'), 0) <= 120
    and coalesce(char_length(venue_snapshot->>'floor_type'), 0) <= 30
    and coalesce(char_length(venue_snapshot->>'note'), 0) <= 200
  ) not valid;

alter table public.activity_templates
  add constraint activity_templates_name_max_length check (char_length(name) <= 50) not valid;
