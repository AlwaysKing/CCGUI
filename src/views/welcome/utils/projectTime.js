const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000

export function isRecentProject(project) {
  if (!project.lastActiveAt) return false

  const lastActive = new Date(project.lastActiveAt).getTime()
  return (Date.now() - lastActive) < TEN_DAYS_MS
}

export function formatProjectLastActive(dateStr) {
  if (!dateStr) return '未知'

  const date = new Date(dateStr)
  const diff = Date.now() - date.getTime()

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return date.toLocaleDateString('zh-CN')
}
