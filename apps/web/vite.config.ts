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
  build: {
    // The only chunk over the 500 kB default is Scene3D (~920 kB raw, ~245 kB
    // gzip), which is three plus its WebGL renderer. It cannot be tree-shaken:
    // @react-three/fiber registers the whole three namespace into its JSX
    // catalogue via extend(THREE), so every export is reachable. It is loaded
    // lazily and only on a WebGL device — the entry chunk is ~280 kB and the
    // garden route adds ~17 kB before the renderer is requested. Raising the
    // limit here rather than splitting three would just produce the same bytes
    // across more requests.
    chunkSizeWarningLimit: 1000,
  },
})
