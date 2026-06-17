export interface Theme {
  name: string
  bg: string
  fg: string
  accent: string
  error: string
  warning: string
  success: string
  dim: string
}

export const themes = {
  dark: {
    name: 'dark',
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    accent: '#89b4fa',
    error: '#f38ba8',
    warning: '#fab387',
    success: '#a6e3a1',
    dim: '#6c7086',
  } as Theme,
  light: {
    name: 'light',
    bg: '#eff1f5',
    fg: '#4c4f69',
    accent: '#1e66f5',
    error: '#d20f39',
    warning: '#df8e1d',
    success: '#40a02b',
    dim: '#9ca0b0',
  } as Theme,
}

export function getTheme(): Theme {
  return storage.get('theme', themes.dark) ?? themes.dark
}

import { storage } from './storage'
