import { getSupabaseClient } from '../../lib/supabase/client'
import type { ActivityDraft } from './activityDraft'

function planDateTime(activityDate: string, startTime: string, endTime: string) {
  const start = new Date(`${activityDate}T${startTime}:00+08:00`)
  let end = new Date(`${activityDate}T${endTime}:00+08:00`)
  if (end <= start) end = new Date(end.getTime() + 86_400_000)
  return { start_at: start.toISOString(), end_at: end.toISOString() }
}

export function activityPayload(draft: ActivityDraft) {
  return {
    activity_date: draft.activityDate,
    venue: {
      name: draft.venue.name,
      region: draft.venue.region,
      district: draft.venue.district,
      address: draft.venue.address,
      floor_type: draft.venue.floorType,
      note: draft.venue.note,
    },
    save_venue: draft.saveVenue,
    initial_court_count: draft.initialCourtCount,
    capacity_mode: draft.capacityMode,
    capacity_limit: draft.capacityMode === 'limited' ? draft.capacityLimit : null,
    skill_min: draft.skillMin,
    skill_max: draft.skillMax,
    assign_mode: draft.assignMode,
    custom_title: draft.customTitle,
    shuttlecock: draft.shuttlecock,
    contact_info: draft.contactInfo,
    description: draft.description,
    plans: draft.plans.map((plan) => ({
      code: plan.code,
      ...planDateTime(draft.activityDate, plan.startTime, plan.endTime),
      amount: draft.financeEnabled ? Number(plan.amount) : null,
    })),
    finance_enabled: draft.financeEnabled,
    enabled_payment_methods: draft.financeEnabled ? draft.paymentMethods : [],
    default_payment_method: draft.financeEnabled ? draft.defaultPaymentMethod : null,
    auto_time_eligibility_enabled: draft.autoTimeEligibilityEnabled,
    matching_settings: draft.matchingSettings,
    tts_settings: draft.ttsSettings,
    save_as_template: draft.saveAsTemplate,
    template_name: draft.templateName,
  }
}

export async function createActivity(draft: ActivityDraft): Promise<string> {
  const { data, error } = await getSupabaseClient().rpc('create_activity_v1', { payload: activityPayload(draft) })
  if (error || typeof data !== 'string') throw error ?? new Error('ACTIVITY_CREATE_FAILED')
  return data
}

export async function updateActivityTemplate(templateId: string, draft: ActivityDraft): Promise<void> {
  const config = { ...activityPayload(draft) } as Record<string, unknown>
  delete config.activity_date; delete config.save_as_template; delete config.template_name
  const { error } = await getSupabaseClient().rpc('update_activity_template_v1', { target_template_id: templateId, target_config: config })
  if (error) throw error
}

export async function updateActivity(activityId: string, draft: ActivityDraft): Promise<void> {
  const { error } = await getSupabaseClient().rpc('update_activity_v1', { target_activity_id: activityId, payload: activityPayload(draft) })
  if (error) throw error
}
