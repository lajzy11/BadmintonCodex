-- Organizer-editable browser voice call settings.

create or replace function public.update_tts_settings_v1(target_activity_id uuid, target_settings jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  normalized jsonb;
  repeat_count integer;
  speech_rate numeric;
begin
  repeat_count := coalesce((target_settings->>'repeatCount')::integer, 2);
  speech_rate := coalesce((target_settings->>'rate')::numeric, 1.0);
  if repeat_count < 1 or repeat_count > 3 or speech_rate < 0.5 or speech_rate > 1.5 then
    raise exception using errcode = '22023', message = 'TTS_SETTINGS_INVALID';
  end if;
  normalized := jsonb_build_object(
    'enabled', coalesce((target_settings->>'enabled')::boolean, true),
    'repeatCount', repeat_count,
    'rate', speech_rate
  );
  update public.activities a set tts_settings = normalized, updated_at = now()
  where a.id = target_activity_id and a.status not in ('archived')
    and exists (select 1 from public.organization_memberships om where om.organization_id = a.organization_id and om.user_id = auth.uid() and om.role = 'owner');
  if not found then raise exception using errcode = '22023', message = 'TTS_SETTINGS_NOT_AVAILABLE'; end if;
  return normalized;
end;
$$;

revoke all on function public.update_tts_settings_v1(uuid, jsonb) from public;
grant execute on function public.update_tts_settings_v1(uuid, jsonb) to authenticated;
