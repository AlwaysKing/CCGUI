function normalizeSessionOrder(order = []) {
  if (!Array.isArray(order)) {
    return []
  }

  const seen = new Set()
  const normalized = []
  for (const item of order) {
    const sessionId = typeof item === 'string' ? item.trim() : ''
    if (!sessionId || seen.has(sessionId)) {
      continue
    }
    seen.add(sessionId)
    normalized.push(sessionId)
  }
  return normalized
}

export function orderSessionsByList(sessions = [], sessionOrder = []) {
  const normalizedOrder = normalizeSessionOrder(sessionOrder)
  if (normalizedOrder.length === 0) {
    return [...sessions]
  }

  const orderIndex = new Map(normalizedOrder.map((sessionId, index) => [sessionId, index]))
  const missingSessions = []
  const orderedSessions = []
  for (const session of sessions) {
    if (!session?.id) {
      continue
    }
    if (orderIndex.has(session.id)) {
      orderedSessions.push(session)
    } else {
      missingSessions.push(session)
    }
  }

  orderedSessions.sort((left, right) => orderIndex.get(left.id) - orderIndex.get(right.id))
  return [...missingSessions, ...orderedSessions]
}

export function moveSessionIdsInOrder(order = [], sourceIds = [], targetIds = [], position = 'before') {
  const normalizedOrder = normalizeSessionOrder(order)
  const sourceIdSet = new Set(sourceIds)
  const targetIdSet = new Set(targetIds)
  const movingIds = normalizedOrder.filter(sessionId => sourceIdSet.has(sessionId))
  if (movingIds.length === 0) {
    return normalizedOrder
  }

  const remainingOrder = normalizedOrder.filter(sessionId => !sourceIdSet.has(sessionId))
  const targetSessionId = remainingOrder.find(sessionId => targetIdSet.has(sessionId))
  if (!targetSessionId) {
    return normalizedOrder
  }

  const targetIndex = remainingOrder.indexOf(targetSessionId)
  const insertIndex = targetIndex + (position === 'after' ? 1 : 0)
  remainingOrder.splice(insertIndex, 0, ...movingIds)
  return remainingOrder
}

export function mergeSessionOrderWithHidden(nextOrder = [], previousOrder = [], existingSessionIds = []) {
  const existingIdSet = new Set(existingSessionIds)
  const normalizedNextOrder = normalizeSessionOrder(nextOrder)
    .filter(sessionId => existingIdSet.size === 0 || existingIdSet.has(sessionId))
  const nextIdSet = new Set(normalizedNextOrder)
  const normalizedPreviousOrder = normalizeSessionOrder(previousOrder)
  const hiddenIdSet = new Set(
    normalizedPreviousOrder.filter(sessionId =>
      existingIdSet.has(sessionId) && !nextIdSet.has(sessionId)
    )
  )
  if (hiddenIdSet.size === 0) {
    return normalizedNextOrder
  }

  const hiddenBeforeFirst = []
  const hiddenAfterSession = new Map()
  let previousVisibleId = null
  for (const sessionId of normalizedPreviousOrder) {
    if (!hiddenIdSet.has(sessionId)) {
      if (existingIdSet.size === 0 || existingIdSet.has(sessionId)) {
        previousVisibleId = sessionId
      }
      continue
    }
    if (!previousVisibleId) {
      hiddenBeforeFirst.push(sessionId)
      continue
    }
    const hiddenIds = hiddenAfterSession.get(previousVisibleId) || []
    hiddenIds.push(sessionId)
    hiddenAfterSession.set(previousVisibleId, hiddenIds)
  }

  const mergedOrder = [...hiddenBeforeFirst]
  for (const sessionId of normalizedNextOrder) {
    mergedOrder.push(sessionId)
    mergedOrder.push(...(hiddenAfterSession.get(sessionId) || []))
  }
  return mergedOrder
}

export function buildSessionListGroups(sessions = [], options = {}) {
  const groupTeams = options.groupTeams !== false
  const groups = []
  const teamGroups = new Map()

  for (const session of sessions) {
    if (!session?.id) {
      continue
    }

    const teamId = groupTeams && typeof session.teamId === 'string'
      ? session.teamId.trim()
      : ''

    if (!teamId) {
      groups.push({
        key: `session:${session.id}`,
        teamId: null,
        teamName: null,
        sessions: [session]
      })
      continue
    }

    let group = teamGroups.get(teamId)
    if (!group) {
      group = {
        key: `team:${teamId}`,
        teamId,
        teamName: '',
        sessions: []
      }
      teamGroups.set(teamId, group)
      groups.push(group)
    }

    group.sessions.push(session)
    if (!group.teamName && typeof session.teamName === 'string' && session.teamName.trim()) {
      group.teamName = session.teamName.trim()
    }
  }

  for (const group of groups) {
    if (group.teamId && !group.teamName) {
      group.teamName = `团队 ${group.teamId.slice(0, 8)}`
    }
  }

  return groups
}
