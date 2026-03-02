console.log('Starting minimal Electron test...')

const electron = require('electron')
console.log('electron module type:', typeof electron)
console.log('electron keys:', Object.keys(electron || {}).slice(0, 5))

const { app, BrowserWindow } = electron
console.log('app type:', typeof app)
console.log('BrowserWindow type:', typeof BrowserWindow)

if (typeof app === 'undefined') {
  console.error('FATAL: app is undefined!')
  process.exit(1)
}

app.whenReady().then(() => {
  console.log('App is ready!')
  const win = new BrowserWindow({ width: 800, height: 600 })
  win.loadURL('data:text/html,<h1>Minimal Test Works!</h1>')
  console.log('Window created!')
})
