const { app, BrowserWindow } = require('electron')

console.log('Test app starting...')
console.log('app:', typeof app)

app.whenReady().then(() => {
  console.log('App is ready!')
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  win.loadURL('data:text/html,<h1>It Works!</h1>')
  setTimeout(() => app.quit(), 2000)
})
