/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// Tauri expects a fixed dev port and wants to see Rust errors in the terminal.
export default defineConfig({
  plugins: [react()],
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
  },
})
