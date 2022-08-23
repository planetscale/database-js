import { format } from './sanitization.js'
export { format } from './sanitization.js'
export { hex } from './text.js'
import { decode } from './text.js'
import { Version } from './version.js'

type Row = Record<string, any>

interface VitessError {
  message: string
  code: string
}

export class DatabaseError extends Error {
  body: VitessError
  status: number
  constructor(message: string, status: number, body: VitessError) {
    super(message)
    this.status = status
    this.name = 'DatabaseError'
    this.body = body
  }
}

type Types = Record<string, string>

export interface ExecutedQuery {
  headers: string[]
  types: Types
  rows: Row[]
  size: number
  statement: string
  insertId: string | null
  rowsAffected: number | null
  error: VitessError | null
  time: number
}

type Req = {
  method: string
  headers: Record<string, string>
  body: string
}

type Res = {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<any>
  text(): Promise<string>
}

export type Cast = typeof cast

export interface Config {
  url?: string
  username?: string
  password?: string
  host?: string
  fetch?: (input: string, init?: Req) => Promise<Res>
  format?: (query: string, args: any) => string
  cast?: Cast
}

interface QueryResultRow {
  lengths: string[]
  values: string
}

export interface Field {
  name: string
  type: string
  table?: string

  // Only populated for included fields
  orgTable?: string | null
  database?: string | null
  orgName?: string | null

  columnLength?: number | null
  charset?: number | null
  flags?: number | null
  columnType?: string | null
}

type QuerySession = unknown

interface QueryExecuteResponse {
  session: QuerySession
  result: QueryResult | null
  error?: VitessError
}

interface QueryResult {
  rowsAffected?: string | null
  insertId?: string | null
  fields?: Field[] | null
  rows?: QueryResultRow[]
}

export class Client {
  private config: Config

  constructor(config: Config) {
    this.config = config
  }

  async execute(query: string, args?: object | any[]): Promise<ExecutedQuery> {
    return this.connection().execute(query, args)
  }

  connection(): Connection {
    return new Connection(this.config)
  }
}

type Transaction = Connection

export class Connection {
  private config: Config
  private session: QuerySession | null

  constructor(config: Config) {
    this.session = null
    this.config = { ...config }

    if (typeof fetch !== 'undefined') {
      this.config.fetch ||= fetch
    }

    if (config.url) {
      const url = new URL(config.url)
      this.config.username = url.username
      this.config.password = url.password
      this.config.host = url.hostname
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx = new Connection(this.config)

    try {
      await tx.execute('BEGIN')
      const res = await fn(tx)
      await tx.execute('COMMIT')

      return res
    } catch (err) {
      await tx.execute('ROLLBACK')
      throw err
    }
  }

  async refresh(): Promise<void> {
    await this.createSession()
  }

  async execute(query: string, args?: any): Promise<ExecutedQuery> {
    const url = new URL('/psdb.v1alpha1.Database/Execute', `https://${this.config.host}`)

    const formatter = this.config.format || format
    const sql = args ? formatter(query, args) : query

    const start = Date.now()
    const saved = await postJSON<QueryExecuteResponse>(this.config, url, { query: sql, session: this.session })
    const time = Date.now() - start

    const { result, session, error } = saved
    const rowsAffected = result?.rowsAffected ? parseInt(result.rowsAffected, 10) : null
    const insertId = result?.insertId ?? null

    this.session = session

    const rows = result ? parse(result, this.config.cast || cast) : []
    const headers = result ? result.fields?.map((f) => f.name) ?? [] : []

    const typeByName = (acc, { name, type }) => ({ ...acc, [name]: type })
    const types = result ? result.fields?.reduce<Types>(typeByName, {}) ?? {} : {}

    return {
      headers,
      types,
      rows,
      rowsAffected,
      insertId,
      error: error ?? null,
      size: rows.length,
      statement: sql,
      time
    }
  }

  private async createSession(): Promise<QuerySession> {
    const url = new URL('/psdb.v1alpha1.Database/CreateSession', `https://${this.config.host}`)
    const { session } = await postJSON<QueryExecuteResponse>(this.config, url)
    this.session = session
    return session
  }
}

async function postJSON<T>(config: Config, url: string | URL, body = {}): Promise<T> {
  const auth = btoa(`${config.username}:${config.password}`)
  const { fetch } = config
  const response = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `database-js/${Version}`,
      Authorization: `Basic ${auth}`
    }
  })

  if (response.ok) {
    return await response.json()
  } else {
    let error = null
    try {
      const e = (await response.json()).error
      error = new DatabaseError(e.message, response.status, e)
    } catch {
      error = new DatabaseError(response.statusText, response.status, {
        code: 'internal',
        message: response.statusText
      })
    }
    throw error
  }
}

export function connect(config: Config): Connection {
  return new Connection(config)
}

function parseRow(fields: Field[], rawRow: QueryResultRow, cast: Cast): Row {
  const row = decodeRow(rawRow)
  return fields.reduce((acc, field, ix) => {
    acc[field.name] = cast(field, row[ix])
    return acc
  }, {} as Row)
}

function parse(result: QueryResult, cast: Cast): Row[] {
  const fields = result.fields
  const rows = result.rows ?? []
  return rows.map((row) => parseRow(fields, row, cast))
}

function decodeRow(row: QueryResultRow): Array<string | null> {
  const values = atob(row.values)
  let offset = 0
  return row.lengths.map((size) => {
    const width = parseInt(size, 10)
    // Negative length indicates a null value.
    if (width < 0) return null
    const splice = values.substring(offset, offset + width)
    offset += width
    return splice
  })
}

export function cast(field: Field, value: string | null): any {
  if (value === '' || value == null) {
    return value
  }

  switch (field.type) {
    case 'INT8':
    case 'INT16':
    case 'INT24':
    case 'INT32':
    case 'UINT8':
    case 'UINT16':
    case 'UINT24':
    case 'UINT32':
    case 'YEAR':
      return parseInt(value, 10)
    case 'FLOAT32':
    case 'FLOAT64':
      return parseFloat(value)
    case 'DECIMAL':
    case 'INT64':
    case 'UINT64':
    case 'DATE':
    case 'TIME':
    case 'DATETIME':
    case 'TIMESTAMP':
    case 'BLOB':
    case 'BIT':
    case 'VARBINARY':
    case 'BINARY':
      return value
    case 'JSON':
      return JSON.parse(decode(value))
    default:
      return decode(value)
  }
}
