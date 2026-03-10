/**
 * 文档管理器
 * 管理 ~/.ccgui/docs 目录下的 markdown 文件
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

/**
 * 获取文档目录路径
 */
function getDocsDir() {
  return path.join(os.homedir(), '.ccgui', 'docs')
}

/**
 * 确保文档目录存在
 */
function ensureDocsDir() {
  const docsDir = getDocsDir()
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true })
    logger.info('[DocsManager] Created docs directory', { path: docsDir })
  }
  return docsDir
}

/**
 * 获取所有文档列表
 * @returns {Array} 文档列表，包含 id, name, summary
 */
function listDocs() {
  try {
    const docsDir = getDocsDir()

    // 如果目录不存在，返回空数组（不自动创建）
    if (!fs.existsSync(docsDir)) {
      logger.info('[DocsManager] Docs directory does not exist, returning empty list')
      return []
    }

    const files = fs.readdirSync(docsDir)
    const docs = []

    for (const file of files) {
      if (file.endsWith('.md')) {
        const filePath = path.join(docsDir, file)
        const content = fs.readFileSync(filePath, 'utf-8')
        const name = file.replace(/\.md$/, '')
        const summary = generateSummary(content)

        docs.push({
          id: name,
          name,
          summary,
          content
        })
      }
    }

    logger.info('[DocsManager] Listed docs', { count: docs.length })
    return docs
  } catch (error) {
    logger.error('[DocsManager] Failed to list docs', { error: error.message })
    return []
  }
}

/**
 * 生成文档摘要
 * @param {string} content - 文档内容
 * @returns {string} 摘要（去掉换行，最多3行）
 */
function generateSummary(content) {
  // 去掉换行符
  const singleLine = content.replace(/[\r\n]+/g, ' ').trim()
  // 限制长度（大约3行，假设每行80字符）
  const maxLength = 240
  if (singleLine.length > maxLength) {
    return singleLine.substring(0, maxLength) + '...'
  }
  return singleLine
}

/**
 * 获取单个文档
 * @param {string} docId - 文档ID（文件名不含后缀）
 * @returns {object|null} 文档对象
 */
function getDoc(docId) {
  try {
    const docsDir = getDocsDir()
    const filePath = path.join(docsDir, `${docId}.md`)

    if (!fs.existsSync(filePath)) {
      return null
    }

    const content = fs.readFileSync(filePath, 'utf-8')
    const summary = generateSummary(content)

    return {
      id: docId,
      name: docId,
      summary,
      content
    }
  } catch (error) {
    logger.error('[DocsManager] Failed to get doc', { docId, error: error.message })
    return null
  }
}

/**
 * 保存文档
 * @param {string} docId - 文档ID（文件名不含后缀）
 * @param {string} content - 文档内容
 * @returns {boolean} 是否成功
 */
function saveDoc(docId, content) {
  try {
    ensureDocsDir()
    const docsDir = getDocsDir()
    const filePath = path.join(docsDir, `${docId}.md`)

    fs.writeFileSync(filePath, content, 'utf-8')
    logger.info('[DocsManager] Saved doc', { docId })
    return true
  } catch (error) {
    logger.error('[DocsManager] Failed to save doc', { docId, error: error.message })
    return false
  }
}

/**
 * 重命名文档
 * @param {string} oldId - 旧文档ID
 * @param {string} newId - 新文档ID
 * @returns {boolean} 是否成功
 */
function renameDoc(oldId, newId) {
  try {
    const docsDir = getDocsDir()
    const oldPath = path.join(docsDir, `${oldId}.md`)
    const newPath = path.join(docsDir, `${newId}.md`)

    if (!fs.existsSync(oldPath)) {
      logger.error('[DocsManager] Old doc not found', { oldId })
      return false
    }

    fs.renameSync(oldPath, newPath)
    logger.info('[DocsManager] Renamed doc', { oldId, newId })
    return true
  } catch (error) {
    logger.error('[DocsManager] Failed to rename doc', { oldId, newId, error: error.message })
    return false
  }
}

/**
 * 删除文档
 * @param {string} docId - 文档ID
 * @returns {boolean} 是否成功
 */
function deleteDoc(docId) {
  try {
    const docsDir = getDocsDir()
    const filePath = path.join(docsDir, `${docId}.md`)

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      logger.info('[DocsManager] Deleted doc', { docId })
    }
    return true
  } catch (error) {
    logger.error('[DocsManager] Failed to delete doc', { docId, error: error.message })
    return false
  }
}

module.exports = {
  getDocsDir,
  ensureDocsDir,
  listDocs,
  getDoc,
  saveDoc,
  renameDoc,
  deleteDoc
}
