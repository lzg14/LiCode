import { z } from 'zod'
import type { OutputSchema, StructuredOutput } from './types'

export class OutputParser {
  private schemas = new Map<string, OutputSchema>()

  register(schema: OutputSchema): void {
    this.schemas.set(schema.name, schema)
  }

  unregister(name: string): boolean {
    return this.schemas.delete(name)
  }

  parse<T>(name: string, raw: string): StructuredOutput<T> {
    const outputSchema = this.schemas.get(name)
    if (!outputSchema) {
      return {
        status: 'failed',
        error: `Schema "${name}" not registered`,
      }
    }

    try {
      const json = this.extractJson(raw)
      const result = outputSchema.schema.safeParse(json)

      if (result.success) {
        return {
          status: 'success',
          data: result.data as T,
        }
      }

      return {
        status: 'failed',
        error: this.formatZodError(result.error),
      }
    } catch (err) {
      return {
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  parseFromText<T>(name: string, text: string, fallback?: T): StructuredOutput<T> {
    const output = this.parse<T>(name, text)
    if (output.status === 'failed' && fallback !== undefined) {
      return {
        status: 'partial',
        data: fallback,
        error: output.error,
      }
    }
    return output
  }

  validate<T>(name: string, data: unknown): StructuredOutput<T> {
    const outputSchema = this.schemas.get(name)
    if (!outputSchema) {
      return {
        status: 'failed',
        error: `Schema "${name}" not registered`,
      }
    }

    const result = outputSchema.schema.safeParse(data)
    if (result.success) {
      return {
        status: 'success',
        data: result.data as T,
      }
    }

    return {
      status: 'failed',
      error: this.formatZodError(result.error),
    }
  }

  getSchema(name: string): OutputSchema | undefined {
    return this.schemas.get(name)
  }

  listSchemas(): string[] {
    return Array.from(this.schemas.keys())
  }

  private extractJson(text: string): unknown {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim())
    }

    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed)
    }

    throw new Error('No valid JSON found in text')
  }

  private formatZodError(error: z.ZodError): string {
    return error.issues
      .map(i => {
        const path = i.path.length > 0 ? `${i.path.join('.')}: ` : ''
        return `${path}${i.message}`
      })
      .join('; ')
  }
}

export function defineOutputSchema<T>(
  name: string,
  schema: z.ZodType<T>,
  description?: string,
): OutputSchema<T> {
  return { name, schema, description }
}

export const outputParser = new OutputParser()
