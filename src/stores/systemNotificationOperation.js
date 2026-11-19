const MCP_NOTIFICATION_TYPES = new Set([
  'mcp-server-starting',
  'mcp-server-ready',
  'mcp-server-error',
  'mcp-server-status'
])

const MCP_LIFECYCLE_NOTIFICATION_TYPES = new Set([
  'mcp-server-starting',
  'mcp-server-ready',
  'mcp-server-error'
])

export function isMcpNotificationType(type = '') {
  return MCP_NOTIFICATION_TYPES.has(type)
}

export function isMcpLifecycleNotificationType(type = '') {
  return MCP_LIFECYCLE_NOTIFICATION_TYPES.has(type)
}

export function shouldIgnoreMcpNotificationUpdate(currentType = '', nextType = '') {
  return (currentType === nextType && currentType !== 'mcp-server-status') ||
    (currentType === 'mcp-server-error' && nextType === 'mcp-server-ready')
}

export function findMcpNotificationByOperationId(queues, operationId) {
  if (!operationId) return null

  for (const queue of queues || []) {
    const entries = queue?.entries || []
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const message = entries[index]
      if (
        message?.role === 'system_notification' &&
        isMcpNotificationType(message.notificationType) &&
        message.data?.operationId === operationId
      ) {
        return { queue, message }
      }
    }
  }

  return null
}
