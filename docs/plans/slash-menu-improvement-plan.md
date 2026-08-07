# Slash 菜单整体改进计划

**目标**：重新设计 `/` 命令菜单，提升用户体验和视觉效果

**日期**：2025-08-07

---

## 现状分析

### 当前实现

```typescript
// packages/tui/component/slash-menu.tsx
// 简单的列表渲染，无边框无分组
```

### 问题

| 问题 | 描述 |
|---|---|
| **视觉单一** | 纯文本列表，没有边框/背景/分组 |
| **无分类** | 内置命令和 skill 混在一起 |
| **无快捷操作** | 需要完整输入命令名 |
| **无状态提示** | 不显示当前激活的 skill、模型等状态 |
| **缺少常用操作** | 如快速切换模型、查看历史等 |

### 竞品参考

| 工具 | 菜单样式 |
|---|---|
| **Pi** | 蓝色边框弹窗，分组显示，支持搜索 |
| **Claude Code** | 紧凑列表，带图标和快捷键 |
| **Cursor** | 浮动面板，实时过滤 |

---

## 改进方案

### 1. 视觉重新设计

#### 新布局（蓝色边框弹窗）

```
┌─────────────────────────────────────────────────┐
│  ⚡ 命令面板                              ESC 关闭 │
├─────────────────────────────────────────────────┤
│  📁 会话管理                                        │
│    ▸ /clear     开新会话                           │
│      /compact   压缩对话历史                       │
│      /session   查看会话信息                       │
│                                                  │
│  🤖 模型切换                                        │
│    ▸ /model     当前: deepseek-chat               │
│      /provider  切换 Provider                     │
│                                                  │
│  🛠️ 工具                                           │
│    ▸ /loop      定时执行                           │
│      /tree      会话树导航                         │
│                                                  │
│  ⚡ 已激活技能                                      │
│    ▸ planning   多步任务计划                       │
│      tdd        测试驱动开发                       │
├─────────────────────────────────────────────────┤
│  💡 输入 /cl 匹配 "clear"                         │
└─────────────────────────────────────────────────┘
```

#### 颜色方案

| 元素 | 颜色 |
|---|---|
| 边框 | `primary` (蓝色) |
| 背景 | `backgroundPanel` |
| 分组标题 | `primary` + 粗体 |
| 选中项 | `primary` 高亮 |
| 描述 | `textMuted` |
| 快捷键 | `success` |

---

### 2. 命令分组

```typescript
const SLASH_GROUPS = [
  {
    name: '会话管理',
    icon: '📁',
    commands: [
      { label: '/clear', desc: '开新会话', shortcut: 'Ctrl+N' },
      { label: '/compact', desc: '压缩对话历史' },
      { label: '/session', desc: '查看会话信息' },
      { label: '/fork', desc: '分叉会话' },
      { label: '/clone', desc: '克隆当前会话' },
    ]
  },
  {
    name: '模型切换',
    icon: '🤖',
    commands: [
      { label: '/model', desc: '切换模型', dynamic: true },  // 显示当前模型
      { label: '/provider', desc: '切换 Provider' },
    ]
  },
  {
    name: '工具',
    icon: '🛠️',
    commands: [
      { label: '/loop', desc: '定时执行', usage: '/loop <间隔> <提示词>' },
      { label: '/tree', desc: '会话树导航' },
    ]
  },
  {
    name: '已激活技能',
    icon: '⚡',
    dynamic: true,  // 根据当前激活的 skill 动态显示
  }
]
```

---

### 3. 交互改进

#### 3.1 键盘快捷键

| 按键 | 功能 |
|---|---|
| `↑` / `↓` | 选择命令 |
| `Tab` | 填入选中命令 |
| `Enter` | 执行选中命令 |
| `ESC` | 关闭菜单 |
| `Esc` (无输入) | 打开/关闭菜单 |

#### 3.2 智能过滤

- 支持模糊匹配（当前已有）
- 支持分组内快速跳转：输入 `>会话` 跳到会话管理分组
- 支持快捷键过滤：输入 `Ctrl` 显示带快捷键的命令

#### 3.3 动态信息

- `/model` 后显示当前模型：`/model  [当前: deepseek-chat]`
- `/skill` 后显示已激活：`/skill  [已激活: planning]`
- `/loop` 后显示运行中的循环数

---

### 4. 新增命令

| 命令 | 功能 | 说明 |
|---|---|---|
| `/provider` | 切换 LLM Provider | 从 `/model` 拆分 |
| `/undo` | 撤销上一条消息 | 快速回退 |
| `/redo` | 重做 | 恢复撤销 |
| `/export` | 导出对话 | Markdown/JSON |
| `/theme` | 切换主题 | 亮色/暗色 |
| `/debug` | 调试模式 | 显示详细日志 |

---

### 5. 实现步骤

#### Step 5.1: 重构 SlashMenu 组件

**文件**：`packages/tui/component/slash-menu.tsx`

**改动**：
- 支持分组数据结构
- 添加边框和背景样式
- 添加分组标题渲染
- 添加动态信息显示

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun test packages/tui/
```

---

#### Step 5.2: 更新命令定义

**文件**：`packages/tui/routes/home.tsx`

**改动**：
- 将 `BUILTIN_COMMANDS` 改为 `SLASH_GROUPS` 结构
- 添加动态信息获取逻辑
- 添加新命令处理

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun run dev
# 测试：输入 / 打开菜单
```

---

#### Step 5.3: 添加新命令处理

**文件**：`packages/tui/routes/home.tsx`

**新增处理**：
```typescript
const handleSlashCommand = async (cmd: string) => {
  const [command, ...args] = cmd.split(' ')
  
  switch (command) {
    case '/clear':
      clearSession()
      break
    case '/compact':
      await compactSession()
      break
    case '/model':
      toggleModelPicker()
      break
    case '/provider':
      // 新增：Provider 选择器
      break
    case '/undo':
      // 新增：撤销上一条
      break
    case '/export':
      // 新增：导出对话
      break
    case '/theme':
      // 新增：切换主题
      break
    // ...
  }
}
```

**verify**：
```bash
bun run dev
# 测试每个新命令
```

---

#### Step 5.4: 添加样式动画

**文件**：`packages/tui/component/slash-menu.tsx`

**改动**：
- 添加菜单展开/收起动画
- 添加选中项高亮动画
- 添加分组折叠/展开

**verify**：
```bash
bun run dev
# 观察动画效果
```

---

#### Step 5.5: 添加单元测试

**文件**：`packages/tui/__tests__/slash-menu.test.ts`

**测试用例**：
- 分组渲染正确
- 模糊匹配正常
- 键盘导航正常
- 命令执行正确

**verify**：
```bash
bun test packages/tui/__tests__/slash-menu.test.ts
```

---

## 不做什么

- ❌ 不改变现有命令的语义
- ❌ 不删除现有命令（只新增）
- ❌ 不改变输入框的基本行为
- ❌ 不引入外部依赖

---

## 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| 样式在不同终端不兼容 | 使用 opentui 的跨平台组件 |
| 动画导致性能问题 | 可关闭动画选项 |
| 新命令破坏现有工作流 | 默认不启用，需用户确认 |

---

## 完成标准

- [ ] 菜单有蓝色边框和背景
- [ ] 命令按分组显示
- [ ] 支持键盘导航和 Tab 填入
- [ ] 动态显示当前模型/技能状态
- [ ] 新增 5+ 命令
- [ ] 所有测试通过
- [ ] 无性能回退

---

## 时间估算

| 步骤 | 工作量 |
|---|---|
| Step 5.1: 重构组件 | 1 天 |
| Step 5.2: 更新命令定义 | 0.5 天 |
| Step 5.3: 添加新命令 | 1 天 |
| Step 5.4: 样式动画 | 0.5 天 |
| Step 5.5: 单元测试 | 0.5 天 |
| **总计** | **3.5 天** |

---

## 参考

- [当前 slash-menu.tsx](../../packages/tui/component/slash-menu.tsx)
- [当前 home.tsx](../../packages/tui/routes/home.tsx)
- [Pi TUI 设计](file:///C:/Users/lzg14/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/docs/tui.md)
