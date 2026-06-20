export async function copy(text: string): Promise<void> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)

  try {
    const proc = Bun.spawn(["clip"], { stdin: "pipe" })
    proc.stdin.write(data)
    proc.stdin.end()
    await proc.exited
  } catch {
    try {
      const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
      proc.stdin.write(data)
      proc.stdin.end()
      await proc.exited
    } catch {
      try {
        const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" })
        proc.stdin.write(data)
        proc.stdin.end()
        await proc.exited
      } catch {}
    }
  }
}
