import { ref, computed, toRaw } from 'vue'

const REGISTRY_URL = 'https://registry.modelcontextprotocol.io/v0/servers'

const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

function getCacheKey(url) {
  return url
}

function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.time > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, time: Date.now() })
}

function extractSlug(name) {
  if (!name) return ''
  const parts = name.split('/')
  return parts[parts.length - 1] || name
}

function transformServer(entry) {
  const server = entry.server || {}
  const meta = entry._meta?.['io.modelcontextprotocol.registry/official'] || {}

  // 提取传输类型
  const transportTypes = []
  if (server.remotes?.length) {
    for (const r of server.remotes) {
      if (r.type && !transportTypes.includes(r.type)) {
        transportTypes.push(r.type)
      }
    }
  }
  if (server.packages?.length) {
    for (const p of server.packages) {
      if (p.registryType && !transportTypes.includes(p.registryType)) {
        transportTypes.push(p.registryType)
      }
    }
  }

  // 收集所有环境变量
  const envVars = []
  if (server.packages?.length) {
    for (const p of server.packages) {
      if (p.environmentVariables) {
        for (const ev of p.environmentVariables) {
          if (!envVars.find(e => e.name === ev.name)) {
            envVars.push(ev)
          }
        }
      }
    }
  }
  // remotes 上的 headers 中 required 的也视为需要配置
  if (server.remotes?.length) {
    for (const r of server.remotes) {
      if (r.headers) {
        for (const h of r.headers) {
          if (h.isRequired && !envVars.find(e => e.name === h.name)) {
            envVars.push({
              name: h.name,
              description: h.description,
              isSecret: h.isSecret || false,
              format: h.format || 'string'
            })
          }
        }
      }
    }
  }

  return {
    id: server.name,
    slug: extractSlug(server.name),
    fullName: server.name,
    title: server.title || extractSlug(server.name),
    description: server.description || '',
    version: server.version || '',
    repository: server.repository?.url || '',
    repositorySource: server.repository?.source || '',
    icons: server.icons || [],
    websiteUrl: server.websiteUrl || '',
    remotes: server.remotes || [],
    packages: server.packages || [],
    transportTypes,
    environmentVariables: envVars,
    status: meta.status || '',
    publishedAt: meta.publishedAt || '',
    updatedAt: meta.updatedAt || '',
    publisherMeta: entry._meta?.['io.modelcontextprotocol.registry/publisher-provided'] || {}
  }
}

export function useMCPRegistry() {
  const servers = ref([])
  const isLoading = ref(false)
  const error = ref(null)
  const nextCursor = ref(null)
  const hasMore = ref(true)
  const searchQuery = ref('')
  const isSearching = ref(false)
  const downloadedSlugs = ref(new Set())

  // 下载队列
  const downloadTasks = ref({}) // { [slug]: 'downloading' | 'done' | 'error' }
  const activeDownloads = computed(() =>
    Object.entries(downloadTasks.value)
      .filter(([, status]) => status === 'downloading')
      .map(([slug]) => slug)
  )

  async function fetchFromRegistry(cursor) {
    let url = REGISTRY_URL
    if (cursor) {
      url += `?cursor=${encodeURIComponent(cursor)}`
    }

    const cached = getCached(url)
    if (cached) return cached

    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
    }

    const data = await res.json()
    setCache(url, data)
    return data
  }

  async function fetchServers(append = false) {
    if (isLoading.value) return

    isLoading.value = true
    error.value = null

    try {
      const args = append && nextCursor.value ? nextCursor.value : undefined
      const data = await fetchFromRegistry(args)

      // 去重只保留 isLatest
      const seen = new Set()
      if (!append) seen.clear()

      const items = (data.servers || [])
        .filter(entry => {
          const meta = entry._meta?.['io.modelcontextprotocol.registry/official']
          return meta?.isLatest !== false
        })
        .map(transformServer)
        .filter(s => {
          if (seen.has(s.fullName)) return false
          seen.add(s.fullName)
          return true
        })

      if (append) {
        servers.value = [...servers.value, ...items]
      } else {
        servers.value = items
      }

      nextCursor.value = data.metadata?.nextCursor || null
      hasMore.value = Boolean(data.metadata?.nextCursor)
    } catch (e) {
      error.value = e.message
    } finally {
      isLoading.value = false
    }
  }

  async function searchServers(query) {
    if (!query || !query.trim()) {
      isSearching.value = false
      await fetchServers(false)
      return
    }

    isLoading.value = true
    error.value = null
    isSearching.value = true

    try {
      // 加载足够多的数据进行客户端过滤
      const allItems = []
      let cursor = null
      // 最多加载 5 页
      for (let i = 0; i < 5; i++) {
        const data = await fetchFromRegistry(cursor)
        const items = (data.servers || [])
          .filter(entry => {
            const meta = entry._meta?.['io.modelcontextprotocol.registry/official']
            return meta?.isLatest !== false
          })
          .map(transformServer)
        allItems.push(...items)
        cursor = data.metadata?.nextCursor
        if (!cursor) break
      }

      const q = query.trim().toLowerCase()
      const seen = new Set()
      const filtered = allItems.filter(s => {
        if (seen.has(s.fullName)) return false
        seen.add(s.fullName)

        return s.fullName.toLowerCase().includes(q) ||
          s.title.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q)
      })

      servers.value = filtered
      hasMore.value = false
      nextCursor.value = null
    } catch (e) {
      error.value = e.message
    } finally {
      isLoading.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || isLoading.value || isSearching.value) return
    await fetchServers(true)
  }

  function handleSearch() {
    const q = searchQuery.value.trim()
    if (!q) {
      isSearching.value = false
      fetchServers(false)
    } else {
      searchServers(q)
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    isSearching.value = false
    nextCursor.value = null
    hasMore.value = true
    fetchServers(false)
  }

  async function refresh() {
    searchQuery.value = ''
    isSearching.value = false
    nextCursor.value = null
    hasMore.value = true
    cache.clear()
    await fetchServers(false)
  }

  async function checkDownloadedMcps() {
    try {
      const result = await window.electronAPI.listDownloadedMcps()
      if (result.success) {
        downloadedSlugs.value = new Set(result.mcps.map(m => m.slug))
      }
    } catch (e) { /* ignore */ }
  }

  function getDownloadStatus(slug) {
    if (downloadTasks.value[slug] === 'downloading') return 'downloading'
    if (downloadedSlugs.value.has(slug)) return 'downloaded'
    return null
  }

  async function downloadMcp(server) {
    const slug = server.slug || extractSlug(server.fullName || server.name)
    if (downloadTasks.value[slug] === 'downloading') return

    downloadTasks.value[slug] = 'downloading'

    try {
      const payload = JSON.parse(JSON.stringify(toRaw(server)))
      // 确保 main.cjs 能用 server.name 提取 slug
      if (!payload.name) payload.name = payload.fullName || payload.id
      const result = await window.electronAPI.downloadMcp({ server: payload })
      if (result.success) {
        downloadTasks.value[slug] = 'done'
        downloadedSlugs.value.add(slug)
      } else {
        downloadTasks.value[slug] = 'error'
        throw new Error(result.error || 'Download failed')
      }
    } catch (e) {
      downloadTasks.value[slug] = 'error'
      throw e
    }
  }

  return {
    servers,
    isLoading,
    error,
    hasMore,
    searchQuery,
    isSearching,
    fetchServers,
    searchServers,
    loadMore,
    refresh,
    handleSearch,
    clearSearch,
    checkDownloadedMcps,
    getDownloadStatus,
    downloadMcp,
    activeDownloads,
    downloadedSlugs
  }
}
