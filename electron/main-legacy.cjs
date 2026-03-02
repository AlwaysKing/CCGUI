// Legacy workaround for Electron API issue
const path = require('path')
const { spawn } = require('child_process')

// Start Vite in background
const vite = spawn('npm', ['run', 'dev'], {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  shell: true
})

console.log('Vite starting...')

// Wait and open in browser
setTimeout(() => {
  const { default: open } = require('open')
  open('http://localhost:5173')
  console.log('Opening browser... https://localhost:5173')
}, 2000)
