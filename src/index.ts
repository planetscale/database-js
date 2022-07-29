import { utf8Encode } from './text.js'

export interface Credentials {
  username: string
  password: string
  mysqlAddress: string
}

export interface QueryResultRow {
  lengths: string[]
  values: string
}

export interface QueryResultField {
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

export interface QuerySession {
  signature: string
  vitessSession: any
}

interface VitessError {
  message: string
  code: string
}

export interface QueryExecuteResponse {
  session: QuerySession
  result: QueryResult | null
  error?: VitessError
}

export interface QueryResult {
  rowsAffected?: number | null
  insertId?: number | null
  fields?: QueryResultField[] | null
  rows?: QueryResultRow[]
}

export class Client {
  credentials: Credentials

  constructor(credentials: Credentials) {
    this.credentials = credentials
  }

  async execute(query: string): Promise<ExecutedQuery> {
    return this.connection().execute(query)
  }

  connection(): Connection {
    return new Connection(this.credentials)
  }
}

export function connect(credentials: Credentials): Connection {
  return new Connection(credentials)
}

export class Connection {
  private credentials: Credentials
  private session: QuerySession | null

  constructor(credentials: Credentials) {
    this.credentials = credentials
    this.session = null
  }

  async refresh(): Promise<boolean> {
    try {
      const session = await this.createSession()
      return !!session
    } catch {
      return false
    }
  }

  private async createSession(): Promise<QuerySession> {
    const url = `${this.credentials.mysqlAddress}/psdb.v1alpha1.Database/CreateSession`
    const { session } = await this.postJSON<QueryExecuteResponse>(url)
    this.session = session
    return session
  }

  private async postJSON<T>(url: string, body = {}): Promise<T> {
    const auth = btoa(`${this.credentials.username}:${this.credentials.password}`)
    const response = await fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`
      },
      credentials: 'include'
    })

    if (response.ok) {
      const result = await response.json()
      return result
    } else {
      throw new Error(`${response.status} ${response.statusText}`)
    }
  }

  async execute(query: string): Promise<ExecutedQuery> {
    const startTime = Date.now()
    const url = `${this.credentials.mysqlAddress}/psdb.v1alpha1.Database/Execute`
    const saved = await this.postJSON<QueryExecuteResponse>(url, {
      query: query,
      session: this.session
    })
    const time = Date.now() - startTime

    const { result, session, error } = saved
    if (error) throw new Error(error.message)

    this.session = session

    const rows = result ? parse(result) : []
    const headers = result ? result.fields?.map((f) => f.name) : []

    return {
      headers,
      rows,
      size: rows.length,
      statement: query,
      time
    }
  }
}

function parseRow(fields: QueryResultField[], rawRow: QueryResultRow): any {
  const row = decodeRow(rawRow)
  const rv = {}

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    const column = row[i]
    const parsedValue = parseColumn(field.type, column)

    rv[field.name] = parsedValue
  }

  return rv
}

function parse(result: QueryResult): any[] {
  const fields = result.fields
  const rows = result.rows ?? []
  return rows.map((row) => parseRow(fields, row))
}

function decodeRow(row: QueryResultRow) {
  const values = atob(row.values)
  const rv = []
  let offset = 0
  for (let i = 0; i < row.lengths.length; i++) {
    const ll = parseInt(row.lengths[i], 10)
    // If the length is less than zero, it indicates a null value, so we should
    // just call it an empty string and move on.
    if (ll < 0) {
      rv.push('')
      continue
    }

    rv.push(values.substring(offset, offset + ll))
    offset += ll
  }
  return rv
}

function parseColumn(type: string, value: string) {
  // For empty strings, just return back a blank string.
  if (value === '' || null) {
    return ''
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
    default:
      return utf8Encode(value)
  }
}

export interface ExecutedQuery {
  headers?: string[]
  rows?: any[]
  size?: number
  statement?: string
  rawError?: Error
  errorCode?: string
  errorMessage?: string
  time?: number
}
