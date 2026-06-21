# licode

**Terminal-native AI coding agent** — 参考 MiMo Code 架构，支持多 provider、持久化 session、工具调用、技能系统

> 以前：有个想法 → 找人聊 → 没时间 → 算了
> 现在：有个想法 → 跟 AI 聊清楚 → 2 小时出原型 → 跑起来了！

---

## 核心特性

| 特性 | 说明 |
|------|------|
| **Terminal-native TUI** | SolidJS + @opentui 终端 UI |
| **多 LLM Provider** | Anthropic / OpenAI / DeepSeek / MiniMax |
| **工具系统** | 文件操作、Git、Shell、搜索等内置工具 |
| **Skill 系统** | 兼容 Claude Code `~/.claude/skills/` 格式 |
| **安全层** | 命令白名单、路径限制、危险命令拦截 |
| **Session 管理** | 持久化会话，跨启动恢复 |
| **Checkpoint 恢复** | 断点续传，不丢失进度 |
| **MCP 集成** | 自动连接配置的 MCP 服务器 |
| **上下文管理** | 项目级 `.licode.md` 配置加载 |

---

## 快速开始

```bash
# 克隆
git clone https://github.com/your-username/licode.git
cd licode

# 安装依赖
bun install

# 配置 API Key
export ANTHROPIC_API_KEY="your-api-key"

# 启动
bun run dev
```

配置参考 `licode.config.json.example`。

---

## 项目结构

```
licode/
├── packages/
│   ├── core/           # 核心循环（loop、phases、checkpoint、compaction）
│   ├── tools/          # 工具系统（文件/搜索/Git/Shell）
│   ├── session/        # 会话管理（SQLite 持久化、历史压缩）
│   ├── tui/            # 终端 UI（SolidJS + @opentui）
│   ├── config/         # 配置管理（多层级/环境变量/外部导入）
│   ├── llm/            # LLM Provider（Anthropic/OpenAI/DeepSeek/MiniMax）
│   ├── security/       # 安全层（命令白名单、路径限制、危险命令拦截）
│   ├── skills/         # 技能系统（兼容 Claude Code skills）
│   ├── memory/         # 记忆系统（FTS5、recall）
│   └── integration/    # 外部集成（MCP、Git）
├── docs/               # 设计文档
└── package.json
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | [Bun](https://bun.sh/) |
| 语言 | TypeScript |
| TUI | [SolidJS](https://www.solidjs.com/) + [@opentui](https://github.com/nicholasgasior/opentui) |
| LLM | [Anthropic](https://www.anthropic.com/) / [OpenAI](https://openai.com/) |
| 验证 | [Zod](https://zod.dev/) |
| 数据库 | SQLite (bun:sqlite) |
| 测试 | [Vitest](https://vitest.dev/) |

---

## 测试

```bash
# 运行所有测试
bun run vitest run

# 运行特定测试
bun run vitest run packages/config/__tests__/loader.test.ts

# 监听模式
bun run vitest watch
```

---

## 快捷键

### 全局

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+B` | 切换侧栏 |
| `Ctrl+M` | 切换模型 |

### 输入框

| 快捷键 | 功能 |
|--------|------|
| `←/→` | 光标左/右移 1 字符 |
| `Home/End` | 移到行首/行尾 |
| `Ctrl+A/E` | 移到行首/行尾 (readline) |
| `Ctrl+B/F` | 后退/前进 1 字符 (readline) |
| `Ctrl+←/→` | 按单词跳转 |
| `Ctrl+Home/End` | 移到文本开头/结尾 |
| `Shift+←/→` | 选择 1 字符 |
| `Shift+Home/End` | 选择到行首/行尾 |
| `Shift+Ctrl+←/→` | 按单词选择 |
| `Ctrl+Shift+A` | 全选 |
| `Ctrl+C` | 复制选中文本 |
| `Ctrl+X` | 剪切选中文本 |
| `Ctrl+V` | 粘贴文本/图片 |
| `Ctrl+D` | 删除光标后 1 字符 |
| `Ctrl+H` | 删除光标前 1 字符 (Backspace) |
| `Ctrl+W` | 删除前一个单词 |
| `Alt+Backspace` | 删除前一个单词 |
| `Alt+D` | 删除后一个单词 |
| `Ctrl+K` | 删除到行尾 |
| `Ctrl+U` | 删除到行首 |
| `Ctrl+L` | 清空输入框 |
| `Tab` | 插入 2 个空格 |
| `Esc` | 清除选择 / 取消执行 |

## 斜杠命令

| 命令 | 功能 |
|------|------|
| `/skill <name>` | 激活技能 |
| `/skill list` | 列出可用技能 |
| `/compact` | 压缩对话历史 |
| `/clear` | 开新会话 |

---

## License

MIT
