// Builds the phone page (remote/app) into remote/dist, which the Worker serves at remote.loom.baby.
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = resolve(import.meta.dirname, '..')

export default defineConfig({
  root: resolve(root, 'remote/app'),
  publicDir: resolve(root, 'remote/public'),
  resolve: {
    alias: {
      '@shared': resolve(root, 'src/shared'),
      '@renderer': resolve(root, 'src/renderer/src')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve(root, 'remote/dist'),
    emptyOutDir: true,
    target: 'es2022',
    // Two pages: the app, and the "not found" page the Worker serves for any other address.
    rollupOptions: {
      input: {
        index: resolve(root, 'remote/app/index.html'),
        404: resolve(root, 'remote/app/404.html')
      }
    }
  }
})
