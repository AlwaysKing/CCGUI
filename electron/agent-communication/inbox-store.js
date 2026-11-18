const fs = require('fs')
const path = require('path')
const { getCcguiHome } = require('../runtime-paths')

const STORE_VERSION = 1
const MAX_UNREAD_MESSAGES = 100

function getInboxPath(projectId) {
  return path.join(getCcguiHome(), 'projects', projectId, 'agent-inbox.json')
}

function loadInbox(projectId) {
  const filePath = getInboxPath(projectId)
  if (!fs.existsSync(filePath)) {
    return {}
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return raw?.messages && typeof raw.messages === 'object' ? raw.messages : {}
  } catch {
    return {}
  }
}

function saveInbox(projectId, messages = {}) {
  const filePath = getInboxPath(projectId)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({
    version: STORE_VERSION,
    messages
  }, null, 2), 'utf8')
}

function listMessages(projectId, sessionId, { unreadOnly = true } = {}) {
  const messages = loadInbox(projectId)[sessionId] || []
  return unreadOnly ? messages.filter(message => !message.read_at) : messages
}

function addMessage(projectId, sessionId, message) {
  const inbox = loadInbox(projectId)
  const messages = inbox[sessionId] || []
  messages.push(message)

  const unread = messages.filter(item => !item.read_at)
  if (unread.length > MAX_UNREAD_MESSAGES) {
    const overflow = unread.length - MAX_UNREAD_MESSAGES
    const removedIds = new Set(unread.slice(0, overflow).map(item => item.message_id))
    const kept = messages.filter(item => !removedIds.has(item.message_id))
    inbox[sessionId] = kept
  } else {
    inbox[sessionId] = messages
  }

  saveInbox(projectId, inbox)
  return message
}

function ackMessages(projectId, sessionId, messageIds = []) {
  const inbox = loadInbox(projectId)
  const messages = inbox[sessionId] || []
  const targetIds = new Set(messageIds.filter(Boolean))
  const readAt = new Date().toISOString()

  for (const message of messages) {
    if (targetIds.has(message.message_id) && !message.read_at) {
      message.read_at = readAt
    }
  }

  inbox[sessionId] = messages
  saveInbox(projectId, inbox)
  return messages.filter(message => targetIds.has(message.message_id))
}

module.exports = {
  ackMessages,
  addMessage,
  listMessages,
  loadInbox
}
