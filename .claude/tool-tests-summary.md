# Tool Tests Summary

**日期**：2026-08-01  
**总测试数**：27  
**通过**：27  
**失败**：0  

## 文件详情

| 文件 | 测试数 | 状态 |
|------|--------|------|
| `read.test.ts` | 6 | 全部通过 |
| `write.test.ts` | 5 | 全部通过 |
| `edit.test.ts` | 5 | 全部通过 |
| `bash.test.ts` | 6 | 全部通过 |
| `grep.test.ts` | 5 | 全部通过 |

## 注意事项

- **read 路径穿越**：`preExecuteHook` 仅对写操作工具（write/edit/delete_file/apply_patch/move_file/copy_file）做路径检查，`read` 工具不走此安全钩子。测试验证 `/etc/passwd` 因文件不存在而报错。
- **grep 正则**：系统未安装 ripgrep (rg)，grep 工具 fallback 到 findstr，其正则语法受限（不支持 `\d`、`\s`、`{n}` 等），测试使用 `[0-9]` 字符类验证正则能力。
