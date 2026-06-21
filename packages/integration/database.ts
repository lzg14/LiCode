import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, copyFileSync } from 'fs'
import { dirname } from 'path'
import { BaseIntegration, type HealthStatus } from './types'

/**
 * 数据库集成 - 使用 bun:sqlite
 */

export interface DatabaseConfig {
  path: string
  wal?: boolean
  busyTimeout?: number
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
  private db: Database | null = null
  private migrations: Migration[] = []
  private currentVersion = 0

  constructor(config: DatabaseConfig) {
    super()
    this.dbPath = config.path
    this.config = {
      wal: true,
      busyTimeout: 5000,
      ...config,
    }
  }

  async connect(): Promise<void> {
    const dir = dirname(this.dbPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    this.db = new Database(this.dbPath)

    if (this.config.wal) {
      this.db.exec('PRAGMA journal_mode = WAL')
    }
    if (this.config.busyTimeout) {
      this.db.exec(`PRAGMA busy_timeout = ${this.config.busyTimeout}`)
    }

    this.enabled = true
    await this.runMigrations()
  }

  async disconnect(): Promise<void> {
    if (this.db) {
      this.db.close()
      this.db = null
    }
    this.enabled = false
  }

  async health(): Promise<HealthStatus> {
    try {
      const result = this.query<{ ok: number }>('SELECT 1 as ok')
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

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): QueryResult<T> {
    if (!this.db) throw new Error('Database not connected')

    const stmt = this.db.prepare(sql)
    const rows = params ? stmt.all(...(params as any[])) as T[] : stmt.all() as T[]
    return { rows, changes: 0 }
  }

  execute(sql: string, params?: unknown[]): QueryResult {
    if (!this.db) throw new Error('Database not connected')

    const stmt = this.db.prepare(sql)
    const result = params ? stmt.run(...(params as any[])) : stmt.run()
    return {
      rows: [],
      changes: result.changes,
      lastInsertRowid: Number(result.lastInsertRowid),
    }
  }

  executeBatch(statements: { sql: string; params?: unknown[] }[]): void {
    if (!this.db) throw new Error('Database not connected')

    for (const stmt of statements) {
      this.execute(stmt.sql, stmt.params)
    }
  }

  registerMigration(migration: Migration): void {
    this.migrations.push(migration)
    this.migrations.sort((a, b) => a.version - b.version)
  }

  getVersion(): number {
    return this.currentVersion
  }

  rollback(targetVersion: number): void {
    if (!this.db) throw new Error('Database not connected')

    const toRollback = this.migrations
      .filter(m => m.version > targetVersion && m.version <= this.currentVersion)
      .reverse()

    for (const migration of toRollback) {
      this.execute(migration.down)
      this.currentVersion = migration.version - 1
    }
  }

  backup(options: BackupOptions): void {
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
  }

  restore(backupPath: string): void {
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

  getSize(): { bytes: number; formatted: string } {
    const { statSync } = require('fs')
    const stat = existsSync(this.dbPath) ? statSync(this.dbPath) : { size: 0 }
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

  private runMigrations(): void {
    if (!this.db) throw new Error('Database not connected')

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `)

    const result = this.query<{ version: number }>(
      'SELECT MAX(version) as version FROM _migrations'
    )
    this.currentVersion = result.rows[0]?.version || 0

    for (const migration of this.migrations) {
      if (migration.version > this.currentVersion) {
        this.execute(migration.up)
        this.execute(
          'INSERT INTO _migrations (version, name) VALUES (?, ?)',
          [migration.version, migration.name]
        )
        this.currentVersion = migration.version
      }
    }
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
