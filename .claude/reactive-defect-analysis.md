# MessageItem 响应式缺陷分析

**日期**：2026-07-31
**文件**：packages/tui/component/message-list.tsx
**目标**：分析 MessageItem 组件中脱离 tracking scope 的计算，评估影响并给出修复方案

---

## 文件是否存在

**存在**，共 358 行。

---

## MessageItem 组件位置

- **行号**：第 111-203 行
- **签名**：unction MessageItem(props: { msg: Message; syntaxStyle?: SyntaxStyle })
- **角色分支**：
  - user：第 114-133 行
  - ssistant：第 135-151 行（**问题集中区域**）
  - 	ool：第 153-179 行
  - system：第 182-200 行

---

## 脱离 tracking scope 的计算

SolidJS 的核心规则：**组件函数体只执行一次**（组件创建时），局部变量赋值不会在 props 变化后重新计算。只有在 createMemo / createEffect / JSX 模板绑定中的表达式才是响应式的。

### assistant 分支（第 136-139 行）— 最严重

`	sx
const cleaned = stripSystemTags(props.msg.content)       // 第 136 行
const display = deriveThinkingDisplay(cleaned, true)     // 第 137 行
const lineCount = props.msg.content.split('\n').length    // 第 138 行
const isLong = lineCount > 15                            // 第 139 行
`

**问题**：
1. stripSystemTags() — 正则匹配 + 字符串替换，O(n) 计算，**在组件创建时执行一次，之后永不更新**
2. deriveThinkingDisplay() — 正则匹配 thinking 标签，**同上**
3. lineCount — 字符串 split，**同上**
4. isLong — 比较运算，**同上**

这四个值全部依赖 props.msg.content，但没有包裹在 createMemo 中。如果同一个 Message 对象的 content 属性被原地修改（mutation），这些计算不会重新执行。

### tool 分支（第 154-159 行）— 中等严重

`	sx
const statusIcon = props.msg.toolStatus === "running" ? "⏳"     // 第 154 行
  : props.msg.toolStatus === "completed" ? "✓"
  : props.msg.toolStatus === "error" ? "✗" : ""
const statusColor = props.msg.toolStatus === "completed" ? success()  // 第 157 行
  : props.msg.toolStatus === "error" ? error() : warning()
const toolArgs = props.msg.toolArgs && props.msg.toolName             // 第 159 行
  ? formatToolArgs(props.msg.toolName, props.msg.toolArgs) : ""
`

**问题**：	oolStatus、	oolArgs、	oolName 变化时，这些值不会重新计算。success()、error()、warning() 虽然是函数调用，但它们的结果赋值给了局部变量 statusColor，在 JSX 中通过 <text fg={statusColor}> 使用——而 statusColor 本身不是响应式的，所以整个链路都不是响应式的。

### user 分支（第 115 行）— 轻微

`	sx
const hasImages = props.msg.images && props.msg.images.length > 0
`

**问题**：images 数组变化时不会重新计算。影响较小，因为 user 消息一旦创建通常不再变化。

---

## 为什么目前没有明显 bug

SolidJS <For> 组件的销毁/重建机制部分掩盖了这个问题：

1. **<For each={messages()}> 使用引用相等性做 keyed diff**
2. 如果消息对象被**替换**（新引用），旧 MessageItem 被销毁，新 MessageItem 被创建，函数体重新执行——计算值正确
3. 如果消息对象被**原地修改**（同一引用），组件不会重建，这些局部变量保持旧值——**静默 stale**

在当前实现中：
- **assistant 消息**：streaming 期间内容通过 PendingStreamView 实时渲染（不走 MessageItem），完成后通过 ddMessage 创建新对象——所以 props.msg.content 不会被原地修改，**当前没有实际 bug**
- **tool 消息**：	oolStatus 在完成后设置为 completed，如果通过 ddMessage 添加新消息则无问题，但如果是同一个对象上修改 	oolStatus，则状态图标不会更新
- **结论**：当前代码在实际使用中**可能不会触发**，但代码模式本身是**防御性缺陷**，未来如果消息对象被原地修改就会静默出错

---

## 对比：collapsible-text.tsx 的正确写法

`	sx
// collapsible-text.tsx 第 14-17 行
const lineCount = createMemo(() => props.content.split('\n').length)  // 响应式 ✓
const isLong = createMemo(() => lineCount() > maxLines)              // 响应式 ✓
const displayText = createMemo(() => { ... })                        // 响应式 ✓
`

同样的计算在 collapsible-text.tsx 中正确地包裹在 createMemo 中，是响应式的。MessageItem 中遗漏了。

---

## 修复方案

### 方案：用 createMemo 包裹所有计算

`	sx
// assistant 分支修复
if (props.msg.role === "assistant") {
  const cleaned = createMemo(() => stripSystemTags(props.msg.content))
  const display = createMemo(() => deriveThinkingDisplay(cleaned(), true))
  const lineCount = createMemo(() => props.msg.content.split('\n').length)
  const isLong = createMemo(() => lineCount() > 15)
  return (
    <box flexDirection="column" marginBottom={1} flexShrink={0}>
      <Show when={isLong()}>
        <text fg={textMuted()}>{  (共  行)}</text>
      </Show>
      <ThinkingView display={display()} streaming={false} syntaxStyle={props.syntaxStyle} />
    </box>
  )
}

// tool 分支修复
if (props.msg.role === "tool") {
  const statusIcon = createMemo(() =>
    props.msg.toolStatus === "running" ? "⏳"
      : props.msg.toolStatus === "completed" ? "✓"
      : props.msg.toolStatus === "error" ? "✗" : ""
  )
  const statusColor = createMemo(() =>
    props.msg.toolStatus === "completed" ? success()
      : props.msg.toolStatus === "error" ? error() : warning()
  )
  const toolArgs = createMemo(() =>
    props.msg.toolArgs && props.msg.toolName
      ? formatToolArgs(props.msg.toolName, props.msg.toolArgs) : ""
  )
  return (
    <box flexDirection="column" marginBottom={0}>
      <box flexDirection="row">
        <Show when={statusIcon()}>
          <text fg={statusColor()}>{ }</text>
        </Show>
        <text fg={textMuted()}>{ }</text>
      </box>
      {/* ... */}
    </box>
  )
}

// user 分支修复
if (props.msg.role === "user") {
  const hasImages = createMemo(() => props.msg.images && props.msg.images.length > 0)
  // ...
  <Show when={hasImages()}>
    {/* ... */}
  </Show>
}
`

**注意**：<Show when={...}> 的 when 属性必须是响应式的（getter），所以 hasImages 要改成 hasImages()。当前代码中 <Show when={hasImages}> 传的是布尔值（非函数），虽然能工作但不是最佳实践。

### 修复可行性评估

| 维度 | 评估 |
|------|------|
| **技术可行性** | ✅ 完全可行，SolidJS 标准模式 |
| **性能影响** | ✅ createMemo 有缓存，只有依赖变化时才重算，无额外开销 |
| **破坏性** | ✅ 零破坏性，纯内部实现变更 |
| **工作量** | ✅ 小，约 30 行改动 |
| **必要性** | ⚠️ 中等 — 当前不会触发 bug，但属于防御性修复 |

---

## 结论

1. **文件存在**，MessageItem 在第 111-203 行
2. **4 处计算在 assistant 分支脱离 tracking scope**（stripSystemTags、deriveThinkingDisplay、lineCount、isLong）
3. **3 处计算在 tool 分支脱离 tracking scope**（statusIcon、statusColor、	oolArgs）
4. **1 处在 user 分支**（hasImages）
5. 当前因消息对象替换机制未触发实际 bug，但代码模式违反 SolidJS reactive 规范
6. **修复方案完全可行**，用 createMemo 包裹即可，改动小、无风险
