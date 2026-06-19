const DEFAULT_MAX_CHARS = 50_000
const TRUNCATION_SUFFIX = '\n\n... [truncated]'

export function truncateOutput(
  output: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (output.length <= maxChars) return output
  return output.slice(0, maxChars - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}

export function truncateLines(
  output: string,
  maxLines: number = 2000,
): string {
  const lines = output.split('\n')
  if (lines.length <= maxLines) return output
  return lines.slice(0, maxLines).join('\n') + TRUNCATION_SUFFIX
}

export function truncateByTokens(
  output: string,
  maxTokens: number = 10000,
): string {
  const estimatedTokens = Math.ceil(output.length / 4)
  if (estimatedTokens <= maxTokens) return output
  const maxChars = maxTokens * 4
  return output.slice(0, maxChars - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}
