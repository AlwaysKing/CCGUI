# Claude Code 参数文档更新日志

## 版本 2.0 - 2026-03-09

### 更新方法

使用 `claude --help` 命令直接获取最新的 CLI 参数列表，确保文档的准确性和完整性。

### 新增启动参数

#### 代理相关
- **`--agents <json>`** - 定义自定义代理的 JSON 对象
- **`--agent <agent>`** - 指定当前会话使用的代理

#### 浏览器集成
- **`--chrome`** - 启用 Claude in Chrome 集成
- **`--no-chrome`** - 禁用 Claude in Chrome 集成

#### 功能控制
- **`--disable-slash-commands`** - 禁用所有技能（skills）
- **`--ide`** - 启动时自动连接到 IDE

#### 文件操作
- **`--file <specs...>`** - 启动时下载文件资源（格式：`file_id:relative_path`）

#### Git 集成
- **`--worktree [name]` / `-w`** - 为会话创建新的 git worktree
- **`--tmux`** - 为 worktree 创建 tmux 会话（需配合 `--worktree`）
- **`--from-pr [value]`** - 恢复与 PR 关联的会话

#### 输入输出
- **`--replay-user-messages`** - 重新发送用户消息并在 stdout 确认
- **`--system-prompt <prompt>`** - 完全替换系统提示（区别于 `--append-system-prompt`）

### 新增 CLI 命令

#### 管理命令
- **`claude agents`** - 列出配置的代理
- **`claude auth`** - 管理认证
- **`claude doctor`** - 检查自动更新器健康状态
- **`claude install [target]`** - 安装原生构建（支持 stable/latest/特定版本）
- **`claude mcp`** - 配置和管理 MCP 服务器
- **`claude plugin`** - 管理插件
- **`claude setup-token`** - 设置长期认证令牌
- **`claude update` / `claude upgrade`** - 检查并安装更新

### 更新的参数

#### --output-format
新增选项：
- `text` - 文本格式（默认）
- `json` - 单个 JSON 结果
- `stream-json` - 流式 JSON 格式

**注意**: 现在需要与 `--print` / `-p` 一起使用

#### --input-format
新增选项：
- `text` - 文本格式（默认）
- `stream-json` - 流式 JSON 格式

**注意**: 现在需要与 `--print` / `-p` 一起使用

#### --permission-mode
新增选项：
- `dontAsk` - 不询问模式（自动执行）
- `auto` - 自动模式（智能决策）

原有选项：
- `default` - 默认模式
- `acceptEdits` - 自动接受编辑
- `plan` - 计划模式
- `bypassPermissions` - 跳过权限检查

### 新增使用场景

1. **Git Worktree 隔离开发** - 使用 `--worktree` 和 `--tmux` 创建隔离环境
2. **IDE 集成模式** - 使用 `--ide` 自动连接 IDE
3. **PR 审查会话** - 使用 `--from-pr` 快速恢复 PR 相关会话
4. **自定义代理模式** - 使用 `--agents` 定义和 `--agent` 选择代理
5. **Chrome 集成模式** - 使用 `--chrome` 启用浏览器集成
6. **文件资源下载** - 使用 `--file` 在启动时下载资源

### 文档改进

- 更新了所有参数的格式说明
- 添加了更多实际使用示例
- 增强了参数之间的关联说明
- 补充了安全警告和最佳实践

### 参数统计

- **总参数数量**: 60+
- **新增参数**: 13 个
- **新增命令**: 8 个
- **更新参数**: 3 个

### 下一步计划

1. 持续跟踪 Claude Code 更新，及时添加新参数
2. 补充更多实际使用案例和最佳实践
3. 添加参数组合的推荐配置
4. 完善故障排除章节

## 参考资料

- Claude Code 官方文档: https://code.claude.com/docs
- CLI 帮助命令: `claude --help`
- 命令帮助: `claude [command] --help`
