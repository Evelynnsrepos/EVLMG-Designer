import { create } from 'zustand'

/**
 * Interface language (pro fixes step 9). Texts stay in each module's English `UI` object; a German object next
 * to it overrides what is translated so far: `const UI = localized({...english}, {...german})`.
 * Translated in parts, so English stays the default until the German interface is complete.
 */
export type Lang = 'en' | 'de'
export const LANGS: { id: Lang; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'de', name: 'Deutsch (in Arbeit: erst ein Teil ist übersetzt)' },
]

const KEY = 'egd-lang'

function initial(): Lang {
  try {
    return localStorage.getItem(KEY) === 'de' ? 'de' : 'en'
  } catch {
    return 'en'
  }
}

export const useLangStore = create<{ lang: Lang }>()(() => ({ lang: initial() }))
export const useLang = () => useLangStore((s) => s.lang)
export const getLang = () => useLangStore.getState().lang

export function setLang(lang: Lang) {
  useLangStore.setState({ lang })
  try {
    localStorage.setItem(KEY, lang)
  } catch {
    // ignore
  }
  document.documentElement.lang = lang
}

/** Reads the current language on every access, so module-level UI objects follow a language switch (the app re-renders on it). */
export function localized<T extends object>(en: T, de: { [K in keyof T]?: T[K] }): T {
  return new Proxy(en, {
    get(target, key) {
      if (getLang() === 'de' && key in de) return (de as Record<string | symbol, unknown>)[key]
      return Reflect.get(target, key)
    },
  })
}
