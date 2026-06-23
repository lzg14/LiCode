import DatabaseBetter from 'better-sqlite3'

export class Database {
  private db: ReturnType<typeof DatabaseBetter>

  constructor(path: string, options?: { readonly?: boolean }) {
    this.db = new (DatabaseBetter as any)(path, options)
  }

  exec(sql: string) {
    this.db.exec(sql)
  }

  prepare(sql: string) {
    const stmt = this.db.prepare(sql)
    return {
      run: (...params: any[]) => stmt.run(...params),
      get: (...params: any[]) => stmt.get(...params),
      all: (...params: any[]) => stmt.all(...params),
      finalize: () => {},
    }
  }

  run(sql: string, ...params: any[]) {
    const bindings = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
    return this.db.prepare(sql).run(...bindings)
  }

  query(sql: string) {
    const db = this.db
    return {
      all: (...params: any[]) => {
        const bindings = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
        return db.prepare(sql).all(...bindings)
      },
      get: (...params: any[]) => {
        const bindings = params.length === 1 && Array.isArray(params[0]) ? params[0] : params
        return db.prepare(sql).get(...bindings)
      },
      values: () => [] as any[],
    }
  }

  close() {
    this.db.close()
  }

  static memory() {
    return new Database(':memory:')
  }
}
