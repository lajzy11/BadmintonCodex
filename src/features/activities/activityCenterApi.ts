import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isDemoMode } from '../../lib/guestMode'
import { getSupabaseClient } from '../../lib/supabase/client'
import { useAuth } from '../auth/AuthProvider'

export type ActivityStatus = 'draft' | 'scheduled' | 'in_progress' | 'ended' | 'archived'

export type ActivitySummary = {
  id: string
  activityDate: string
  date: string
  weekday: string
  time: string
  title: string | null
  venue: string
  location: string
  initialCourtCount: number
  members: number
  capacity: number | null
  status: ActivityStatus
  archivedAt: string | null
}

export type ActivityCenterData = {
  organizationName: string
  organizationDescription: string | null
  accountName: string
  displayName: string
  unarchivedCount: number
  activities: ActivitySummary[]
}

const demoData: ActivityCenterData = {
  organizationName: '星期三羽球團', organizationDescription: '每週固定開團，歡迎喜歡羽球的朋友一起上場。', accountName: 'badminton_owner', displayName: '小羽', unarchivedCount: 3,
  activities: [
    { id: '1', activityDate: '2026-08-30', date: '08/30', weekday: '週日', time: '09:00–12:00', title: '週日早場零打', venue: '中山運動中心', location: '臺北市中山區', initialCourtCount: 4, members: 22, capacity: 32, status: 'scheduled', archivedAt: null },
    { id: '3', activityDate: '2026-09-03', date: '09/03', weekday: '週四', time: '時間未設定', title: '九月新手團', venue: '內湖運動中心', location: '臺北市內湖區', initialCourtCount: 2, members: 0, capacity: 16, status: 'draft', archivedAt: null },
    { id: '4', activityDate: '2026-08-20', date: '08/20', weekday: '週四', time: '18:30–22:00', title: null, venue: '信義運動中心', location: '臺北市信義區', initialCourtCount: 3, members: 24, capacity: 24, status: 'ended', archivedAt: null },
    { id: '5', activityDate: '2026-08-10', date: '08/10', weekday: '週一', time: '09:00–12:00', title: '八月零打', venue: '松山運動中心', location: '臺北市松山區', initialCourtCount: 3, members: 20, capacity: 24, status: 'archived', archivedAt: '2026-08-11T10:00:00Z' },
  ],
}

function formatDate(value: string): Pick<ActivitySummary, 'date' | 'weekday'> {
  const date = new Date(`${value}T00:00:00+08:00`)
  return {
    date: new Intl.DateTimeFormat('zh-TW', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' }).format(date),
    weekday: new Intl.DateTimeFormat('zh-TW', { weekday: 'short', timeZone: 'Asia/Taipei' }).format(date),
  }
}

function formatTime(start: string | null, end: string | null): string {
  if (!start || !end) return '時間未設定'
  const time = new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Taipei' })
  const date = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' })
  const endPrefix = date.format(new Date(start)) === date.format(new Date(end)) ? '' : '翌日 '
  return `${time.format(new Date(start))}–${endPrefix}${time.format(new Date(end))}`
}

type ActivityCenterRpcResult = {
  organization_name: string
  account_name: string
  display_name: string
  unarchived_count: number
  activities: Array<{
    id: string
    activity_date: string
    scheduled_start_at: string | null
    scheduled_end_at: string | null
    custom_title: string | null
    venue_snapshot: { name?: string; region?: string; district?: string }
    capacity_mode: 'unlimited' | 'limited'
    capacity_limit: number | null
    initial_court_count: number
    status: ActivityStatus
    archived_at: string | null
    active_member_count: number
  }>
}

type ClubSettingsProjection = { organization?: { description?: string | null } }

async function fetchActivityCenter(): Promise<ActivityCenterData> {
  const client = getSupabaseClient()
  const { error: syncError } = await client.rpc('sync_activity_statuses_v1', { target_activity_id: null })
  if (syncError) throw new Error(syncError.code ?? 'ACTIVITY_STATUS_SYNC_FAILED')
  const [{ data, error }, settingsResult] = await Promise.all([
    client.rpc('get_activity_center_v1'),
    client.rpc('get_club_settings_v1'),
  ])
  if (error || !data) throw new Error(error?.code ?? 'ACTIVITY_CENTER_LOAD_FAILED')
  const result = data as ActivityCenterRpcResult
  return {
    organizationName: result.organization_name,
    organizationDescription: (settingsResult.data as ClubSettingsProjection | null)?.organization?.description ?? null,
    accountName: result.account_name,
    displayName: result.display_name,
    unarchivedCount: result.unarchived_count,
    activities: result.activities.map((activity) => ({
      id: activity.id, activityDate: activity.activity_date, ...formatDate(activity.activity_date),
      time: formatTime(activity.scheduled_start_at, activity.scheduled_end_at),
      title: activity.custom_title,
      venue: activity.venue_snapshot.name ?? '未命名球館',
      location: `${activity.venue_snapshot.region ?? ''}${activity.venue_snapshot.district ?? ''}`,
      initialCourtCount: activity.initial_court_count ?? 1,
      members: activity.active_member_count,
      capacity: activity.capacity_mode === 'limited' ? activity.capacity_limit : null,
      status: activity.status === 'scheduled' && activity.scheduled_start_at && new Date(activity.scheduled_start_at).getTime() <= Date.now() ? 'in_progress' : activity.status,
      archivedAt: activity.archived_at,
    })),
  }
}

export function useActivityCenter() {
  const { user } = useAuth()
  const demoMode = isDemoMode()
  return useQuery({ queryKey: ['activity-center', user?.id ?? 'demo'], queryFn: () => demoMode ? Promise.resolve(demoData) : fetchActivityCenter(), enabled: demoMode || Boolean(user) })
}

export function useManageActivity() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ activityId, action }: { activityId: string; action: 'archive' | 'unarchive' | 'delete' }) => {
      if (isDemoMode()) return
      const { error } = await getSupabaseClient().rpc('manage_activity_lifecycle_v1', { target_activity_id: activityId, target_action: action })
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['activity-center'] }),
  })
}
