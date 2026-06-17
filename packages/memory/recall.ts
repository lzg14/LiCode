export function createRecallReminder(memoryPath: string): string {
  return `<system-reminder>
This session has memory at ${memoryPath}. Recall content not in your context with:
- memory.search(query: "...")

Don't ask the user about something memory may already record.
</system-reminder>`
}

export function shouldTriggerRecall(sessionHasMemory: boolean): boolean {
  return sessionHasMemory
}
