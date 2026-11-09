import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // .env.example lives at the monorepo root, so load .env from there too;
  // otherwise copying it to the documented place silently yields an
  // unconfigured app. Safe because Vite only exposes VITE_-prefixed vars to
  // client code, so the Edge Function secrets in the same file never bundle.
  envDir: '../../',
  plugins: [react(), tailwindcss()],
})
