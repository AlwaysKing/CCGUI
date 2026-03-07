const path = require('path')

console.log('=== Testing Electron API ===')
console.log('__dirname:', __dirname)
console.log('__filename:', __filename)
console.log('process.cwd():', process.cwd())
console.log('Electron path:', require.resolve('electron'))

try {
  const electronPath = require.resolve('electron')
  console.log('Electron resolved path:', electronPath)
  console.log('Electron dir contents:', require('fs').readdirSync(path.dirname(electronPath)).join(', '))
} catch (e) {
  console.log('Could not resolve electron path:', e.message)
}

// Check if we're in the main process
console.log('process.type:', process.type)
console.log('process.resourcesPath:', process.resourcesPath)

// Now try requiring electron
const electron = require('electron')

console.log('\n=== Electron module ===')
console.log('electron type:', typeof electron)
console.log('electron value:', electron)

// Try using the direct property access
const app = electron.app
const ipcMain = electron.ipcMain
const BrowserWindow = electron.BrowserWindow
const session = electron.session

console.log('\n=== After destructuring ===')
console.log('app:', typeof app, app)
console.log('ipcMain:', typeof ipcMain, ipcMain)
console.log('BrowserWindow:', typeof BrowserWindow)
console.log('session:', typeof session)

if (!ipcMain) {
  console.error('ERROR: ipcMain is undefined!')
  process.exit(1)
}

console.log('ipcMain.handle:', typeof ipcMain.handle)

// Register a test handler
ipcMain.handle('test-handler', async () => {
  return { success: true }
})

console.log('=== All imports OK, handler registered ===')

app.whenReady().then(() => {
  console.log('App is ready!')
  setTimeout(() => {
    console.log('Quitting...')
    app.quit()
  }, 1000)
})
