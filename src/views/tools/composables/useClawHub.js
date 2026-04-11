import { ref, computed } from 'vue'

const CONVEX_URL = 'https://wry-manatee-359.convex.cloud/api/query'

const cache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 分钟

function getCacheKey(path, args) {
  return `${path}:${JSON.stringify(args)}`
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

async function convexQuery(path, args) {
  const cacheKey = getCacheKey(path, args)
  const cached = getCached(cacheKey)
  if (cached) return cached

  const res = await fetch(CONVEX_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Convex-Client': 'npm-1.34.1'
    },
    body: JSON.stringify({
      path,
      args: [args]
    })
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`)
  }

  const data = await res.json()
  if (data.status === 'error') {
    throw new Error(data.errorMessage || 'Convex query failed')
  }

  setCache(cacheKey, data.value)
  return data.value
}

function transformSkill(item) {
  const skill = item.skill || {}
  const owner = item.owner || {}
  const latestVersion = item.latestVersion || {}
  const stats = skill.stats || {}

  return {
    id: skill._id,
    slug: skill.slug,
    displayName: skill.displayName || skill.slug,
    summary: skill.summary || '',
    version: latestVersion.version || '',
    changelog: latestVersion.changelog || '',
    owner: {
      handle: owner.handle || owner.displayName || '',
      image: owner.image || ''
    },
    stats: {
      stars: Math.round(stats.stars || 0),
      downloads: Math.round(stats.downloads || 0),
      installs: Math.round(stats.installsAllTime || 0),
      versions: Math.round(stats.versions || 0)
    },
    highlighted: skill.badges?.highlighted || false,
    capabilityTags: skill.capabilityTags || [],
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt
  }
}

export function useClawHub() {
  const skills = ref([])
  const isLoading = ref(false)
  const error = ref(null)
  const nextCursor = ref(null)
  const hasMore = ref(true)
  const searchQuery = ref('')
  const isSearching = ref(false)

  // 下载状态
  const downloadTasks = ref({}) // { [slug]: 'downloading' | 'done' | 'error' }
  const downloadedSlugs = ref(new Set())

  const activeDownloads = computed(() =>
    Object.entries(downloadTasks.value)
      .filter(([, status]) => status === 'downloading')
      .map(([slug]) => slug)
  )

  function getDownloadStatus(slug) {
    if (downloadTasks.value[slug] === 'downloading') return 'downloading'
    if (downloadedSlugs.value.has(slug)) return 'downloaded'
    return null
  }

  async function checkDownloadedSkills() {
    try {
      const result = await window.electronAPI.listDownloadedSkills()
      if (result.success) {
        downloadedSlugs.value = new Set(result.skills.map(s => typeof s === 'string' ? s : s.slug))
      }
    } catch (e) { /* ignore */ }
  }

  async function downloadSkill(slug) {
    if (downloadTasks.value[slug] === 'downloading') return

    downloadTasks.value[slug] = 'downloading'

    try {
      const result = await window.electronAPI.downloadSkill({ slug })
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

  async function fetchSkills(append = false) {
    if (isLoading.value) return

    isLoading.value = true
    error.value = null

    try {
      const args = {
        numItems: 25,
        sort: 'downloads',
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: false
      }

      if (append && nextCursor.value) {
        args.cursor = nextCursor.value
      }

      const data = await convexQuery('skills:listPublicPageV4', args)
      const items = (data.page || []).map(transformSkill)

      if (append) {
        skills.value = [...skills.value, ...items]
      } else {
        skills.value = items
      }

      nextCursor.value = data.nextCursor || null
      hasMore.value = Boolean(data.hasMore && data.nextCursor)
    } catch (e) {
      error.value = e.message
    } finally {
      isLoading.value = false
    }
  }

  async function searchSkills(query) {
    if (!query || !query.trim()) {
      isSearching.value = false
      await fetchSkills(false)
      return
    }

    isLoading.value = true
    error.value = null
    isSearching.value = true

    try {
      const data = await convexQuery('skills:listPublicPageV4', {
        numItems: 50,
        sort: 'downloads',
        dir: 'desc',
        highlightedOnly: false,
        nonSuspiciousOnly: false
      })

      const q = query.trim().toLowerCase()
      const allItems = (data.page || []).map(transformSkill)
      const filtered = allItems.filter(
        (s) =>
          s.slug.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q)
      )

      skills.value = filtered
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
    await fetchSkills(true)
  }

  function handleSearch() {
    const q = searchQuery.value.trim()
    if (!q) {
      isSearching.value = false
      fetchSkills(false)
    } else {
      searchSkills(q)
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    isSearching.value = false
    nextCursor.value = null
    hasMore.value = true
    fetchSkills(false)
  }

  async function refresh() {
    searchQuery.value = ''
    isSearching.value = false
    nextCursor.value = null
    hasMore.value = true
    await fetchSkills(false)
  }

  function formatCount(num) {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return String(num)
  }

  return {
    skills,
    isLoading,
    error,
    hasMore,
    searchQuery,
    isSearching,
    fetchSkills,
    searchSkills,
    loadMore,
    refresh,
    handleSearch,
    clearSearch,
    formatCount,
    downloadSkill,
    getDownloadStatus,
    activeDownloads,
    downloadedSlugs,
    checkDownloadedSkills
  }
}
