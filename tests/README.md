# 测试文件目录

本目录包含所有测试相关的文件和示例代码。

## 目录结构

```
tests/
├── storage/                    # 存储系统测试
│   └── test-session-history.js
├── examples/                   # 示例代码
│   ├── integration-example.js  # 存储系统集成示例
│   └── sync-manager-usage.js   # 同步管理器使用示例
├── test-app.js                 # 应用测试
└── minimal-test.cjs            # 最小化测试
```

## 文件说明

### 测试文件
- `storage/` - 存储系统单元测试
- `test-app.js` - 应用功能测试
- `minimal-test.cjs` - 最小化测试用例

### 示例代码
- `examples/integration-example.js` - 演示如何集成存储系统
- `examples/sync-manager-usage.js` - 演示同步管理器的使用方法

## 运行测试

```bash
# 运行存储系统测试
node tests/storage/test-session-history.js

# 运行应用测试
node tests/test-app.js

# 查看示例代码
cat tests/examples/integration-example.js
cat tests/examples/sync-manager-usage.js
```
