# Vue 项目架构与组件划分通用指南 (Standard Operating Procedure)

## 1. 核心分层逻辑

项目采用 **“三级递进式”** 结构，根据组件的**复用频率**与**路由关联性**进行物理隔离。

### 第一层：页面入口 (Views / Pages)

* **存放路径**：`src/views/[ModuleName]/[ModuleName].vue`
* **定义**：直接与路由（Router）配置关联的顶层容器。
* **职责**：
* **数据聚合**：负责调用 API 或从 Store（Pinia/Vuex）获取原始数据。
* **状态分发**：通过 `props` 将数据向下传递给子组件。
* **事件监听**：通过 `emits` 监听子组件反馈，处理最终业务闭环。
* **页面布局**：决定子组件在页面上的排列位置。



### 第二层：局部业务组件 (View-Specific Components)

* **存放路径**：`src/views/[ModuleName]/components/`
* **定义**：为了拆分主页面代码量而存在的“局部积木”。
* **职责**：
* **逻辑封装**：将页面中复杂的功能块（如表单、列表渲染、特定操作栏）独立出来。
* **高内聚**：仅服务于当前页面，**禁止**被其他模块跨目录引用。
* **私有化**：如果该组件包含多个子零件（如 `Header` 下有 `SearchBar`），可在其目录下进一步嵌套。



### 第三层：全局公共组件 (Global Components)

* **存放路径**：`src/components/`
* **定义**：跨页面使用的通用资产。
* **细分分类**：
* **`base/` (原子层)**：无业务逻辑的 UI 基础组件（如 `AppButton`, `AppInput`, `AppModal`）。通常只负责展示和基础交互。
* **`business/` (业务层)**：带有通用业务逻辑的组件（如 `UserSelector`, `FileUploader`, `DepartmentTree`）。这些组件在多个页面都会用到。



---

## 2. 目录树参考模型

```text
src/
├── components/           # 【全局层】
│   ├── base/             # 基础原子组件 (纯 UI)
│   └── business/         # 跨页面通用的业务组件
├── views/                # 【页面层】
│   └── [ModuleName]/     # 具体的业务模块文件夹
│       ├── index.vue     # 路由入口文件 (View)
│       ├── components/   # 该页面私有的组件 (Partial Components)
│       │   ├── PartA.vue
│       │   └── PartB/    # 复杂局部组件可设文件夹
│       │       └── index.vue
│       ├── hooks/        # 仅限该页面使用的 Composition API
│       └── utils/        # 仅限该页面使用的工具函数
└── assets/               # 静态资源

```

---

## 3. 组件归属决策算法 (Decision Flow)

在创建新文件前，请依次执行以下判断：

1. **它是否对应一个 URL 路径？**
* 是 $\rightarrow$ `src/views/[Name]/[Name].vue`


2. **它是否会在超过两个不同的页面模块中出现？**
* 是 $\rightarrow$ 放入 `src/components/business/`
* 否 $\rightarrow$ 进入下一步


3. **它是否只是为了让主页面（View）的代码更易读而拆分的？**
* 是 $\rightarrow$ 放入 `src/views/[ModuleName]/components/`


4. **它是否完全剥离了业务背景（如：只是一个蓝色按钮）？**
* 是 $\rightarrow$ 放入 `src/components/base/`



---

## 4. 强制性开发约定

* **单一入口制**：`views` 下的每个模块必须由 `[ModuleName].vue` 作为唯一对外接口。
* **单向依赖**：
* `Views` 可以引用 `Global Components` 和自身的 `Local Components`。
* `Local Components` **禁止**引用其他 `View` 目录下的私有组件。


* **重构触发点**：一旦发现 `views/A/components/` 中的某个组件需要被 `views/B` 使用，必须立即将其移动至 `src/components/business/`。
* **命名规范**：文件夹使用 **PascalCase**，局部组件名称应体现其所属模块的前缀（如 `ChatInput.vue` 而非 `Input.vue`），以防编辑器搜索时产生歧义。
