const DEFAULT_MAX_CHARS = 50_000
const TRUNCATION_SUFFIX = '\n\n... [truncated]'

export function truncateOutput(
  output: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (output.length <= maxChars) return output
  return output.slice(0, maxChars - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
}
