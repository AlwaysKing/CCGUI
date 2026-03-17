import { ref } from 'vue'

export function useSettingsNavigation() {
  const activeSection = ref('model')
  const contentRef = ref(null)
  const modelSectionRef = ref(null)
  const promptSectionRef = ref(null)
  const softwareSectionRef = ref(null)

  const navItems = [
    { id: 'model', label: '模型配置', icon: 'model' },
    { id: 'prompt', label: '提示词配置', icon: 'prompt' },
    { id: 'software', label: '软件配置', icon: 'software' }
  ]

  function scrollToSection(sectionId) {
    activeSection.value = sectionId
    const sectionMap = {
      model: modelSectionRef.value,
      prompt: promptSectionRef.value,
      software: softwareSectionRef.value
    }

    const targetSection = sectionMap[sectionId]
    if (targetSection && contentRef.value) {
      const container = contentRef.value
      const targetOffsetTop = targetSection.offsetTop - container.offsetTop
      container.scrollTo({ top: targetOffsetTop, behavior: 'smooth' })
    }
  }

  function handleScroll() {
    if (!contentRef.value) return

    const container = contentRef.value
    const scrollTop = container.scrollTop
    const sections = [
      { id: 'model', ref: modelSectionRef.value },
      { id: 'prompt', ref: promptSectionRef.value },
      { id: 'software', ref: softwareSectionRef.value }
    ]

    for (const section of sections) {
      if (!section.ref) continue

      const offsetTop = section.ref.offsetTop - container.offsetTop
      const offsetBottom = offsetTop + section.ref.offsetHeight

      if (scrollTop >= offsetTop - 10 && scrollTop < offsetBottom - 10) {
        activeSection.value = section.id
        break
      }
    }
  }

  function bindScrollListener() {
    contentRef.value?.addEventListener('scroll', handleScroll)
  }

  function unbindScrollListener() {
    contentRef.value?.removeEventListener('scroll', handleScroll)
  }

  return {
    activeSection,
    contentRef,
    modelSectionRef,
    promptSectionRef,
    softwareSectionRef,
    navItems,
    scrollToSection,
    bindScrollListener,
    unbindScrollListener
  }
}
