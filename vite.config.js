import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Static build (dist/) — deploy as-is to Vercel.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: { outDir: 'dist' },
})
