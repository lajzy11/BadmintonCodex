import { useQuery } from '@tanstack/react-query'
import { getSupabaseClient } from '../../lib/supabase/client'
import { initialActivityDraft, todayInTaipei, type ActivityDraft } from './activityDraft'

export type OrganizerVenue = {
  id: string
  name: string
  region: string
  district: string
  address: string | null
  floor_type: string | null
  note: string | null
}

type CopySource = {
  activity_date: string
  venue: {
    name: string
    region: string
    district: string
    address?: string | null
    floor_type?: string | null
    note?: string | null
  }
  initial_court_count: number
  capacity_mode: ActivityDraft['capacityMode']
  capacity_limit: number | null
  skill_min: number
  skill_max: number
  assign_mode: ActivityDraft['assignMode']
  custom_title: string | null
  shuttlecock: string | null
  contact_info: string | null
  description: string | null
  plans: Array<{ code: string; start_at: string; end_at: string; amount: number | null }>
  finance_enabled: boolean
  enabled_payment_methods: string[]
  default_payment_method: string | null
  auto_time_eligibility_enabled: boolean
  matching_settings?: ActivityDraft['matchingSettings']
  tts_settings?: ActivityDraft['ttsSettings']
}

export type ActivityTemplate = { id: string; name: string; config_snapshot: Omit<CopySource, 'activity_date'>; updated_at: string }

function timeInTaipei(value: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei',
  }).format(new Date(value))
}

export function useOrganizerVenues() {
  return useQuery({
    queryKey: ['organizer-venues'],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_organizer_venues_v1')
      if (error) throw error
      return (data ?? []) as OrganizerVenue[]
    },
  })
}

export function useActivityCopySource(activityId: string | null) {
  return useQuery({
    queryKey: ['activity-copy-source', activityId],
    enabled: Boolean(activityId),
    queryFn: async (): Promise<ActivityDraft> => {
      const { data, error } = await getSupabaseClient().rpc('get_activity_copy_source_v1', { source_activity_id: activityId })
      if (error || !data) throw error ?? new Error('COPY_SOURCE_NOT_FOUND')
      const source = data as CopySource
      return {
        ...initialActivityDraft(),
        activityDate: source.activity_date,
        venue: {
          ...source.venue,
          address: source.venue.address ?? '',
          floorType: source.venue.floor_type ?? '',
          note: source.venue.note ?? '',
        },
        venueId: null,
        saveVenue: false,
        initialCourtCount: source.initial_court_count,
        capacityMode: source.capacity_mode,
        capacityLimit: Math.min(100, source.capacity_limit ?? source.initial_court_count * 8),
        skillMin: source.skill_min,
        skillMax: source.skill_max,
        assignMode: source.assign_mode,
        customTitle: source.custom_title ?? '',
        shuttlecock: source.shuttlecock ?? '',
        contactInfo: source.contact_info ?? '',
        description: source.description ?? '',
        plans: source.plans.map((plan) => ({
          code: plan.code,
          startTime: timeInTaipei(plan.start_at),
          endTime: timeInTaipei(plan.end_at),
          amount: plan.amount?.toString() ?? '',
        })),
        financeEnabled: source.finance_enabled,
        paymentMethods: source.enabled_payment_methods,
        defaultPaymentMethod: source.default_payment_method ?? '',
        autoTimeEligibilityEnabled: source.auto_time_eligibility_enabled,
        matchingSettings: source.matching_settings ?? initialActivityDraft().matchingSettings,
        ttsSettings: source.tts_settings ?? initialActivityDraft().ttsSettings,
        saveAsTemplate: false,
        templateName: '',
      }
    },
  })
}

function templateDraft(source: ActivityTemplate): ActivityDraft {
  const config = source.config_snapshot
  return {
    ...initialActivityDraft(), activityDate: todayInTaipei(),
    venue: { ...config.venue, address: config.venue.address ?? '', floorType: config.venue.floor_type ?? '', note: config.venue.note ?? '' }, venueId: null, saveVenue: false,
    initialCourtCount: config.initial_court_count, capacityMode: config.capacity_mode, capacityLimit: Math.min(100, config.capacity_limit ?? config.initial_court_count * 8), skillMin: config.skill_min, skillMax: config.skill_max, assignMode: config.assign_mode,
    customTitle: config.custom_title ?? '', shuttlecock: config.shuttlecock ?? '', contactInfo: config.contact_info ?? '', description: config.description ?? '',
    plans: config.plans.map((plan) => ({ code: plan.code, startTime: timeInTaipei(plan.start_at), endTime: timeInTaipei(plan.end_at), amount: plan.amount?.toString() ?? '' })),
    financeEnabled: config.finance_enabled, paymentMethods: config.enabled_payment_methods, defaultPaymentMethod: config.default_payment_method ?? '', autoTimeEligibilityEnabled: config.auto_time_eligibility_enabled,
    matchingSettings: config.matching_settings ?? initialActivityDraft().matchingSettings, ttsSettings: config.tts_settings ?? initialActivityDraft().ttsSettings, saveAsTemplate: false, templateName: '',
  }
}

export function useActivityTemplateSource(templateId: string | null) {
  return useQuery({ queryKey: ['activity-template-source', templateId], enabled: Boolean(templateId), queryFn: async () => {
    const { data, error } = await getSupabaseClient().rpc('get_activity_templates_v1')
    if (error) throw error
    const template = ((data ?? []) as ActivityTemplate[]).find((item) => item.id === templateId)
    if (!template) throw new Error('TEMPLATE_NOT_FOUND')
    return { draft: templateDraft(template), name: template.name }
  } })
}
