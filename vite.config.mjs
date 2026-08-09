import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 基于构建时间生成版本号：年.月.日.当天分钟数
function generateBuildVersion() {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const d = now.getDate()
  const minutes = now.getHours() * 60 + now.getMinutes()
  return `${y}.${m}.${d}.${minutes}`
}

export default defineConfig({
  plugins: [vue()],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(generateBuildVersion())
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5183,
    strictPort: true
  },
  build: {
    outDir: 'dist'
  }
})
