const { app, BrowserWindow, ipcMain } = require('electron')

console.log('Testing ipcMain:', typeof ipcMain)
console.log('ipcMain.handle:', typeof ipcMain?.handle)

app.whenReady().then(() => {
  console.log('App is ready')
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  win.loadURL('about:blank')
})
