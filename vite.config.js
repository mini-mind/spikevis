import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    host: true,
    open: true
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // h5wasm 0.10 用到 BigInt 等 ES2020 特性，构建目标必须 >= es2020
    target: 'es2020'
  }
})
