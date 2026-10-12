import { create } from 'zustand'

/** Whether the Settings dialog is open, and the section to show first; opened from the start screen and the sidebar. */
export const useSettingsDialog = create<{ open: boolean; section?: string }>()(() => ({ open: false }))
export const openSettings = (section?: unknown) => useSettingsDialog.setState({ open: true, section: typeof section === 'string' ? section : undefined })
