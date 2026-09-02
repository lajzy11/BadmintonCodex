import { createContext, useContext } from 'react'

export type FeedbackTone = 'info' | 'success' | 'warning' | 'error'
export type ToastInput = { message: string; tone?: FeedbackTone; duration?: number }

export const FeedbackContext = createContext<{ notify: (input: ToastInput | string) => void } | null>(null)

export function useFeedback() {
  const value = useContext(FeedbackContext)
  if (!value) throw new Error('useFeedback must be used within FeedbackProvider')
  return value
}
