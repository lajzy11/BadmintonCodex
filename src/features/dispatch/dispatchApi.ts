import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '../../lib/supabase/client'

export type DispatchMember = { member_id: string; display_name: string; level: number; slot: number; team: 'A' | 'B'; one_time_expired_override: boolean }
export type DispatchState = {
  activity_id: string
  status: string
  assign_mode: string
  courts: Array<{ id: string; name: string; sort_order: number; status: 'idle' | 'playing'; active_match_id: string | null; started_at: string | null; players: DispatchMember[] }>
  queues: Array<{ id: string; sort_order: number; source: string; manually_edited: boolean; members: DispatchMember[] }>
  eligible_members: Array<{ id: string; display_name: string; level: number; gender: string | null; plan_code: string; plan_start_at: string; plan_end_at: string; checked_in_at: string | null }>
}
export type DispatchRosterMember = DispatchState['eligible_members'][number] & { eligibility_reason: 'not_arrived' | 'playing' | 'rest' | 'queued' | 'not_started' | 'expired' | null }
export type MatchResult = 'team_a_win' | 'team_b_win' | 'no_result' | 'unrecorded'
export type MatchHistoryItem = {
  id: string; court_name: string; status: 'completed' | 'cancelled'; started_at: string; ended_at: string | null
  score_a: number | null; score_b: number | null; result: MatchResult; note: string | null; players: DispatchMember[]
}
export type PreviewIssue = { queue_id: string; member_id: string; plan_end_at: string; expired: boolean; one_time_expired_override: boolean }
export type AutoDispatchStatus = {
  auto_mode_enabled: boolean
  assign_mode: string
  matching_settings: { priority?: string; levelMatch?: string; repeatAvoidance?: string; genderPreference?: string }
  tts_settings?: { enabled?: boolean; repeatCount?: number; rate?: number }
}
export type MatchingSettings = Required<AutoDispatchStatus['matching_settings']>
export type TtsSettings = { enabled: boolean; repeatCount: number; rate: number }
export type ActivityEndReadiness = { status: string; active_matches: number; queued_members: number; unpaid_members: number; not_arrived_members: number }

function useDispatchMutation<TInput>(activityId: string, mutationFn: (input: TInput) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn, onSuccess: async () => { await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
    queryClient.invalidateQueries({ queryKey: ['dispatch-roster', activityId] }),
  ]) } })
}

export function useDispatchState(activityId: string) {
  return useQuery({
    queryKey: ['dispatch-state', activityId],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_dispatch_state_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('DISPATCH_LOAD_FAILED')
      return data as DispatchState
    },
    refetchInterval: 5_000,
  })
}

export function useDispatchRoster(activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['dispatch-roster', activityId],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_dispatch_members_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('DISPATCH_ROSTER_FAILED')
      return data as DispatchRosterMember[]
    },
    refetchInterval: enabled ? 5_000 : false,
  })
}

export function useAdjustDispatchResource(activityId: string) {
  return useDispatchMutation(activityId, async (input: { resourceType: 'court' | 'queue'; adjustment: 'add' | 'remove' }) => {
    const { error } = await getSupabaseClient().rpc('adjust_dispatch_resource_v1', { target_activity_id: activityId, resource_type: input.resourceType, adjustment: input.adjustment })
    if (error) throw error
  })
}

export function useManageCourt(activityId: string) {
  return useDispatchMutation(activityId, async (input: { courtId: string; action: 'rename' | 'delete'; name?: string }) => {
    const { error } = await getSupabaseClient().rpc('manage_court_v1', {
      target_activity_id: activityId, target_court_id: input.courtId,
      target_action: input.action, target_name: input.name ?? null,
    })
    if (error) throw error
  })
}

export function useAssignPreview(activityId: string) {
  return useDispatchMutation(activityId, async (input: { queueId: string; memberIds: string[] }) => {
    const { error } = await getSupabaseClient().rpc('assign_members_to_preview_v1', { target_activity_id: activityId, target_queue_id: input.queueId, target_member_ids: input.memberIds })
    if (error) throw error
  })
}

export function useStartPreviewMatch(activityId: string) {
  return useDispatchMutation(activityId, async (input: { queueId: string; courtId: string }) => {
    const { error } = await getSupabaseClient().rpc('start_match_from_preview_v1', { target_activity_id: activityId, target_queue_id: input.queueId, target_court_id: input.courtId })
    if (error) throw error
  })
}

export function useStartDirectMatch(activityId: string) {
  return useDispatchMutation(activityId, async (input: { courtId: string; memberIds: string[] }) => {
    const { error } = await getSupabaseClient().rpc('start_direct_manual_match_v1', { target_activity_id: activityId, target_court_id: input.courtId, target_member_ids: input.memberIds })
    if (error) throw error
  })
}

export function useFinishMatch(activityId: string) {
  return useDispatchMutation(activityId, async (matchId: string) => {
    const { error } = await getSupabaseClient().rpc('finish_match_v1', { target_activity_id: activityId, target_match_id: matchId })
    if (error) throw error
  })
}

export function useCancelActiveMatch(activityId: string) {
  return useDispatchMutation(activityId, async (matchId: string) => {
    const { error } = await getSupabaseClient().rpc('cancel_active_match_v1', { target_activity_id: activityId, target_match_id: matchId })
    if (error) throw error
  })
}

export function useMatchHistory(activityId: string) {
  return useQuery({
    queryKey: ['match-history', activityId],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_match_history_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('MATCH_HISTORY_LOAD_FAILED')
      return data as MatchHistoryItem[]
    },
  })
}

export function useUpdateMatchResult(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { matchId: string; scoreA: number | null; scoreB: number | null; result: MatchResult; note: string }) => {
      const { error } = await getSupabaseClient().rpc('update_match_result_v1', {
        target_activity_id: activityId, target_match_id: input.matchId, target_score_a: input.scoreA,
        target_score_b: input.scoreB, target_result: input.result, target_note: input.note,
      })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['match-history', activityId] }),
  })
}

export function useCancelCompletedMatch(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (matchId: string) => {
      const { error } = await getSupabaseClient().rpc('cancel_completed_match_v1', { target_activity_id: activityId, target_match_id: matchId })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['match-history', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
      ])
    },
  })
}

export function usePreviewIssues(activityId: string) {
  return useQuery({
    queryKey: ['preview-issues', activityId],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_preview_issues_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('PREVIEW_ISSUES_LOAD_FAILED')
      return data as PreviewIssue[]
    },
    refetchInterval: 5_000,
  })
}

export function useManagePreviewMember(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { queueId: string; memberId: string; action: 'remove' | 'allow_expired_once' }) => {
      const { error } = await getSupabaseClient().rpc('manage_preview_member_v1', {
        target_activity_id: activityId, target_queue_id: input.queueId,
        target_member_id: input.memberId, target_action: input.action,
      })
      if (error) throw error
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['preview-issues', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch-roster', activityId] }),
      ])
    },
  })
}

export function useAutoDispatchStatus(activityId: string) {
  return useQuery({
    queryKey: ['auto-dispatch-status', activityId],
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_auto_dispatch_status_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('AUTO_DISPATCH_STATUS_FAILED')
      return data as AutoDispatchStatus
    },
  })
}

export function useSetAutoDispatchMode(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await getSupabaseClient().rpc('set_auto_dispatch_mode_v1', { target_activity_id: activityId, target_enabled: enabled })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auto-dispatch-status', activityId] }),
  })
}

export function useFillAutoPreviews(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (force: boolean) => {
      const { data, error } = await getSupabaseClient().rpc('fill_auto_previews_v1', { target_activity_id: activityId, target_force: force })
      if (error) throw error
      return data as { filled_queues: number }
    },
    onSuccess: async () => { await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
      queryClient.invalidateQueries({ queryKey: ['dispatch-roster', activityId] }),
    ]) },
  })
}

export function useUpdateMatchingSettings(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: MatchingSettings) => {
      const { error } = await getSupabaseClient().rpc('update_matching_settings_v1', { target_activity_id: activityId, target_settings: settings })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auto-dispatch-status', activityId] }),
  })
}

export function useUpdateTtsSettings(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: TtsSettings) => {
      const { error } = await getSupabaseClient().rpc('update_tts_settings_v1', { target_activity_id: activityId, target_settings: settings })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auto-dispatch-status', activityId] }),
  })
}

export function useRunAutoDispatchCycle(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('run_auto_dispatch_cycle_v1', { target_activity_id: activityId })
      if (error) throw error
      return data as { started: boolean; match_id?: string; filled_queues?: number; replaced_members?: number; blocked_members?: number }
    },
    onSuccess: async () => { await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
      queryClient.invalidateQueries({ queryKey: ['dispatch-roster', activityId] }),
    ]) },
  })
}

export function useActivityEndReadiness(activityId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['activity-end-readiness', activityId],
    enabled,
    queryFn: async () => {
      const { data, error } = await getSupabaseClient().rpc('get_activity_end_readiness_v1', { target_activity_id: activityId })
      if (error || !data) throw error ?? new Error('ACTIVITY_END_READINESS_FAILED')
      return data as ActivityEndReadiness
    },
  })
}

export function useEndActivity(activityId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (clearPreviews: boolean) => {
      const { data, error } = await getSupabaseClient().rpc('end_activity_v1', { target_activity_id: activityId, clear_previews: clearPreviews })
      if (error) throw error
      return data as { ended: boolean; cleared_members: number }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['dispatch-state', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['dispatch-roster', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['auto-dispatch-status', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['activity-workspace', activityId] }),
        queryClient.invalidateQueries({ queryKey: ['club-home'] }),
      ])
    },
  })
}
