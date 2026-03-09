# 开发文档目录

本目录包含开发过程中产生的**长期技术文档**。

## 📂 目录结构

```
devDocs/
├── storage/          # 存储系统文档（长期）
│   ├── api-reference.md       # API 接口文档
│   ├── architecture.md        # 系统架构设计
│   ├── quick-reference.md     # 快速参考指南
│   └── sync-implementation.md # 同步机制实现
└── tmp/              # 临时文档（阶段性，用后可删除）
    ├── STORAGE_MANAGER_API.md
    ├── STORAGE_MANAGER_QUICK_REF.md
    ├── STORAGE_MANAGER_SUMMARY.md
    ├── STORAGE_COMPLETE.md
    ├── implementation-report.md
    └── CLEANUP_REPORT.md
```

## 📋 文档管理规范

### 1. 目录职责

| 目录 | 用途 | 生命周期 | 说明 |
|------|------|----------|------|
| `devDocs/` | 长期技术文档 | 永久保留 | 架构设计、API 文档、技术方案等 |
| `devDocs/tmp/` | 临时性文档 | 用后可删除 | 阶段性报告、中间产物、调试记录等 |
| `docs/` | 用户文档 | 永久保留 | **仅在用户明确要求时创建** |

### 2. 文档分类规则

**长期文档（放在 devDocs/ 对应子目录）**
- ✅ 系统架构设计
- ✅ API 接口文档
- ✅ 技术方案说明
- ✅ 长期有用的参考资料
- ✅ 开发规范和最佳实践

**临时文档（放在 devDocs/tmp/）**
- 📝 阶段性实现报告
- 📝 完成进度记录
- 📝 调试过程记录
- 📝 重复或过时的文档
- 📝 中间产物文档

**用户文档（放在 docs/）**
- 📖 **仅在用户明确要求时创建**
- 📖 用户使用手册
- 📖 功能说明文档
- 📖 公开 API 文档

### 3. 清理建议

- ✅ 定期检查 `devDocs/tmp/`，删除不再需要的临时文档
- ✅ 重复的文档只保留最完善的版本
- ✅ 过时的文档及时归档或删除
- ✅ 保持 `devDocs/` 根目录简洁

## 📌 当前模块

### storage - 存储系统

长期文档：
- [架构设计](storage/architecture.md) - 存储系统整体架构
- [API 参考](storage/api-reference.md) - 存储系统 API 文档
- [快速参考](storage/quick-reference.md) - 常用操作快速参考
- [同步实现](storage/sync-implementation.md) - 与 .claude 的同步机制

临时文档：
- 见 [tmp/](tmp/) 目录

## ⚠️ 重要提示

1. **不要随意在 `docs/` 创建文档** - 仅在用户明确要求时才创建
2. **临时文档放在 `tmp/`** - 开发过程中的阶段性文档统一放这里
3. **长期文档要精选** - 只保留真正有用的长期文档
4. **定期清理** - `tmp/` 目录可以随时删除，不影响系统功能
