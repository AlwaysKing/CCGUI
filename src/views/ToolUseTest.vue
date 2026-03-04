<script setup>
import { ref } from 'vue'
import ToolUseMessage from '../components/ToolUseMessage.vue'

const workingDirectory = '/Users/alwaysking/AKProject/CCGUI'

// 测试数据
const testTools = ref([
  // Read 工具
  {
    id: 1,
    toolName: 'Read',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/components/ToolUseMessage.vue'
    },
    result: '文件内容已读取...',
    collapsed: false
  },
  {
    id: 2,
    toolName: 'Read',
    toolInput: {
      file_path: '/Users/alwaysking/Desktop/xxx/xxx.txt'
    },
    result: '外部文件内容...',
    collapsed: false
  },

  // Edit 工具 - 替换
  {
    id: 3,
    toolName: 'Edit',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/App.vue',
      old_string: 'const oldCode = "hello"',
      new_string: 'const newCode = "world"'
    },
    result: '已成功替换',
    collapsed: false
  },
  // Edit 工具 - 新增
  {
    id: 4,
    toolName: 'Edit',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/main.js',
      old_string: '',
      new_string: '这是在文件末尾添加的测试文字'
    },
    result: '已成功添加',
    collapsed: false
  },
  // Edit 工具 - 删除
  {
    id: 5,
    toolName: 'Edit',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/utils/helper.js',
      old_string: '要删除的内容',
      new_string: ''
    },
    result: '已成功删除',
    collapsed: false
  },
  // Edit 多行替换
  {
    id: 6,
    toolName: 'Edit',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/components/Test.vue',
      old_string: 'function hello() {\n  console.log("hello")\n  return true\n}',
      new_string: 'function world() {\n  console.log("world")\n  return false\n}'
    },
    result: '已成功替换多行内容',
    collapsed: false
  },

  // Write 工具
  {
    id: 7,
    toolName: 'Write',
    toolInput: {
      file_path: '/Users/alwaysking/AKProject/CCGUI/src/new-file.js',
      content: '// 这是一个测试文件\nexport function hello() {\n  console.log("Hello World")\n  return true\n}\n\nexport const config = {\n  name: "test",\n  version: "1.0.0",\n  debug: true\n}\n\n// 工具函数\nexport function formatDate(date) {\n  return date.toLocaleDateString()\n}'
    },
    result: '文件已写入成功',
    collapsed: false
  },

  // Bash 工具
  {
    id: 8,
    toolName: 'Bash',
    toolInput: {
      command: 'npm run dev',
      description: '启动开发服务器',
      run_in_background: true
    },
    result: '服务器已启动在 http://localhost:5173',
    collapsed: false
  },
  {
    id: 9,
    toolName: 'Bash',
    toolInput: {
      command: 'git status && git diff HEAD~1',
      description: '查看 git 状态和最近的更改',
      timeout: 30000
    },
    result: 'On branch main\nChanges not staged for commit...',
    collapsed: false
  },

  // Agent 工具
  {
    id: 10,
    toolName: 'Agent',
    toolInput: {
      subagent_type: 'Explore',
      description: '探索代码库结构',
      prompt: '请帮我分析这个项目的目录结构，找出主要的组件和工具文件'
    },
    result: '分析完成...',
    collapsed: false
  },
  {
    id: 11,
    toolName: 'Agent',
    toolInput: {
      subagent_type: 'Plan',
      description: '规划实现方案'
    },
    result: '规划完成...',
    collapsed: false
  },

  // WebSearch 工具
  {
    id: 12,
    toolName: 'WebSearch',
    toolInput: {
      query: 'Vue 3 composition API best practices 2024'
    },
    result: '搜索结果...',
    collapsed: false
  },
  {
    id: 13,
    toolName: 'WebSearch',
    toolInput: {
      query: 'TypeScript generic types tutorial',
      allowed_domains: ['typescriptlang.org', 'github.com']
    },
    result: '搜索结果...',
    collapsed: false
  },
  {
    id: 14,
    toolName: 'WebSearch',
    toolInput: {
      query: 'JavaScript async await examples',
      blocked_domains: ['w3schools.com']
    },
    result: '搜索结果...',
    collapsed: false
  },

  // Grep 工具
  {
    id: 15,
    toolName: 'Grep',
    toolInput: {
      pattern: 'defineComponent',
      path: '/Users/alwaysking/AKProject/CCGUI/src',
      type: 'js'
    },
    result: '找到 15 个匹配...',
    collapsed: false
  },
  {
    id: 16,
    toolName: 'Grep',
    toolInput: {
      pattern: 'TODO|FIXME',
      path: '/Users/alwaysking/AKProject/CCGUI/src',
      '-i': true,
      '-C': 3,
      head_limit: 50
    },
    result: '找到 5 个匹配...',
    collapsed: false
  },
  {
    id: 17,
    toolName: 'Grep',
    toolInput: {
      pattern: 'class=".*"',
      glob: '*.vue'
    },
    result: '找到 100 个匹配...',
    collapsed: false
  },

  // Skill 工具
  {
    id: 18,
    toolName: 'Skill',
    toolInput: {
      skill: 'commit',
      args: '-m "feat: add new component"'
    },
    result: '提交成功',
    collapsed: false
  },
  {
    id: 19,
    toolName: 'Skill',
    toolInput: {
      skill: 'review-pr',
      args: '123'
    },
    result: 'PR 审核完成',
    collapsed: false
  },

  // TodoWrite 工具
  {
    id: 20,
    toolName: 'TodoWrite',
    toolInput: {
      todos: [
        { content: '分析项目结构', status: 'completed', activeForm: '分析项目结构中' },
        { content: '设计组件架构', status: 'completed', activeForm: '设计组件架构中' },
        { content: '实现 ToolUseMessage 组件', status: 'in_progress', activeForm: '实现 ToolUseMessage 组件中' },
        { content: '添加单元测试', status: 'pending', activeForm: '添加单元测试中' },
        { content: '更新文档', status: 'pending', activeForm: '更新文档中' }
      ]
    },
    result: '',
    collapsed: false
  },

  // Glob 工具
  {
    id: 21,
    toolName: 'Glob',
    toolInput: {
      pattern: '**/*.vue',
      path: '/Users/alwaysking/AKProject/CCGUI/src'
    },
    result: '找到 25 个文件...',
    collapsed: false
  }
])

const toggleCollapse = (tool) => {
  tool.collapsed = !tool.collapsed
}

const toggleAll = (collapsed) => {
  testTools.value.forEach(tool => {
    tool.collapsed = collapsed
  })
}
</script>

<template>
  <div class="test-page">
    <div class="test-header">
      <h1>ToolUse 消息样式测试</h1>
      <div class="test-controls">
        <button @click="toggleAll(false)">全部展开</button>
        <button @click="toggleAll(true)">全部折叠</button>
      </div>
    </div>

    <div class="test-content">
      <div v-for="tool in testTools" :key="tool.id" class="test-item">
        <ToolUseMessage
          :tool-name="tool.toolName"
          :tool-input="tool.toolInput"
          :result="tool.result"
          :is-error="tool.isError"
          :is-executing="tool.isExecuting"
          :collapsed="tool.collapsed"
          :working-directory="workingDirectory"
          @toggle-collapse="toggleCollapse(tool)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.test-page {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
  background: #0D1117;
  height: 100%;
  overflow-y: auto;
}

.test-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 30px;
  padding-bottom: 20px;
  border-bottom: 1px solid #30363D;
}

.test-header h1 {
  color: #F8FAFC;
  font-size: 24px;
  margin: 0;
}

.test-controls {
  display: flex;
  gap: 10px;
}

.test-controls button {
  padding: 8px 16px;
  border-radius: 6px;
  border: 1px solid #30363D;
  background: #161B22;
  color: #94A3B8;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.test-controls button:hover {
  background: #21262D;
  color: #F8FAFC;
  border-color: #58A6FF;
}

.test-item {
  margin-bottom: 16px;
}
</style>
