# 存储系统设计文档

## 1. 概述

存储系统负责管理 CCGUI 的所有持久化数据,包括应用配置、项目配置、会话配置和聊天历史。

## 2. 目录结构

```
~/.ccgui/
├── app.json                    # 全局应用配置
└── projects/
    └── {encodedProjectName}/   # 项目目录名使用编码后的名称
        ├── project.json        # 项目配置
        └── sessions/
            └── {sessionId}/
                ├── session.json    # session配置
                └── history/        # 聊天历史
                    ├── messages.jsonl  # 消息记录(兼容.claude格式)
                    └── metadata.json   # 元数据(消息数、最后更新时间等)
```

## 3. 数据结构

### 3.1 app.json
```json
{
  "version": "1.0.0",
  "lastOpenedProjects": ["project-id-1", "project-id-2"],
  "windowStates": {},
  "settings": {
    "theme": "light",
    "language": "zh-CN"
  }
}
```

### 3.2 project.json
```json
{
  "id": "encoded-project-id",
  "name": "项目名称",
  "path": "/path/to/project",
  "createdAt": "2026-03-09T00:00:00.000Z",
  "updatedAt": "2026-03-09T00:00:00.000Z",
  "settings": {}
}
```

### 3.3 session.json
```json
{
  "id": "session-uuid",
  "projectId": "encoded-project-id",
  "name": "会话名称",
  "createdAt": "2026-03-09T00:00:00.000Z",
  "updatedAt": "2026-03-09T00:00:00.000Z",
  "messageCount": 10,
  "settings": {}
}
```

### 3.4 history/messages.jsonl
```
每行一个JSON对象,存储完整的消息数据(包括role, content, timestamp等)
格式与 .claude 的 jsonl 文件兼容
```

### 3.5 history/metadata.json
```json
{
  "messageCount": 10,
  "lastMessageAt": "2026-03-09T00:00:00.000Z",
  "totalTokens": {
    "input": 1000,
    "output": 500
  }
}
```

## 4. 核心模块

### 4.1 StorageManager (主控制器)
- 初始化存储目录
- 协调各个子模块
- 提供统一的 API

### 4.2 AppConfigManager
- 管理 app.json
- 读写应用配置

### 4.3 ProjectConfigManager
- 管理项目配置
- 项目目录的创建/删除/重命名

### 4.4 SessionConfigManager
- 管理 session 配置
- session 的创建/删除/更新

### 4.5 HistoryManager
- 管理聊天历史
- 消息的存储和加载
- 历史同步

### 4.6 SyncManager
- 与 .claude 目录同步
- 检测删除的项目和会话
- 双向同步策略

## 5. 同步策略

### 5.1 启动时同步
1. 扫描 ~/.claude/projects 获取所有项目和会话
2. 对比 ~/.ccgui/projects 中的项目
3. 删除 .claude 中不存在的项目和会话
4. 保留 .claude 中存在但 CCGUI 中不存在的(可能是新创建的)

### 5.2 加载优先级
1. 加载会话历史时,优先从 ~/.ccgui 加载
2. 如果 CCGUI 中没有,再从 ~/.claude 加载
3. 首次加载后保存到 CCGUI 中

### 5.3 实时同步
- 每次消息更新时,同时写入 CCGUI 和 .claude
- 确保 .claude 的兼容性

## 6. IPC 接口

### 6.1 应用配置
- `get-app-config` - 获取应用配置
- `update-app-config` - 更新应用配置

### 6.2 项目管理
- `get-projects` - 获取所有项目(已存在)
- `add-project` - 添加项目(已存在)
- `remove-project` - 删除项目(已存在,需要更新)
- `rename-project` - 重命名项目(已存在,需要更新)

### 6.3 会话管理
- `get-sessions` - 获取项目的所有会话(已存在)
- `create-session` - 创建会话(已存在,需要更新)
- `delete-session` - 删除会话(已存在,需要更新)
- `rename-session` - 重命名会话(已存在,需要更新)

### 6.4 历史管理
- `save-session-history` - 保存会话历史
- `load-session-history` - 加载会话历史
- `get-session-metadata` - 获取会话元数据

### 6.5 同步
- `sync-with-claude` - 手动触发同步

## 7. 错误处理

- 文件读写错误
- JSON 解析错误
- 目录权限问题
- 磁盘空间不足

## 8. 性能优化

- 懒加载会话历史
- 增量写入消息
- 缓存常用配置
- 批量操作优化
