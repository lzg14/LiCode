import { z } from 'zod'
import { ConfigSchema, type Config } from './schema'

/**
 * 配置验证器 - 验证配置文件并处理错误
 */

export interface ValidationError {
  path: string
  expected: string
  actual: unknown
  reason: string
}

export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  config?: Config
}

export class ConfigValidator {
  /**
   * 验证配置
   */
  validate(data: unknown): ValidationResult {
    const result = ConfigSchema.safeParse(data)

    if (result.success) {
      return {
        valid: true,
        errors: [],
        config: result.data,
      }
    }

    const errors: ValidationError[] = result.error.issues.map(err => ({
      path: err.path.join('.'),
      expected: err.message,
      actual: undefined,
      reason: err.message,
    }))

    return {
      valid: false,
      errors,
    }
  }

  /**
   * 验证并抛出错误
   */
  validateOrThrow(data: unknown): Config {
    const result = this.validate(data)
    if (!result.valid) {
      const errorMessages = result.errors.map(e => `  ${e.path}: ${e.reason}`).join('\n')
      throw new Error(`配置验证失败:\n${errorMessages}`)
    }
    return result.config!
  }

  /**
   * 合并配置（深度合并）
   */
  merge(base: Partial<Config>, override: Partial<Config>): Partial<Config> {
    return this.deepMerge(base, override)
  }

  /**
   * 深度合并对象
   */
  private deepMerge(target: any, source: any): any {
    const result = { ...target }

    for (const key of Object.keys(source)) {
      if (source[key] === undefined) continue

      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof target[key] === 'object' &&
        target[key] !== null &&
        !Array.isArray(target[key])
      ) {
        result[key] = this.deepMerge(target[key], source[key])
      } else {
        result[key] = source[key]
      }
    }

    return result
  }
}

export const configValidator = new ConfigValidator()
