import { themes } from './theme'
import type { Phase } from '../core/types'

export interface AppState {
  theme: typeof themes.dark
  phase: Phase
  currentInput: string
  isProcessing: boolean
  messages: Message[]
  activeDialog: string | null
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export const state: AppState = {
  theme: themes.dark,
  phase: 'OBSERVE',
  currentInput: '',
  isProcessing: false,
  messages: [],
  activeDialog: null,
}
