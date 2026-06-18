import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * 数据库集成 - SQLite 连接管理、查询执行、迁移支持、备份恢复
 */

export interface DatabaseConfig {
  path: string
  wal?: boolean
  busyTimeout?: number
  JournalMode?: 'delete' | 'wal' | 'memory'
}

export interface Migration {
  version: number
  name: string
  up: string
  down: string
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  changes: number
  lastInsertRowid?: number
}

export interface BackupOptions {
  destination: string
  incremental?: boolean
}

export class DatabaseIntegration extends BaseIntegration {
  name = 'database'
  private dbPath: string
  private config: DatabaseConfig
  private migrations: Migration[] = []
  private currentVersion = 0

  constructor(config: DatabaseConfig) {
    super()
    this.dbPath = config.path
    this.config = {
      wal: true,
      busyTimeout: 5000,
      JournalMode: 'wal',
      ...config,
    }
  }

  async connect(): Promise<void> {
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
    this.enabled = true
    await this.runMigrations()
  }

  async disconnect(): Promise<void> {
    this.enabled = false
  }

  async health(): Promise<HealthStatus> {
    try {
      const result = await this.query<{ ok: number }>('SELECT 1 as ok')
      return {
        healthy: result.rows.length > 0,
        message: 'Database connected',
      }
    } catch (error) {
      return {
        healthy: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * 执行查询（SELECT）
   */
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.withConnection(async () => {
      const result = this.executeSql<T>(sql, params)
      return result
    })
  }

  /**
   * 执行写操作（INSERT/UPDATE/DELETE）
   */
  async execute(sql: string, params?: unknown[]): Promise<QueryResult> {
    return this.withConnection(async () => {
      const result = this.executeSql(sql, params)
      return {
        rows: [],
        changes: result.changes || 0,
        lastInsertRowid: result.lastInsertRowid,
      }
    })
  }

  /**
   * 批量执行多条 SQL
   */
  async executeBatch(statements: { sql: string; params?: unknown[] }[]): Promise<void> {
    return this.withConnection(async () => {
      for (const stmt of statements) {
        this.executeSql(stmt.sql, stmt.params)
      }
    })
  }

  /**
   * 注册迁移
   */
  registerMigration(migration: Migration): void {
    this.migrations.push(migration)
    this.migrations.sort((a, b) => a.version - b.version)
  }

  /**
   * 获取当前迁移版本
   */
  getVersion(): number {
    return this.currentVersion
  }

  /**
   * 回滚到指定版本
   */
  async rollback(targetVersion: number): Promise<void> {
    return this.withConnection(async () => {
      const toRollback = this.migrations
        .filter(m => m.version > targetVersion && m.version <= this.currentVersion)
        .reverse()

      for (const migration of toRollback) {
        this.executeSql(migration.down)
        this.currentVersion = migration.version - 1
      }
    })
  }

  /**
   * 备份数据库
   */
  async backup(options: BackupOptions): Promise<void> {
    return this.withConnection(async () => {
      const destDir = dirname(options.destination)
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }

      if (options.incremental && existsSync(options.destination)) {
        copyFileSync(options.destination, options.destination + '.bak')
      }

      copyFileSync(this.dbPath, options.destination)

      const walPath = this.dbPath + '-wal'
      const shmPath = this.dbPath + '-shm'
      if (existsSync(walPath)) {
        copyFileSync(walPath, options.destination + '-wal')
      }
      if (existsSync(shmPath)) {
        copyFileSync(shmPath, options.destination + '-shm')
      }
    })
  }

  /**
   * 恢复数据库
   */
  async restore(backupPath: string): Promise<void> {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`)
    }

    this.enabled = false
    copyFileSync(backupPath, this.dbPath)

    const walPath = backupPath + '-wal'
    const shmPath = backupPath + '-shm'
    if (existsSync(walPath)) {
      copyFileSync(walPath, this.dbPath + '-wal')
    }
    if (existsSync(shmPath)) {
      copyFileSync(shmPath, this.dbPath + '-shm')
    }

    this.enabled = true
  }

  /**
   * 获取数据库文件大小
   */
  getSize(): { bytes: number; formatted: string } {
    const stat = existsSync(this.dbPath)
      ? { size: 0 }
      : { size: 0 }

    return {
      bytes: stat.size,
      formatted: this.formatBytes(stat.size),
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  private executeSql<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ): { rows: T[]; changes?: number; lastInsertRowid?: number } {
    try {
      const sqlObj = this.loadSqlModule()
      const db = new sqlObj.Database(this.dbPath)

      try {
        if (this.config.wal) {
          db.pragma('journal_mode = WAL')
        }
        if (this.config.busyTimeout) {
          db.pragma(`busy_timeout = ${this.config.busyTimeout}`)
        }

        if (sql.trim().toUpperCase().startsWith('SELECT')) {
          const stmt = db.prepare(sql)
          const rows = params ? stmt.all(...params) as T[] : stmt.all() as T[]
          return { rows }
        } else {
          const stmt = db.prepare(sql)
          const result = params ? stmt.run(...params) : stmt.run()
          return {
            rows: [],
            changes: result.changes,
            lastInsertRowid: Number(result.lastInsertRowid),
          }
        }
      } finally {
        db.close()
      }
    } catch (error) {
      throw new Error(`SQL execution failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private loadSqlModule(): typeof import('better-sqlite3') {
    try {
      return require('better-sqlite3')
    } catch {
      throw new Error(
        'better-sqlite3 is required. Install it with: npm install better-sqlite3'
      )
    }
  }

  private async runMigrations(): Promise<void> {
    return this.withConnection(async () => {
      this.executeSql(`
        CREATE TABLE IF NOT EXISTS _migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT DEFAULT (datetime('now'))
        )
      `)

      const result = this.executeSql<{ version: number }>(
        'SELECT MAX(version) as version FROM _migrations'
      )
      this.currentVersion = result.rows[0]?.version || 0

      for (const migration of this.migrations) {
        if (migration.version > this.currentVersion) {
          this.executeSql(migration.up)
          this.executeSql(
            'INSERT INTO _migrations (version, name) VALUES (?, ?)',
            [migration.version, migration.name]
          )
          this.currentVersion = migration.version
        }
      }
    })
  }
}

export interface DatabaseSchema {
  name: string
  version: number
  migrations: Migration[]
}

export function createDatabaseConfig(path: string, options?: Partial<DatabaseConfig>): DatabaseConfig {
  return {
    path,
    wal: true,
    busyTimeout: 5000,
    ...options,
  }
}

export const DEFAULT_DATABASE_CONFIG: DatabaseConfig = {
  path: './data/app.db',
  wal: true,
  busyTimeout: 5000,
}
