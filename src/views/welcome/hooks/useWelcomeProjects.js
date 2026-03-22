import { computed, ref } from 'vue'
import { formatProjectLastActive, isRecentProject } from '../utils/projectTime'

export function useWelcomeProjects(store) {
  const searchQuery = ref('')
  const showSettingsDialog = ref(false)
  const showOldProjects = ref(false)
  const showMissingProjects = ref(false)
  const projectExistsMap = ref({})
  const showDeleteConfirm = ref(false)
  const projectToDelete = ref(null)
  const deleteProjectFolder = ref(false)
  const isClearingMissing = ref(false)

  const categorizedProjects = computed(() => {
    const filteredProjects = searchQuery.value
      ? store.projects.filter(project =>
          project.name.toLowerCase().includes(searchQuery.value.toLowerCase())
        )
      : store.projects

    const recent = []
    const old = []
    const missing = []

    filteredProjects.forEach(project => {
      const exists = projectExistsMap.value[project.id] !== false

      if (!exists) {
        missing.push(project)
      } else if (isRecentProject(project)) {
        recent.push(project)
      } else {
        old.push(project)
      }
    })

    return { recent, old, missing }
  })

  const categoryCounts = computed(() => ({
    recent: categorizedProjects.value.recent.length,
    old: categorizedProjects.value.old.length,
    missing: categorizedProjects.value.missing.length
  }))

  function selectProject(project) {
    store.selectProject(project)
  }

  function handleDeleteClick(event, project) {
    event.stopPropagation()
    projectToDelete.value = project
    showDeleteConfirm.value = true
  }

  function cancelDelete() {
    showDeleteConfirm.value = false
    projectToDelete.value = null
    deleteProjectFolder.value = false
  }

  async function confirmDeleteProject() {
    if (!projectToDelete.value) return

    try {
      await store.removeProject(projectToDelete.value.id, deleteProjectFolder.value)
      cancelDelete()
    } catch (error) {
      console.error('Failed to delete project:', error)
      alert('删除项目失败: ' + error.message)
    }
  }

  async function checkProjectsExistence() {
    for (const project of store.projects) {
      try {
        const result = await window.electronAPI.checkProjectExists({ projectPath: project.path })
        projectExistsMap.value[project.id] = result.exists
      } catch (error) {
        console.error(`Failed to check project ${project.id}:`, error)
        projectExistsMap.value[project.id] = true
      }
    }
  }

  async function clearMissingProjects() {
    if (isClearingMissing.value) return

    isClearingMissing.value = true
    try {
      const missingProjects = categorizedProjects.value.missing
      for (const project of missingProjects) {
        await store.removeProject(project.id, false)
      }
    } catch (error) {
      console.error('Failed to clear missing projects:', error)
      alert('清理不存在的项目失败: ' + error.message)
    } finally {
      isClearingMissing.value = false
    }
  }

  return {
    searchQuery,
    showSettingsDialog,
    showOldProjects,
    showMissingProjects,
    projectExistsMap,
    showDeleteConfirm,
    projectToDelete,
    deleteProjectFolder,
    isClearingMissing,
    categorizedProjects,
    categoryCounts,
    selectProject,
    handleDeleteClick,
    cancelDelete,
    confirmDeleteProject,
    checkProjectsExistence,
    clearMissingProjects,
    formatLastActive: formatProjectLastActive
  }
}
