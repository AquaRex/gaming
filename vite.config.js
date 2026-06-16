import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // App is served from hetland.dev/gaming/ — assets must resolve under that path.
  base: '/gaming/',
  plugins: [react()],
})
