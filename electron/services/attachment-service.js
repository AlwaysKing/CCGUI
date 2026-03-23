const fs = require('fs')
const os = require('os')
const path = require('path')

const TEMP_ATTACHMENT_DIR = path.join('/tmp', 'cache', 'ccgui-attachments')

const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.bmp', 'image/bmp'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.js', 'text/javascript'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/tsx'],
  ['.jsx', 'text/jsx'],
  ['.json', 'application/json'],
  ['.css', 'text/css'],
  ['.html', 'text/html'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.pdf', 'application/pdf']
])

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function ensureTempAttachmentDir() {
  ensureDir(TEMP_ATTACHMENT_DIR)
  return TEMP_ATTACHMENT_DIR
}

function getTempAttachmentDir() {
  return TEMP_ATTACHMENT_DIR
}

function isManagedTempAttachment(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    return false
  }

  const normalized = path.resolve(filePath)
  return normalized.startsWith(path.resolve(TEMP_ATTACHMENT_DIR))
}

function inferExtensionFromMimeType(mimeType = '') {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/bmp') return '.bmp'
  if (normalized === 'image/svg+xml') return '.svg'
  if (normalized === 'application/pdf') return '.pdf'
  return ''
}

function inferMimeType(filePath, fallback = null) {
  if (fallback) {
    return fallback
  }

  const ext = path.extname(String(filePath || '')).toLowerCase()
  return MIME_BY_EXTENSION.get(ext) || null
}

function isTextMimeType(mimeType = '', filePath = '') {
  const normalized = String(mimeType || '').toLowerCase()
  if (normalized.startsWith('text/')) {
    return true
  }

  if (
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized === 'application/yaml'
  ) {
    return true
  }

  const ext = path.extname(String(filePath || '')).toLowerCase()
  return ['.md', '.js', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.xml', '.yaml', '.yml', '.txt'].includes(ext)
}

function saveClipboardImage({ bufferBase64, mimeType, suggestedName = '' }) {
  ensureTempAttachmentDir()

  const extension = path.extname(suggestedName || '') || inferExtensionFromMimeType(mimeType) || '.png'
  const fileName = `paste-${Math.random().toString(36).slice(2, 8)}${extension}`
  const targetPath = path.join(TEMP_ATTACHMENT_DIR, fileName)
  const buffer = Buffer.from(bufferBase64, 'base64')

  fs.writeFileSync(targetPath, buffer)

  return {
    path: targetPath,
    name: fileName,
    size: buffer.length,
    mimeType: inferMimeType(targetPath, mimeType)
  }
}

function deleteTempAttachment(filePath) {
  if (!isManagedTempAttachment(filePath)) {
    return false
  }

  if (!fs.existsSync(filePath)) {
    return false
  }

  fs.unlinkSync(filePath)
  return true
}

function getAttachmentSize(filePath) {
  try {
    const stat = fs.statSync(filePath)
    return stat.size
  } catch (error) {
    return null
  }
}

function readFileAsBase64(filePath) {
  return fs.readFileSync(filePath).toString('base64')
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}

function readFileRange(filePath, startLine, endLine) {
  const content = readTextFile(filePath)
  const lines = content.split(/\r?\n/)
  const start = Math.max(1, Number(startLine) || 1)
  const end = Math.max(start, Number(endLine) || start)
  return lines.slice(start - 1, end).join('\n')
}

function getHistoryDataDir(projectId, sessionId) {
  return path.join(os.homedir(), '.ccgui', 'projects', projectId, 'sessions', sessionId, 'history', 'data')
}

function finalizeAttachmentsForHistory(projectId, sessionId, attachments = []) {
  const historyDir = getHistoryDataDir(projectId, sessionId)
  ensureDir(historyDir)

  return attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object') {
      return attachment
    }

    if (!attachment.path || !fs.existsSync(attachment.path)) {
      const attachmentName = attachment.name || attachment.path || attachment.id || 'unknown'
      throw new Error(`Attachment file not found: ${attachmentName}`)
    }

    if (attachment.kind !== 'image') {
      return {
        ...attachment,
        mimeType: attachment.mimeType || inferMimeType(attachment.path),
        size: Number.isFinite(attachment.size) ? attachment.size : getAttachmentSize(attachment.path)
      }
    }

    if (!isManagedTempAttachment(attachment.path) || !fs.existsSync(attachment.path)) {
      return {
        ...attachment,
        mimeType: attachment.mimeType || inferMimeType(attachment.path),
        size: Number.isFinite(attachment.size) ? attachment.size : getAttachmentSize(attachment.path)
      }
    }

    const extension = path.extname(attachment.path) || inferExtensionFromMimeType(attachment.mimeType) || '.png'
    const targetName = `${attachment.id}${extension}`
    const targetPath = path.join(historyDir, targetName)
    fs.copyFileSync(attachment.path, targetPath)
    fs.unlinkSync(attachment.path)

    return {
      ...attachment,
      path: targetPath,
      name: attachment.name || targetName,
      mimeType: attachment.mimeType || inferMimeType(targetPath),
      size: Number.isFinite(attachment.size) ? attachment.size : getAttachmentSize(targetPath)
    }
  })
}

module.exports = {
  TEMP_ATTACHMENT_DIR,
  ensureTempAttachmentDir,
  getTempAttachmentDir,
  isManagedTempAttachment,
  inferMimeType,
  isTextMimeType,
  saveClipboardImage,
  deleteTempAttachment,
  getAttachmentSize,
  readFileAsBase64,
  readTextFile,
  readFileRange,
  getHistoryDataDir,
  finalizeAttachmentsForHistory
}
