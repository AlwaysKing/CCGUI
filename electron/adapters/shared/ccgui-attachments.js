const ATTACHMENT_TOKEN_REGEX = /\[\[att:([^\]]+)\]\]/g

function getAttachmentDisplayLabel(attachment) {
  if (!attachment) return '附件'

  if (attachment.kind === 'file-range') {
    const startLine = Number.isFinite(attachment.startLine) ? attachment.startLine : null
    const endLine = Number.isFinite(attachment.endLine) ? attachment.endLine : null

    if (startLine && endLine) {
      return `${attachment.name} (${startLine}-${endLine})`
    }

    if (startLine) {
      return `${attachment.name} (${startLine})`
    }
  }

  return attachment.name || '附件'
}

function replaceAttachmentTokens(text, attachments = [], formatter = null) {
  const attachmentMap = new Map((attachments || []).map(item => [item.id, item]))

  return String(text || '').replace(ATTACHMENT_TOKEN_REGEX, (_, id) => {
    const attachment = attachmentMap.get(id)
    if (!attachment) {
      return '[附件缺失]'
    }

    if (typeof formatter === 'function') {
      return formatter(attachment)
    }

    return `[${getAttachmentDisplayLabel(attachment)}]`
  })
}

function buildClaudeAttachmentReference(attachment) {
  if (!attachment) return '[附件]'

  if (attachment.kind?.startsWith('reference-')) {
    // 引用型附件由 provider.translateReferenceAttachment 单独处理，
    // token 位置替换为空字符串，避免在文本中出现重复引用
    return ''
  }

  if (attachment.kind === 'image') {
    return `[图片: ${attachment.path || attachment.name}]`
  }

  if (attachment.kind === 'file-range') {
    const startLine = Number.isFinite(attachment.startLine) ? attachment.startLine : '?'
    const endLine = Number.isFinite(attachment.endLine) ? attachment.endLine : startLine
    return `[文件片段: ${attachment.path} (${startLine}-${endLine})]`
  }

  return `[文件: ${attachment.path || attachment.name}]`
}

function buildCodexAttachmentReference(attachment) {
  if (!attachment) return '[附件]'

  if (attachment.kind?.startsWith('reference-')) {
    const kind = attachment.kind.replace('reference-', '')
    const name = attachment.name || ''
    const value = attachment.value || ''
    const providerMeta = attachment.providerMeta || {}
    const codexMentionName = typeof providerMeta.codexMentionName === 'string' && providerMeta.codexMentionName.trim()
      ? providerMeta.codexMentionName.trim()
      : name
    const codexMentionPath = typeof providerMeta.codexMentionPath === 'string' && providerMeta.codexMentionPath.trim()
      ? providerMeta.codexMentionPath.trim()
      : (providerMeta.path || value || '')

    switch (kind) {
      case 'agent':
      case 'plugin': {
        return codexMentionName && codexMentionPath ? `[@${codexMentionName}](${codexMentionPath})` : ''
      }
      case 'skill':
      case 'app': {
        return codexMentionName && codexMentionPath ? `[$${codexMentionName}](${codexMentionPath})` : ''
      }
      default:
        return ''
    }
  }

  if (attachment.kind === 'image') {
    return `[图片 ${attachment.path || attachment.name}]`
  }

  if (attachment.kind === 'file-range') {
    return `[文件片段 ${getAttachmentDisplayLabel(attachment)}]`
  }

  return `[文件 ${attachment.name}]`
}

function stripAttachmentTokens(text, attachments = []) {
  return replaceAttachmentTokens(text, attachments, attachment => getAttachmentDisplayLabel(attachment))
}

module.exports = {
  ATTACHMENT_TOKEN_REGEX,
  getAttachmentDisplayLabel,
  replaceAttachmentTokens,
  buildClaudeAttachmentReference,
  buildCodexAttachmentReference,
  stripAttachmentTokens
}
