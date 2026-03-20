const path = require('path')

function encodeProjectPath(projectPath) {
  let encodedPath = projectPath
  if (process.platform === 'win32') {
    encodedPath = encodedPath.replace(/:/g, '').replace(/\\/g, '-')
  } else {
    encodedPath = encodedPath.replace(/\//g, '-')
  }
  if (encodedPath.startsWith('-')) {
    encodedPath = encodedPath.slice(1)
  }
  return '-' + encodedPath
}

function decodeProjectPath(encodedName) {
  let decoded = encodedName.startsWith('-') ? encodedName.slice(1) : encodedName
  if (process.platform === 'win32') {
    decoded = decoded.replace(/^([A-Za-z])-/, '$1:/')
    decoded = decoded.slice(2).replace(/-/g, '/')
  } else {
    decoded = '/' + decoded.replace(/-/g, '/')
  }
  return decoded
}

module.exports = {
  encodeProjectPath,
  decodeProjectPath
}
