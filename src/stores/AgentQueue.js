import { reactive } from 'vue'

/**
 * AgentQueue — 单个 agent 的消息队列
 * 每条 entry 保持与现有 message 对象完全相同的字段结构，
 * 额外增加 type 字段用于区分 entry 类型（message / tool_use / subagent_call / notification）。
 */
export class AgentQueue {
  /**
   * @param {string} agentId
   * @param {Map} globalIndex - 全局索引（由 QueueManager 维护），id → { queue, entry }
   */
  constructor(agentId, globalIndex) {
    this.agentId = agentId
    this._entries = reactive([])
    this._globalIndex = globalIndex
  }

  get entries() {
    return this._entries
  }

  get length() {
    return this._entries.length
  }

  // ==================== 写操作 ====================

  /**
   * 追加一条 entry。自动包装 reactive。
   * @returns {object} 追加后的 reactive entry
   */
  append(entry) {
    const r = reactive(entry)
    this._entries.push(r)
    if (entry.id) {
      this._globalIndex.set(entry.id, { queue: this, entry: r })
    }
    return r
  }

  /**
   * 在指定位置插入 entry。
   */
  insertAt(index, entry) {
    const r = reactive(entry)
    this._entries.splice(index, 0, r)
    if (entry.id) {
      this._globalIndex.set(entry.id, { queue: this, entry: r })
    }
    return r
  }

  /**
   * 删除指定位置的 entry，可同时插入新 entry。
   */
  splice(start, deleteCount, ...items) {
    const reactiveItems = items.map(item => reactive(item))
    const removed = this._entries.splice(start, deleteCount, ...reactiveItems)
    for (const r of removed) {
      if (r.id) this._globalIndex.delete(r.id)
    }
    for (let i = 0; i < reactiveItems.length; i++) {
      if (items[i].id) {
        this._globalIndex.set(items[i].id, { queue: this, entry: reactiveItems[i] })
      }
    }
    return removed
  }

  /**
   * 按 ID 删除。
   */
  removeById(id) {
    const entry = this.findById(id)
    if (!entry) return null
    const idx = this._entries.indexOf(entry)
    if (idx >= 0) {
      this._entries.splice(idx, 1)
      this._globalIndex.delete(id)
    }
    return entry
  }

  /**
   * 在指定位置批量插入多条 entry（单次 splice，性能更优）。
   */
  insertManyAt(index, items) {
    const reactiveItems = items.map(item => reactive(item))
    this._entries.splice(index, 0, ...reactiveItems)
    for (let i = 0; i < reactiveItems.length; i++) {
      if (items[i].id) {
        this._globalIndex.set(items[i].id, { queue: this, entry: reactiveItems[i] })
      }
    }
    return items.length
  }

  /**
   * 重置队列。
   */
  reset() {
    for (const e of this._entries) {
      if (e.id) this._globalIndex.delete(e.id)
    }
    this._entries.splice(0)
  }

  // ==================== 时间戳 ====================

  get firstTimestamp() {
    for (const e of this._entries) {
      const ts = e.timestamp || (e.ccgui?.orchestration?.timestamp)
      if (ts) return ts
    }
    return null
  }

  get lastTimestamp() {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const ts = this._entries[i].timestamp || (this._entries[i].ccgui?.orchestration?.timestamp)
      if (ts) return ts
    }
    return null
  }

  // ==================== 读操作 ====================

  /**
   * 按 ID 查找（O(1)）。
   */
  findById(id) {
    const ref = this._globalIndex.get(id)
    if (ref && ref.queue === this) return ref.entry
    return null
  }

  /**
   * 按 ID 找索引。
   */
  indexOfId(id) {
    const entry = this.findById(id)
    if (!entry) return -1
    return this._entries.indexOf(entry)
  }

  /**
   * 从底部查找 tool_use / diff，匹配 id 或 request_id。
   * 用于 tool_result 回来时绑定到对应的 tool_use。
   */
  findToolUse(toolUseId) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      const e = this._entries[i]
      if ((e.role === 'tool_use' || e.role === 'diff') &&
          (e.id === toolUseId || e.request_id === toolUseId)) {
        return e
      }
    }
    return null
  }

  /**
   * 查找当前正在流式传输的消息。
   */
  findStreaming(streamingId = null) {
    if (streamingId) {
      for (let i = this._entries.length - 1; i >= 0; i--) {
        if (this._entries[i].id === streamingId) return this._entries[i]
      }
    }
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (this._entries[i].isStreaming) return this._entries[i]
    }
    return null
  }

  /**
   * 从底部查找满足 predicate 的第一条 entry。
   */
  findLatest(predicate) {
    for (let i = this._entries.length - 1; i >= 0; i--) {
      if (predicate(this._entries[i])) return this._entries[i]
    }
    return null
  }

  /**
   * 从底部查找指定 role 的第一条 entry。
   */
  findLatestByRole(role) {
    return this.findLatest(e => e.role === role)
  }

  /**
   * 过滤 entries。
   */
  filter(predicate) {
    return this._entries.filter(predicate)
  }

  /**
   * 遍历 entries。
   */
  forEach(callback) {
    this._entries.forEach(callback)
  }

  /**
   * 浅拷贝为普通数组。
   */
  toArray() {
    return [...this._entries]
  }
}

/**
 * QueueManager — 管理所有 agent 的队列
 * 提供：
 *  - per-agent queue 的创建和获取
 *  - 跨队列的全局查找（by ID）
 *  - 消息路由（根据消息身份分发到正确的队列）
 */
export class QueueManager {
  constructor() {
    /** @type {Map<string, AgentQueue>} agentId → AgentQueue (reactive) */
    this.queues = reactive(new Map())
    /** 全局索引 id → { queue, entry } */
    this._globalIndex = new Map()
  }

  // ==================== 队列管理 ====================

  getQueue(agentId) {
    return this.queues.get(agentId) || null
  }

  getOrCreateQueue(agentId) {
    let queue = this.queues.get(agentId)
    if (!queue) {
      queue = new AgentQueue(agentId, this._globalIndex)
      this.queues.set(agentId, queue)
    }
    return queue
  }

  hasQueue(agentId) {
    return this.queues.has(agentId)
  }

  deleteQueue(agentId) {
    const queue = this.queues.get(agentId)
    if (queue) {
      queue.reset()
      this.queues.delete(agentId)
    }
  }

  // ==================== 全局查找 ====================

  /**
   * 在所有队列中按 ID 查找 entry。
   * @returns {{ queue: AgentQueue, entry: object } | null}
   */
  findGlobal(id) {
    return this._globalIndex.get(id) || null
  }

  /**
   * 在所有队列中按 ID 找 entry 对象。
   */
  findEntryGlobal(id) {
    const ref = this._globalIndex.get(id)
    return ref ? ref.entry : null
  }

  /**
   * 在所有队列中按 ID 找 entry 所在的队列。
   */
  findQueueForEntry(id) {
    const ref = this._globalIndex.get(id)
    return ref ? ref.queue : null
  }

  /**
   * 在所有队列中从底部查找满足 predicate 的第一条 entry。
   * （用于需要跨队列搜索的场景，如查找当前流式消息）
   */
  findLatestGlobal(predicate) {
    // 从各个队列中取最新匹配，然后按时间戳比较
    let best = null
    let bestTs = -1
    for (const queue of this.queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const e = queue.entries[i]
        if (predicate(e)) {
          const ts = e.timestamp ? new Date(e.timestamp).getTime() : i
          if (ts > bestTs) {
            best = e
            bestTs = ts
          }
          break // 每个队列只取最新的一条
        }
      }
    }
    return best
  }

  /**
   * 在所有队列中从底部查找指定 tool_use_id 的 tool_use entry。
   */
  findToolUseGlobal(toolUseId) {
    for (const queue of this.queues.values()) {
      const entry = queue.findToolUse(toolUseId)
      if (entry) return { queue, entry }
    }
    return null
  }

  // ==================== 路由 ====================

  /**
   * 根据消息的身份信息，确定目标队列并返回。
   * 优先级与原 getMessageAgentId 一致：
   *   1. agentToolUseBindings
   *   2. ccgui.attribution.agentId
   *   3. ccgui.registry.agentId
   *   4. ccgui.orchestration.agentId
   *   5. mainAgentId
   */
  routeToQueue(session, message) {
    const mainAgentId = this._getMainAgentId(session)
    const agentId = this._resolveAgentId(session, message, mainAgentId)
    return this.getOrCreateQueue(agentId)
  }

  /**
   * 只解析目标 agentId，不创建队列。
   */
  resolveAgentId(session, message) {
    const mainAgentId = this._getMainAgentId(session)
    return this._resolveAgentId(session, message, mainAgentId)
  }

  // ==================== 重置 ====================

  resetAll() {
    for (const queue of this.queues.values()) {
      queue.reset()
    }
    this.queues.clear()
    this._globalIndex.clear()
  }

  // ==================== 内部方法 ====================

  _getMainAgentId(session) {
    return session?.mainAgentId || 'master'
  }

  _resolveAgentId(session, message, mainAgentId) {
    if (!message || !session) return mainAgentId

    // 1. agentToolUseBindings
    const linkedToolUseId = this._getMessageToolUseId(message)
    if (linkedToolUseId && session.agentToolUseBindings?.has(linkedToolUseId)) {
      return session.agentToolUseBindings.get(linkedToolUseId)
    }

    // 2-4. ccgui 字段
    const ccgui = message.ccgui || null
    if (ccgui?.attribution?.agentId) return ccgui.attribution.agentId
    if (ccgui?.registry?.agentId) return ccgui.registry.agentId
    if (ccgui?.orchestration?.agentId) return ccgui.orchestration.agentId

    return mainAgentId
  }

  _getMessageToolUseId(message) {
    if (!message || typeof message !== 'object') return null
    if (message.tool_use_id) return message.tool_use_id
    if (message.toolUseId) return message.toolUseId
    if (message.request_id) return message.request_id
    if (message.requestId) return message.requestId
    if ((message.role === 'tool_use' || message.role === 'diff') && message.id) return message.id
    return null
  }
}
