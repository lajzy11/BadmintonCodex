import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isDemoMode } from '../../lib/guestMode'
import { getSupabaseClient } from '../../lib/supabase/client'
import type { ActivityTemplate } from '../activities/activitySourcesApi'

export type AccountSettingsData = { username_normalized: string; display_name: string }
export type ClubSettingsData = {
  organization: { id: string; name: string; default_contact_info: string | null; default_shuttlecock: string | null; description: string | null; line_pay_demo_enabled: boolean; line_pay_demo_merchant_name: string | null; line_pay_demo_merchant_id: string | null }
  counts: { venues: number; templates: number }
}
export type VenueData = { id: string; name: string; region: string; district: string; address: string | null; floor_type: string | null; note: string | null; last_used_at: string | null; use_count: number; updated_at: string }
export type VenueInput = Omit<VenueData, 'id' | 'last_used_at' | 'use_count' | 'updated_at'> & { id?: string }

const demoAccount: AccountSettingsData = { username_normalized: 'badminton_owner', display_name: '小羽' }
const demoClub: ClubSettingsData = {
  organization: { id: 'demo', name: '星期三羽球團', default_contact_info: 'LINE：badminton_owner', default_shuttlecock: 'RSL 4 號', description: '', line_pay_demo_enabled: false, line_pay_demo_merchant_name: null, line_pay_demo_merchant_id: null }, counts: { venues: 2, templates: 1 },
}

export function useAccountSettingsData(userId: string | undefined) {
  const demoMode = isDemoMode()
  return useQuery({ queryKey: ['account-settings', userId ?? 'demo'], enabled: demoMode || Boolean(userId), queryFn: async (): Promise<AccountSettingsData> => {
    if (demoMode) return demoAccount
    const { data, error } = await getSupabaseClient().rpc('get_account_settings_v1')
    if (error || !data) throw error ?? new Error('ACCOUNT_SETTINGS_NOT_FOUND')
    return data as AccountSettingsData
  } })
}

export function useClubSettingsData(userId: string | undefined) {
  const demoMode = isDemoMode()
  return useQuery({ queryKey: ['club-settings', userId ?? 'demo'], enabled: demoMode || Boolean(userId), queryFn: async (): Promise<ClubSettingsData> => {
    if (demoMode) return demoClub
    const { data, error } = await getSupabaseClient().rpc('get_club_settings_v1')
    if (error || !data) throw error ?? new Error('CLUB_SETTINGS_NOT_FOUND')
    return data as ClubSettingsData
  } })
}

export const useSettingsData = useClubSettingsData

const demoVenues: VenueData[] = [
  { id: 'venue-1', name: '中山運動中心', region: '臺北市', district: '中山區', address: '中山北路二段 44 巷 2 號', floor_type: 'PU', note: null, last_used_at: '2026-08-30T01:00:00Z', use_count: 8, updated_at: '2026-08-30T01:00:00Z' },
  { id: 'venue-2', name: '內湖運動中心', region: '臺北市', district: '內湖區', address: null, floor_type: '木地板', note: '地下停車場入口較小', last_used_at: null, use_count: 0, updated_at: '2026-08-20T01:00:00Z' },
]

export function useVenues() {
  return useQuery({ queryKey: ['organizer-venues'], queryFn: async (): Promise<VenueData[]> => {
    if (isDemoMode()) return demoVenues
    const { data, error } = await getSupabaseClient().rpc('get_organizer_venues_v1')
    if (error) throw error
    return (data ?? []) as VenueData[]
  } })
}

export function useSaveVenue() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: async (input: VenueInput) => {
    if (isDemoMode()) return
    const { error } = await getSupabaseClient().rpc('save_organizer_venue_v1', { target_venue_id: input.id ?? null, target_name: input.name, target_region: input.region, target_district: input.district, target_address: input.address ?? '', target_floor_type: input.floor_type ?? '', target_note: input.note ?? '' })
    if (error) throw error
  }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['organizer-venues'] }), queryClient.invalidateQueries({ queryKey: ['club-settings'] })]) } })
}

export function useDeleteVenue() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: async (id: string) => {
    if (isDemoMode()) return
    const { error } = await getSupabaseClient().rpc('delete_organizer_venue_v1', { target_venue_id: id })
    if (error) throw error
  }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['organizer-venues'] }), queryClient.invalidateQueries({ queryKey: ['club-settings'] })]) } })
}

const demoTemplates: ActivityTemplate[] = [{ id: 'template-1', name: '週三晚間固定團', updated_at: '2026-08-29T12:00:00Z', config_snapshot: { venue: { name: '中山運動中心', region: '臺北市', district: '中山區' }, initial_court_count: 4, capacity_mode: 'limited', capacity_limit: 32, skill_min: 5, skill_max: 12, assign_mode: 'system_assign', custom_title: '週三晚間零打', shuttlecock: 'RSL 4 號', contact_info: null, description: null, plans: [{ code: 'A', start_at: '2026-08-30T10:30:00Z', end_at: '2026-08-30T13:00:00Z', amount: 300 }], finance_enabled: true, enabled_payment_methods: ['cash'], default_payment_method: 'cash', auto_time_eligibility_enabled: true } }]

export function useActivityTemplates() {
  return useQuery({ queryKey: ['activity-templates'], queryFn: async (): Promise<ActivityTemplate[]> => {
    if (isDemoMode()) return demoTemplates
    const { data, error } = await getSupabaseClient().rpc('get_activity_templates_v1')
    if (error) throw error
    return (data ?? []) as ActivityTemplate[]
  } })
}

export function useManageTemplate() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: async ({ id, action, name }: { id: string; action: 'rename' | 'copy' | 'delete'; name?: string }) => {
    if (isDemoMode()) return
    const { error } = await getSupabaseClient().rpc('manage_activity_template_v1', { target_template_id: id, target_action: action, target_name: name ?? null })
    if (error) throw error
  }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['activity-templates'] }), queryClient.invalidateQueries({ queryKey: ['club-settings'] })]) } })
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: async (input: ClubSettingsData['organization']) => {
    if (isDemoMode()) return
    const { error } = await getSupabaseClient().rpc('update_club_settings_v1', { target_organization_id: input.id, target_name: input.name, target_default_contact_info: input.default_contact_info ?? '', target_default_shuttlecock: input.default_shuttlecock ?? '', target_description: input.description ?? '', target_line_pay_demo_enabled: input.line_pay_demo_enabled, target_line_pay_demo_merchant_name: input.line_pay_demo_merchant_name ?? '', target_line_pay_demo_merchant_id: input.line_pay_demo_merchant_id ?? '' })
    if (error) throw error
  }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['club-settings'] }), queryClient.invalidateQueries({ queryKey: ['activity-center'] })]) } })
}

export function useUpdateProfile(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: async (displayName: string) => {
    if (isDemoMode()) return
    if (!userId) throw new Error('AUTHENTICATION_REQUIRED')
    const { error } = await getSupabaseClient().rpc('update_account_display_name_v1', { target_display_name: displayName })
    if (error) throw error
  }, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['account-settings'] }), queryClient.invalidateQueries({ queryKey: ['activity-center'] })]) } })
}
