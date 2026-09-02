import { appConfig } from './config'

const guestModeKey = 'badminton-match-master-guest-mode'

export function isGuestMode(): boolean {
  return typeof window !== 'undefined' && window.sessionStorage.getItem(guestModeKey) === '1'
}

export function isDemoMode(): boolean {
  return appConfig.isDemo || isGuestMode()
}

export function enableGuestMode(): void {
  window.sessionStorage.setItem(guestModeKey, '1')
}

export function disableGuestMode(): void {
  window.sessionStorage.removeItem(guestModeKey)
}
