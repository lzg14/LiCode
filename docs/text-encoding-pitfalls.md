# 文本编码陷阱（Text Encoding Pitfalls）

**目标**：列出在 licode 上踩过的 / 可能踩到的文本编码相关陷阱，固化**正确检测方式**，避免重蹈 2026-07-04 audit 误判的覆辙

**日期**：2026-07-04（建立）
**教训编号**：L01
**触发场景**：文本文件编码检测、跨平台文件扫描、Windows 命令行读文件

---

## ⚠️ 核心禁忌（一句话）

> **永远不要用 PowerShell `Get-Content` / `Select-String` 默认参数判断文件编码。Windows 默认 ANSI 代码页（如中文 = CP936/GBK）会把 UTF-8 中文误判为"乱码"。**

---

## 🩸 L01 — PowerShell ANSI 解码误报（2026-07-04）

### 故事

在为 [v0.3.1 改进盘点](./audits/2026-07-04-v0.3.1-improvement-audit.md) 做全仓扫描时，我通过 bash 工具调用了 `powershell -Command "Get-Content README.md"` 和 `Get-Content CHANGELOG.md`。输出看起来全是乱码（`鍚嶅瓧` / `鏀硅繘鐩樼偣`），于是我立刻断定：

- ❌ "README.md 是 GBK"
- ❌ "CHANGELOG.md 是 GBK"
- ❌ "CHANGELOG 的 `[Unreleased]` 段为空"

并据此写了 §1.2 F01/F02、§2.1、§6.6 F22 三个发现，还建了 T01/T02 任务卡。

**事后验证**：用 Node `TextDecoder('utf8', {fatal:true})` 严格模式扫描全仓 221 个文本文件——**0 个解码失败**。文件其实是合法 UTF-8，PowerShell 显示的"乱码"是它默认按系统代码页（CP936）解码 UTF-8 字节的产物。

### 根本原因

Windows PowerShell 5.x / PowerShell 7+ 的 `Get-Content` / `Set-Content` / `Out-File` / `>` 重定向默认按 **系统 ANSI 代码页**（中文 Windows = CP936 / GBK）读取/写入文件，而不是 UTF-8。

| 场景 | PowerShell 默认行为 | 正确做法 |
|---|---|---|
| `Get-Content foo.md` | 按 CP936 解码字节 | `Get-Content -Encoding UTF8 foo.md` |
| `Set-Content foo.md "中文"` | 按 CP936 写盘 | `Set-Content -Encoding UTF8 foo.md` |
| `echo "中文" > foo.md` | 按 CP936 写盘 | `echo "中文" \| Out-File -Encoding utf8 foo.md` |
| `Select-String "中文" foo.md` | 按 CP936 | `Select-String -Encoding UTF8 "中文" foo.md` |
| `Get-Content \| Select-String` | 按 CP936 | 链式注入 `-Encoding UTF8` 给 `Get-Content` |

**Node 同样问题**：`fs.readFileSync(p, 'utf8')` 会**用 BOM 探测**——若文件无 BOM，会按 UTF-8 解析但**不抛错**（即使字节其实是 GBK）。所以 `fs.readFileSync` 不会误报，但也不会帮你发现非 UTF-8 文件。

### 错误造成的损害

- v0.3.1 audit 文档出现 3 条**虚假**发现（F01 / F02 / F22）
- 创建了 2 张**虚假**任务卡（T01 / T02）
- 浪费时间在"GBK 修复"上，最后发现**所有改动都是错的**
- 必须在文档顶部加"⚠️ 重要勘误"段

### ✅ 正确检测方式

**黄金法则**：先用 `Buffer.from(fs.readFileSync(p))` 拿原始字节，再用 `new TextDecoder('utf-8', {fatal:true}).decode(buf)` 严格解码。

```js
// 一次性扫描目录下所有文本文件，输出非 UTF-8 的
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function isTextual(name) {
  return /\.(md|markdown|ts|tsx|js|mjs|cjs|json|jsonc|ya?ml|toml)$/i.test(name);
}

const root = process.argv[2] || '.';
const decoder = new TextDecoder('utf-8', { fatal: true });
let bad = 0, total = 0;

function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory() && !/(node_modules|\.git|dist|build|coverage)/.test(p)) {
      walk(p);
    } else if (e.isFile() && isTextual(e.name)) {
      total++;
      try {
        const buf = readFileSync(p);
        decoder.decode(buf);
      } catch {
        bad++;
        console.log('NON-UTF-8:', p);
      }
    }
  }
}

walk(root);
console.log(`\nScanned ${total} files, ${bad} non-UTF-8.`);
```

**运行**：

```bash
bun run scan-encoding.mjs D:/ProjectFile/licode
# 或
node scan-encoding.mjs D:/ProjectFile/licode
```

**2026-07-04 实测**：221 files / 0 non-UTF-8。

### 单文件快速检查

```bash
# PowerShell（✅ 正确）
$bytes = [System.IO.File]::ReadAllBytes('README.md')
$utf8  = [System.Text.Encoding]::UTF8
try { $utf8.GetString($bytes) | Out-Null; "OK" } catch { "BAD" }

# Node 一行
node -e "console.log(new TextDecoder('utf-8',{fatal:true}).decode(require('fs').readFileSync(process.argv[1])))" README.md
echo "exit=$?"   # exit=0 = UTF-8 OK

# Bun
bun -e "console.log(new TextDecoder('utf-8',{fatal:true}).decode(await Bun.file(process.argv[2]).bytes()))" '' README.md
```

### 何时使用

**触发条件**——发现以下任一情况，先用上面的脚本验证，**不要立刻下结论**：

1. PowerShell 默认读出来的"乱码"
2. `Select-String "pattern" *.md` 找不到预期匹配
3. `git diff` 显示 UTF-8 文件但显示奇怪字符
4. 文档写入后其他 agent 看不到中文
5. 用户报告"中文显示乱码"

### 其他编码陷阱（待补充）

- **BOM 处理** — `fs.writeFileSync` 默认不加 BOM，PowerShell `Get-Content -Encoding UTF8` 不去 BOM；`Set-Content "内容" -Encoding UTF8` 会**加** BOM
- **JSON.stringify 序列化中文** — 默认不转义；写文件前**显式**决定是否 `\uXXXX` 转义
- **跨进程管道** — PowerShell 5 到 6+ 的输出编码从 GBK 变 UTF-8，老脚本可能错乱

---

## 📋 自查清单

执行任何"读文本文件"操作前：

- [ ] 用的命令是 `Get-Content -Encoding UTF8`？还是加了 `-Encoding`？
- [ ] 写文件的命令是 `-Encoding utf8` / `Out-File -Encoding utf8`？
- [ ] 如果输出"乱码"，**先怀疑解码端**，不要立刻归咎文件编码？
- [ ] 关键判断（"这是 GBK 文件"）有没有用严格解码脚本二次验证？

---

## 🔗 相关文档

- [`docs/audits/2026-07-04-v0.3.1-improvement-audit.md`](./audits/2026-07-04-v0-3-1-improvement-audit.md) — 包含完整勘误与教训（§11）
- [`CLAUDE.md`](../CLAUDE.md) — 已知重要约束段包含本禁忌的简版
- [`docs/silent-failures.md`](./silent-failures.md) — 兄弟文档（catch 块分级策略）

---

## 修订记录

| 日期 | 修订 | 作者 |
|---|---|---|
| 2026-07-04 | 建立 L01（PowerShell ANSI 误报），含 4 条禁忌 + 自查清单 + 扫描脚本 | licode |
