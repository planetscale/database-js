import SqlString from 'sqlstring'

import { utf8Encode } from './text.js'

type ReqInit = Pick<RequestInit, 'method' | 'headers'> & {
  body: string
}

type Row = Record<string, unknown>

interface VitessError {
  message: string
  code: string
}

export interface ExecutedQuery {
  headers: string[]
  rows: Row[]
  size: number
  statement: string
  error?: VitessError | null
  time: number
}

export interface Config {
  username: string
  password: string
  host: string
  fetch?: (input: string, init?: ReqInit) => Promise<Pick<Response, 'ok' | 'json' | 'status' | 'statusText' | 'text'>>
}

interface QueryResultRow {
  lengths: string[]
  values: string
}

interface QueryResultField {
  name?: string
  type?: string
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
  rowsAffected?: number | null
  insertId?: number | null
  fields?: QueryResultField[] | null
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

export class Connection {
  private config: Config
  private session: QuerySession | null

  constructor(config: Config) {
    if (typeof fetch !== 'undefined') {
      config = { fetch, ...config }
    }
    this.config = config
    this.session = null
  }

  async refresh(): Promise<boolean> {
    try {
      await this.createSession()
      return true
    } catch {
      return false
    }
  }

  private async createSession(): Promise<QuerySession> {
    const url = new URL('/psdb.v1alpha1.Database/CreateSession', `https://${this.config.host}`)
    const { session } = await this.postJSON<QueryExecuteResponse>(url)
    this.session = session
    return session
  }

  private async postJSON<T>(url: string | URL, body = {}): Promise<T> {
    const auth = btoa(`${this.config.username}:${this.config.password}`)
    const response = await this.config.fetch(url.toString(), {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      }
    })

    if (response.ok) {
      return await response.json()
    } else {
      throw new Error(`${response.status} ${response.statusText}`)
    }
  }

  async execute(query: string, args?: object | any[]): Promise<ExecutedQuery> {
    const startTime = Date.now()
    const url = new URL('/psdb.v1alpha1.Database/Execute', `https://${this.config.host}`)
    query = SqlString.format(query, args, false, 'UTC')
    const saved = await this.postJSON<QueryExecuteResponse>(url, {
      query: query,
      session: this.session
    })
    const time = Date.now() - startTime

    const { result, session, error } = saved

    this.session = session

    const rows = result ? parse(result) : []
    const headers = result ? result.fields?.map((f) => f.name) ?? [] : []

    return {
      headers,
      rows,
      error,
      size: rows.length,
      statement: query,
      time
    }
  }
}

export function connect(config: Config): Connection {
  return new Connection(config)
}

function parseRow(fields: QueryResultField[], rawRow: QueryResultRow): Row {
  const row = decodeRow(rawRow)
  return fields.reduce((acc, field, ix) => {
    acc[field.name] = parseColumn(field.type, row[ix])
    return acc
  }, {} as Row)
}

function parse(result: QueryResult): Row[] {
  const fields = result.fields
  const rows = result.rows ?? []
  return rows.map((row) => parseRow(fields, row))
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

function parseColumn(type: string, value: string | null): number | string | null {
  if (value === '' || value == null) {
    return value
  }

  switch (type) {
    case 'INT8':
    case 'INT16':
    case 'INT24':
    case 'INT32':
    case 'INT64':
    case 'UINT8':
    case 'UINT16':
    case 'UINT24':
    case 'UINT32':
    case 'UINT64':
      return parseInt(value, 10)
    case 'FLOAT32':
    case 'FLOAT64':
    case 'DECIMAL':
      return parseFloat(value)
    default:
      return utf8Encode(value)
  }
}
