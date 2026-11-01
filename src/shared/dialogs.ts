import { create } from 'zustand'

/** Promise-based dialogs: `await confirmDialog(...)`, `await promptDialog(...)`. Rendered by <DialogHost />. */
export type DialogRequest =
  | { kind: 'confirm'; title: string; message: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; initial: string; resolve: (v: string | null) => void }
  | { kind: 'choice'; title: string; message: string; choices: string[]; resolve: (v: number | null) => void }

export const useDialogs = create<{ current: DialogRequest | null; seq: number }>()(() => ({ current: null, seq: 0 }))

function show(current: DialogRequest) {
  useDialogs.setState((s) => ({ current, seq: s.seq + 1 }))
}

export function confirmDialog(opts: { title: string; message: string; confirmLabel?: string; danger?: boolean }) {
  return new Promise<boolean>((resolve) => show({ kind: 'confirm', confirmLabel: 'OK', danger: false, ...opts, resolve }))
}

export function promptDialog(title: string, initial = '') {
  return new Promise<string | null>((resolve) => show({ kind: 'prompt', title, initial, resolve }))
}

/** One button per choice; resolves to the picked index, or null on Cancel. */
export function choiceDialog(opts: { title: string; message: string; choices: string[] }) {
  return new Promise<number | null>((resolve) => show({ kind: 'choice', ...opts, resolve }))
}
