# Slash 菜单改进计划

**目标**：重新设计 `/` 命令菜单，简洁实用

**日期**：2025-08-07

---

## 现状

当前菜单：纯文本列表，无边框，命令和 skill 混在一起。

---

## 改进方案：最简风格

### 核心原则

- **无边框**：直接在输入框上方渲染
- **紧凑**：每行一个命令，无分组标题
- **即时反馈**：输入即过滤，Tab 填入

### 新布局

```
  /clear      开新会话
▸ /compact    压缩对话历史
  /help       快捷键帮助
  /model      当前: deepseek-chat
  /loop       定时执行
  /skill      激活技能
  /tree       会话树导航
```

- `▸` 表示选中项
- 无边框、无背景、无分组
- 选中项高亮显示

### 交互

| 按键 | 功能 |
|---|---|
| `↑` `↓` | 选择 |
| `Tab` | 填入选中命令 |
| `Enter` | 执行 |
| `ESC` | 关闭 |

---

## 实现步骤

### Step 1: 简化 SlashMenu 组件

**文件**：`packages/tui/component/slash-menu.tsx`

**改动**：
- 移除边框和背景
- 保持紧凑列表样式
- 优化高亮显示

**verify**：
```bash
bunx tsc --noEmit --skipLibCheck
bun run dev
```

---

### Step 2: 添加动态信息

**文件**：`packages/tui/routes/home.tsx`

**改动**：
- `/model` 后显示当前模型
- `/skill` 后显示已激活技能

**verify**：
```bash
bun run dev
# 输入 /model 查看是否显示当前模型
```

---

### Step 3: 新增命令

**文件**：`packages/tui/routes/home.tsx`

**新增**：
- `/undo` - 撤销上一条消息
- `/export` - 导出对话

**verify**：
```bash
bun run dev
# 测试新命令
```

---

## 不做什么

- ❌ 不加边框
- ❌ 不加分组标题
- ❌ 不加动画
- ❌ 不加图标

---

## 完成标准

- [ ] 菜单简洁无边框
- [ ] 支持 Tab 填入
- [ ] 动态显示当前模型/技能
- [ ] 新增 `/undo`、`/export`

---

## 时间估算：1 天

| 步骤 | 工作量 |
|---|---|
| Step 1: 简化组件 | 0.3 天 |
| Step 2: 动态信息 | 0.3 天 |
| Step 3: 新增命令 | 0.4 天 |
