import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { logger } from './utils/logger'
import './styles/global.css'

// 初始化日志系统
logger.initialize().catch(error => {
  console.error('Failed to initialize logger:', error)
})

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
