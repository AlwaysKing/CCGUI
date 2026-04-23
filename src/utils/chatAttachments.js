export const ATTACHMENT_TOKEN_PREFIX = '[[att:'
export const ATTACHMENT_TOKEN_REGEX = /\[\[att:([^\]]+)\]\]/g

export function createAttachmentToken(id) {
  return `[[att:${id}]]`
}

export function isImageAttachment(attachment) {
  return attachment?.kind === 'image'
}

export function isReferenceAttachment(attachment) {
  return attachment?.kind?.startsWith('reference-')
}

export function getReferenceKind(attachment) {
  if (!isReferenceAttachment(attachment)) return null
  return attachment.kind.replace('reference-', '')
}

export function getAttachmentDisplayLabel(attachment) {
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

export function replaceAttachmentTokens(text, attachments = [], formatter = null) {
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

export function stripAttachmentTokens(text, attachments = []) {
  return replaceAttachmentTokens(text, attachments, attachment => getAttachmentDisplayLabel(attachment))
}

export function extractAttachmentIds(text) {
  const ids = []
  const source = String(text || '')
  let match
  ATTACHMENT_TOKEN_REGEX.lastIndex = 0
  while ((match = ATTACHMENT_TOKEN_REGEX.exec(source)) !== null) {
    ids.push(match[1])
  }
  ATTACHMENT_TOKEN_REGEX.lastIndex = 0
  return ids
}

export function formatAttachmentSize(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return ''
  }

  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

export function createAttachmentChipText(attachment) {
  const label = getAttachmentDisplayLabel(attachment)
  if (attachment?.kind === 'image') {
    return `图片 ${label}`
  }
  if (attachment?.kind === 'file-range') {
    return `片段 ${label}`
  }
  if (isReferenceAttachment(attachment)) {
    return `@${label}`
  }
  return label
}

export function toAttachmentUrl(filePath) {
  const source = String(filePath || '')
  if (!source) return ''
  if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://') || source.startsWith('ccgui-asset://')) {
    return source
  }
  return `ccgui-asset://local?path=${encodeURIComponent(source)}`
}

export function getAttachmentIcon(attachment) {
  if (!attachment) return '📎'
  if (attachment.kind === 'image') return '🖼️'
  if (attachment.kind === 'file-range') return '✂️'
  if (attachment.kind === 'reference-agent') return '🤖'
  if (attachment.kind === 'reference-plugin') return '🔌'
  if (attachment.kind === 'reference-skill') return '⚡'

  const name = String(attachment.name || attachment.path || '').toLowerCase()
  const extension = name.includes('.') ? `.${name.split('.').pop()}` : ''

  if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'].includes(extension)) return '🟨'
  if (extension === '.vue') return '🟩'
  if (['.json', '.yaml', '.yml', '.toml'].includes(extension)) return '🧩'
  if (['.md', '.txt'].includes(extension)) return '📝'
  if (['.css', '.scss', '.less'].includes(extension)) return '🎨'
  if (['.html', '.xml'].includes(extension)) return '🌐'
  if (extension === '.pdf') return '📕'
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'].includes(extension)) return '🖼️'
  if (['.zip', '.tar', '.gz', '.tgz'].includes(extension)) return '🗜️'
  return '📄'
}
