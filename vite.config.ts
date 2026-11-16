/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// Tauri guesses a file's type from its first 1024 bytes before its name: "%PDF" there turns a .js file
// into a PDF, the webview refuses it and every tool sharing that file crashes (0.32 Design Book bug).
const noFileMagicInChunks: Plugin = {
  name: 'no-file-magic-in-chunks',
  generateBundle(_, bundle) {
    for (const f of Object.values(bundle)) {
      const text = f.type === 'chunk' ? f.code : typeof f.source === 'string' ? f.source : ''
      if (text.slice(0, 1024).includes('%PDF')) this.error(`${f.fileName} has "%PDF" in its first 1024 bytes; Tauri would serve it as a PDF.`)
    }
  },
}

// Tauri expects a fixed dev port and wants to see Rust errors in the terminal.
export default defineConfig({
  plugins: [react(), noFileMagicInChunks],
  clearScreen: false,
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Git worktrees of other branches live in worktrees/ (git-ignored): never part of this app.
    watch: { ignored: ['**/src-tauri/**', '**/worktrees/**'] },
  },
  // Only this app's page: scanning worktrees/*/index.html pulled in a second React from their node_modules.
  optimizeDeps: { entries: ['index.html'] },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Windows CI runs the GPU material tests beside small render tests; 5 s is too tight there.
    testTimeout: 20_000,
  },
})
