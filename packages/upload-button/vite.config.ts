import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'lib/index.ts'),
      formats: ['es', 'cjs'],
      // 不写 fileName：Vite 默认按 package.json 的 name 输出 upload-button.js / .cjs
    },
    minify: false,
    rollupOptions: {
      external: (id) => id === 'preact' || id.startsWith('preact/'),
    },
  },
})
