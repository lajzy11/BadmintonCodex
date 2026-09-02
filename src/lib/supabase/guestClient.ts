import type { SupabaseClient } from '@supabase/supabase-js'

const names = ['古斌', 'Vivian', '榴槤', '5151', '小雞毛', '小白', '阿凱', '小八', 'Lynn', 'Hugo', 'Adam', '小羽']
const members = names.map((display_name, index) => ({
  id: `guest-member-${index + 1}`, display_name, disambiguation_label: null,
  gender: index % 3 === 0 ? 'F' : 'M', level: [9, 4, 9, 6, 6, 7, 6, 5, 6, 7, 4, 5][index],
  plan_id: index > 7 ? 'guest-plan-b' : 'guest-plan-a', checkin_status: index < 8 ? 'checked_in' : 'not_arrived',
  attendance_state: index < 4 ? 'playing' : 'idle', registration_status: 'active',
  payment_status: index < 7 ? 'paid' : 'unpaid', payment_method: index < 7 ? 'cash' : null,
  no_show_status: null, has_binding: index < 4, note: null, source: 'manual',
}))

const dispatchMember = (index: number, slot: number, team: 'A' | 'B') => ({
  member_id: members[index].id, display_name: members[index].display_name, level: members[index].level,
  slot, team, one_time_expired_override: false,
})

const workspace = {
  organization_name: '羽點通示範球團',
  activity: { id: '1', custom_title: '週日早場零打', status: 'in_progress', activity_date: '2026-08-30', scheduled_start_at: '2026-08-30T01:00:00Z', scheduled_end_at: '2026-08-30T04:00:00Z', venue_snapshot: { name: '中山運動中心', region: '臺北市', district: '中山區', address: '中山北路二段 44 巷 2 號' }, capacity_mode: 'limited', capacity_limit: 32, skill_min: 4, skill_max: 10, initial_court_count: 4, finance_enabled: true, assign_mode: 'system_assign' },
  plans: [
    { id: 'guest-plan-a', code: 'A', start_at: '2026-08-30T01:00:00Z', end_at: '2026-08-30T04:00:00Z', amount: 300 },
    { id: 'guest-plan-b', code: 'B', start_at: '2026-08-30T02:00:00Z', end_at: '2026-08-30T04:00:00Z', amount: 250 },
  ],
  members,
  stats: { active_members: members.length, checked_in: 8, not_arrived: 4, paid: 7, unpaid: 5, expected_amount: 3400, collected_amount: 2100 },
}

let nextCourtNumber = 5
let nextQueueNumber = 2
let nextMatchNumber = 2
const dispatchState = {
  activity_id: '1', status: 'in_progress', assign_mode: 'system_assign',
  courts: [
    { id: 'guest-court-1', name: '球場 1', sort_order: 1, status: 'playing', active_match_id: 'guest-match-1', started_at: new Date(Date.now() - 11 * 60_000).toISOString(), players: [dispatchMember(0, 1, 'A'), dispatchMember(3, 2, 'A'), dispatchMember(2, 3, 'B'), dispatchMember(4, 4, 'B')] },
    ...[2, 3, 4].map((n) => ({ id: `guest-court-${n}`, name: `球場 ${n}`, sort_order: n, status: 'idle', active_match_id: null, started_at: null, players: [] })),
  ],
  queues: [{ id: 'guest-queue-1', sort_order: 1, source: 'smart', manually_edited: false, members: [dispatchMember(1, 1, 'A'), dispatchMember(5, 2, 'A'), dispatchMember(6, 3, 'B'), dispatchMember(7, 4, 'B')] }],
  eligible_members: members.slice(4, 8).map((member) => ({ id: member.id, display_name: member.display_name, level: member.level, gender: member.gender, plan_code: 'A', plan_start_at: '2026-08-30T01:00:00Z', plan_end_at: '2026-08-30T04:00:00Z', checked_in_at: '2026-08-30T01:00:00Z' })),
}

const demoTemplates = [{ id: 'template-1', name: '週三晚間固定團', updated_at: '2026-08-29T12:00:00Z', config_snapshot: { venue: { name: '中山運動中心', region: '臺北市', district: '中山區' }, initial_court_count: 4, capacity_mode: 'limited', capacity_limit: 32, skill_min: 5, skill_max: 12, assign_mode: 'system_assign', custom_title: '週三晚間零打', shuttlecock: 'RSL 4 號', contact_info: null, description: null, plans: [{ code: 'A', start_at: '2026-08-30T10:30:00Z', end_at: '2026-08-30T13:00:00Z', amount: 300 }], finance_enabled: true, enabled_payment_methods: ['cash'], default_payment_method: 'cash', auto_time_eligibility_enabled: true } }]

const relationships = new Map<string, { persistent_bind_member_id: string | null; one_match_bind_member_id: string | null; one_match_oppose_member_id: string | null; avoid_same_match_member_ids: string[] }>()

function clone<T>(value: T): T { return structuredClone(value) }

function responseFor(name: string): unknown {
  const responses: Record<string, unknown> = {
    get_activity_workspace_v1: clone(workspace),
    get_activity_templates_v1: clone(demoTemplates),
    get_activity_waived_member_ids_v1: [],
    get_activity_share_data_v1: { organization_name: workspace.organization_name, custom_title: workspace.activity.custom_title, activity_date: workspace.activity.activity_date, scheduled_start_at: workspace.activity.scheduled_start_at, scheduled_end_at: workspace.activity.scheduled_end_at, venue: workspace.activity.venue_snapshot, capacity_mode: 'limited', capacity_limit: 32, skill_min: 4, skill_max: 10, contact_info: 'LINE：demo', shuttlecock: 'RSL 4 號', description: '訪客展示活動', plans: workspace.plans },
    get_activity_payment_settings_v1: { finance_enabled: true, enabled_payment_methods: ['cash', 'line_pay'], default_payment_method: 'cash' },
    get_dispatch_state_v1: clone(dispatchState),
    get_dispatch_members_v1: dispatchState.eligible_members.map((member) => ({ ...member, eligibility_reason: null })),
    get_match_history_v1: [], get_preview_issues_v1: [],
    get_auto_dispatch_status_v1: { auto_mode_enabled: false, assign_mode: 'system_assign', matching_settings: { priority: 'balanced', levelMatch: 'balanced', repeatAvoidance: 'moderate', genderPreference: 'none' }, tts_settings: { enabled: true, repeatCount: 2, rate: 1 } },
    get_activity_end_readiness_v1: { status: 'in_progress', active_matches: 1, queued_members: 4, unpaid_members: 5, not_arrived_members: 4 },
    fill_auto_previews_v1: { filled_queues: 1 }, run_auto_dispatch_cycle_v1: { started: false, filled_queues: 1 },
    end_activity_v1: { ended: true, cleared_members: 4 }, add_activity_member_v1: { member_id: 'guest-new-member', warnings: [] },
  }
  return name in responses ? responses[name] : null
}

export function getGuestSupabaseClient(): SupabaseClient {
  const rpc = async (name: string, params: Record<string, unknown> = {}) => {
    if (name === 'adjust_dispatch_resource_v1') {
      const collection = params.resource_type === 'court' ? dispatchState.courts : dispatchState.queues
      if (params.adjustment === 'add') {
        if (params.resource_type === 'court') {
          const number = nextCourtNumber++
          dispatchState.courts.push({ id: `guest-court-${number}`, name: `球場 ${number}`, sort_order: dispatchState.courts.length + 1, status: 'idle', active_match_id: null, started_at: null, players: [] })
        } else {
          const number = nextQueueNumber++
          dispatchState.queues.push({ id: `guest-queue-${number}`, sort_order: dispatchState.queues.length, source: 'manual', manually_edited: false, members: [] })
        }
      } else if (collection.length > 1) {
        const last = collection.at(-1)
        if (last && ('status' in last ? last.status === 'idle' : last.members.length === 0)) collection.pop()
      }
      return { data: null, error: null }
    }
    if (name === 'finish_match_v1') {
      const court = dispatchState.courts.find((item) => item.active_match_id === params.target_match_id)
      if (court) { court.status = 'idle'; court.active_match_id = null; court.started_at = null; court.players = [] }
      return { data: null, error: null }
    }
    if (name === 'start_match_from_preview_v1') {
      const court = dispatchState.courts.find((item) => item.id === params.target_court_id)
      const queue = dispatchState.queues.find((item) => item.id === params.target_queue_id)
      if (court && queue && court.status === 'idle' && queue.members.length === 4) {
        court.status = 'playing'; court.active_match_id = `guest-match-${nextMatchNumber++}`; court.started_at = new Date().toISOString(); court.players = queue.members
        queue.members = []
      }
      return { data: null, error: null }
    }
    if (name === 'get_member_relationships_v1') {
      return { data: relationships.get(String(params.target_member_id)) ?? { persistent_bind_member_id: null, one_match_bind_member_id: null, one_match_oppose_member_id: null, avoid_same_match_member_ids: [] }, error: null }
    }
    if (name === 'set_member_relationships_v1') {
      const memberId = String(params.target_member_id)
      const value = { persistent_bind_member_id: params.target_persistent_bind_member_id as string | null, one_match_bind_member_id: params.target_one_match_bind_member_id as string | null, one_match_oppose_member_id: params.target_one_match_oppose_member_id as string | null, avoid_same_match_member_ids: params.target_avoid_same_match_member_ids as string[] }
      relationships.set(memberId, value)
      const relatedIds = [value.persistent_bind_member_id, value.one_match_bind_member_id, value.one_match_oppose_member_id].filter(Boolean)
      workspace.members = workspace.members.map((member) => member.id === memberId || relatedIds.includes(member.id) ? { ...member, has_binding: true } : member)
      return { data: clone(value), error: null }
    }
    return { data: responseFor(name), error: null }
  }
  const from = (table: string) => ({
    select: () => ({
      eq: () => table === 'member_relationships'
        ? Promise.resolve({ data: [
          { member_low_id: members[0].id, member_high_id: members[1].id, relationship_type: 'persistent_bind', consumed_at: null },
          { member_low_id: members[2].id, member_high_id: members[3].id, relationship_type: 'one_match_bind', consumed_at: null },
        ], error: null })
        : ({ maybeSingle: async () => ({ data: { initial_court_count: 4 }, error: null }) }),
    }),
  })
  return { rpc, from } as unknown as SupabaseClient
}
