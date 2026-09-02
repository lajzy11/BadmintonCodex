import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '../../lib/supabase/client'

export type WorkspacePlan = { id: string; code: string; start_at: string; end_at: string; amount: number | null }
export type WorkspaceMember = {
  id: string
  display_name: string
  disambiguation_label: string | null
  gender: 'M' | 'F' | null
  level: number
  plan_id: string
  checkin_status: 'not_arrived' | 'checked_in'
  attendance_state: 'idle' | 'playing' | 'rest'
  registration_status: 'active' | 'cancelled'
  payment_status: 'unpaid' | 'paid'
  payment_method: string | null
  no_show_status: string | null
  has_binding: boolean
  note: string | null
  source: 'manual' | 'import' | 'self_claim'
}
export type ActivityWorkspace = {
  organization_name: string
  activity: {
    id: string
    custom_title: string | null
    status: string
    activity_date: string
    scheduled_start_at: string | null
    scheduled_end_at: string | null
    venue_snapshot: { name: string; region: string; district: string; address?: string }
    capacity_mode: 'unlimited' | 'limited'
    capacity_limit: number | null
    skill_min: number
    skill_max: number
    initial_court_count: number
    finance_enabled: boolean
    assign_mode: string
  }
  plans: WorkspacePlan[]
  members: WorkspaceMember[]
  stats: { active_members: number; checked_in: number; not_arrived: number; paid: number; unpaid: number; expected_amount: number; collected_amount: number }
}
export type ActivityShareData = {
  organization_name: string
  custom_title: string | null
  activity_date: string
  scheduled_start_at: string
  scheduled_end_at: string
  venue: { name: string; region: string; district: string; address?: string }
  capacity_mode: 'unlimited' | 'limited'
  capacity_limit: number | null
  skill_min: number
  skill_max: number
  contact_info: string | null
  shuttlecock: string | null
  description: string | null
  plans: Array<{ code: string; start_at: string; end_at: string; amount: number | null }>
}

export function useActivityWorkspace(activityId: string) {
  return useQuery({
    queryKey: ['activity-workspace', activityId],
    queryFn: async () => {
      const client = getSupabaseClient()
      const { error: syncError } = await client.rpc('sync_activity_statuses_v1', { target_activity_id: activityId })
      if (syncError) throw syncError
      const [{ data, error }, { data: waivedIds, error: waivedError }, { data: activityMeta }, { data: relationships }] = await Promise.all([
        client.rpc('get_activity_workspace_v1', { target_activity_id: activityId }),
        client.rpc('get_activity_waived_member_ids_v1', { target_activity_id: activityId }),
        client.from('activities').select('initial_court_count').eq('id', activityId).maybeSingle(),
        client.from('member_relationships').select('member_low_id,member_high_id,relationship_type,consumed_at').eq('activity_id', activityId),
      ])
      if (error || !data) throw error ?? new Error('ACTIVITY_WORKSPACE_LOAD_FAILED')
      if (waivedError) throw waivedError
      const workspace = data as ActivityWorkspace
      workspace.activity.initial_court_count = activityMeta?.initial_court_count ?? 1
      if (workspace.activity.status === 'scheduled' && workspace.activity.scheduled_start_at && new Date(workspace.activity.scheduled_start_at).getTime() <= Date.now()) workspace.activity.status = 'in_progress'
      const waived = new Set((waivedIds ?? []) as string[])
      const boundMemberIds = new Set<string>()
      for (const relationship of relationships ?? []) {
        if (relationship.consumed_at || !['persistent_bind', 'one_match_bind', 'one_match_oppose'].includes(relationship.relationship_type)) continue
        boundMemberIds.add(relationship.member_low_id)
        boundMemberIds.add(relationship.member_high_id)
      }
      workspace.members = workspace.members.map((member) => ({ ...member, no_show_status: waived.has(member.id) ? 'waived' : null, has_binding: boundMemberIds.has(member.id) }))
      return workspace
    },
  })
}

export function useSaveActivityAsTemplate(activityId: string) { const queryClient=useQueryClient(); return useMutation({ mutationFn:async(name:string)=>{const{error}=await getSupabaseClient().rpc('save_activity_as_template_v1',{target_activity_id:activityId,target_template_name:name});if(error)throw error},onSuccess:async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:['activity-templates']}),queryClient.invalidateQueries({queryKey:['club-settings']})])} }) }
export function useReopenActivity(activityId: string) { const queryClient=useQueryClient(); return useMutation({ mutationFn:async()=>{const{error}=await getSupabaseClient().rpc('reopen_activity_v1',{target_activity_id:activityId});if(error)throw error},onSuccess:async()=>{await Promise.all([queryClient.invalidateQueries({queryKey:['activity-workspace',activityId]}),queryClient.invalidateQueries({queryKey:['activity-center']})])} }) }
export function useCorrectMemberCheckinPayment(activityId: string) { const queryClient=useQueryClient(); return useMutation({ mutationFn:async(input:{memberId:string;checkinStatus:'not_arrived'|'checked_in';paymentStatus:'unpaid'|'paid';paymentMethod:string|null})=>{const{error}=await getSupabaseClient().rpc('correct_member_checkin_payment_v1',{target_member_id:input.memberId,target_checkin_status:input.checkinStatus,target_payment_status:input.paymentStatus,target_payment_method:input.paymentMethod});if(error)throw error},onSuccess:async(_data,input)=>{await Promise.all([queryClient.invalidateQueries({queryKey:['activity-workspace',activityId]}),queryClient.invalidateQueries({queryKey:['activity-member-detail',input.memberId]}),queryClient.invalidateQueries({queryKey:['activity-center']})])} }) }

export function useActivityShareData(activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['activity-share-data', activityId],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_activity_share_data_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('ACTIVITY_SHARE_DATA_FAILED')
      return data as ActivityShareData
    },
  })
}

export function useAddActivityMember(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { displayName: string; level: number; planId: string; gender: string | null; note: string }) => {
      const { data, error } = await getSupabaseClient().rpc('add_activity_member_v1', {
        target_activity_id: activityId,
        target_display_name: input.displayName,
        target_level: input.level,
        target_plan_id: input.planId,
        target_gender: input.gender,
        target_note: input.note,
      })
      if (error) throw error
      return data as { member_id: string; warnings: string[] }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
      ])
    },
  })
}

export type ActivityPaymentSettings = {
  finance_enabled: boolean
  enabled_payment_methods: string[]
  default_payment_method: string | null
}

export function useActivityPaymentSettings(activityId: string) {
  return useQuery({
    queryKey: ['activity-payment-settings', activityId],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_activity_payment_settings_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('PAYMENT_SETTINGS_LOAD_FAILED')
      return data as ActivityPaymentSettings
    },
  })
}

export function useBatchCheckin(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberIds: string[]; collectPayment: boolean; paymentMethod: string | null }) => {
      const { data, error } = await getSupabaseClient().rpc('batch_checkin_members_v1', {
        target_activity_id: activityId,
        target_member_ids: input.memberIds,
        collect_payment: input.collectPayment,
        target_payment_method: input.paymentMethod,
      })
      if (error) throw error
      return data as { selected: number; newly_checked_in: number; newly_paid: number }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
      ])
    },
  })
}

export type ActivityMemberDetail = {
  id: string
  activity_id: string
  display_name: string
  gender: 'M' | 'F' | null
  level: number
  plan_id: string
  note: string | null
  checkin_status: string
  payment_status: string
  payment_method: string | null
  no_show_status: string | null
  attendance_state: string
  registration_status: string
  avoid_member_ids: string[]
}

export type MemberRelationships = {
  persistent_bind_member_id: string | null
  one_match_bind_member_id: string | null
  one_match_oppose_member_id: string | null
  avoid_same_match_member_ids: string[]
}

export function useMemberRelationships(memberId: string | null) {
  return useQuery({
    queryKey: ['member-relationships', memberId],
    enabled: Boolean(memberId),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_member_relationships_v1', { target_member_id: memberId })
      if (error || !data) throw error ?? new Error('MEMBER_RELATIONSHIPS_LOAD_FAILED')
      return data as MemberRelationships
    },
  })
}

export function useSetMemberRelationships(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberId: string; persistentBindMemberId: string | null; oneMatchBindMemberId: string | null; oneMatchOpposeMemberId: string | null; avoidSameMatchMemberIds: string[] }) => {
      const { data, error } = await getSupabaseClient().rpc('set_member_relationships_v1', {
        target_member_id: input.memberId,
        target_persistent_bind_member_id: input.persistentBindMemberId,
        target_one_match_bind_member_id: input.oneMatchBindMemberId,
        target_one_match_oppose_member_id: input.oneMatchOpposeMemberId,
        target_avoid_same_match_member_ids: input.avoidSameMatchMemberIds,
      })
      if (error) throw error
      return data as MemberRelationships
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['member-relationships'] }),
        queryClient.invalidateQueries({ queryKey: ['activity-member-detail', input.memberId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
      ])
    },
  })
}

export function useActivityMemberDetail(memberId: string | null) {
  return useQuery({
    queryKey: ['activity-member-detail', memberId],
    enabled: Boolean(memberId),
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_activity_member_detail_v1', { target_member_id: memberId })
      if (error || !data) throw error ?? new Error('MEMBER_DETAIL_LOAD_FAILED')
      return data as ActivityMemberDetail
    },
  })
}

export function useUpdateActivityMember(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberId: string; displayName: string; level: number; planId: string; gender: string | null; note: string; avoidMemberIds: string[] }) => {
      const { data, error } = await getSupabaseClient().rpc('update_activity_member_v1', {
        target_member_id: input.memberId,
        target_display_name: input.displayName,
        target_level: input.level,
        target_plan_id: input.planId,
        target_gender: input.gender,
        target_note: input.note,
        target_avoid_member_ids: input.avoidMemberIds,
      })
      if (error) throw error
      return data as { member_id: string; warnings: string[] }
    },
    onSuccess: async (_data, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-member-detail', input.memberId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
      ])
    },
  })
}

export function useCancelActivityMember(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await getSupabaseClient().rpc('cancel_activity_member_v1', { target_member_id: memberId })
      if (error) throw error
      return data as { member_id: string; removed_from_preview: boolean }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
      ])
    },
  })
}

export function useSetMemberPaymentWaiver(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { memberId: string; waived: boolean }) => {
      const { error } = await getSupabaseClient().rpc('set_member_payment_waiver_v1', { target_member_id: input.memberId, target_waived: input.waived })
      if (error) throw error
    },
    onSuccess: async (_data, input) => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }), queryClient.invalidateQueries({ queryKey: ['activity-member-detail', input.memberId] })]) },
  })
}

export function useImportActivityMembers(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Array<{ display_name: string; level: number; plan_id: string; gender: string | null; note: string }>) => {
      const { data, error } = await getSupabaseClient().rpc('import_activity_members_v1', {
        target_activity_id: activityId,
        import_rows: rows,
      })
      if (error) throw error
      return data as { inserted_count: number; member_ids: string[]; warnings: string[] }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
      ])
    },
  })
}
