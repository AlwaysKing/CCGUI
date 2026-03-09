// 在 Electron 主进程中，require('electron') 应该自动注入 API
console.log('=== Minimal Electron Test ===')
console.log('Running in Electron:', process.versions.electron)
console.log('Node version:', process.versions.node)
console.log('Process execPath:', process.execPath)

// 检查 global 对象
console.log('global keys (first 10):', Object.keys(global).slice(0, 10))

// 检查 process 对象
console.log('process.electronBinding:', typeof process.electronBinding)

// 尝试直接访问 Electron API
try {
  const { app, BrowserWindow } = require('electron')
  console.log('Successfully required electron')
  console.log('app type:', typeof app)
  console.log('BrowserWindow type:', typeof BrowserWindow)
  
  if (app) {
    console.log('App is available!')
    app.whenReady().then(() => {
      console.log('App is ready!')
      setTimeout(() => {
        console.log('Quitting...')
        app.quit()
      }, 1000)
    })
  } else {
    console.log('ERROR: app is undefined!')
    process.exit(1)
  }
} catch (error) {
  console.log('ERROR:', error.message)
  console.log('Stack:', error.stack)
  process.exit(1)
}
