import { Result, apiResult, unwrap, apiMessage, ClientError } from './api.js'
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

export default class Client {
  credentials: Credentials
  session: QuerySession | null

  constructor(credentials: Credentials) {
    this.credentials = credentials
  }

  authorizationHeader() {
    const value = btoa(`${this.credentials.username}:${this.credentials.password}`)

    return {
      Authorization: `Basic ${value}`
    }
  }

  async postJSON<T>(url: string, body?: unknown): Promise<Result<T>> {
    try {
      const result = await apiResult<T>(
        fetch(url, {
          method: 'POST',
          body: body ? JSON.stringify(body) : undefined,
          headers: {
            'Content-Type': 'application/json',
            ...this.authorizationHeader()
          },
          credentials: 'include'
        })
      )

      return result.err ? { err: result.err } : { ok: unwrap(result.ok) }
    } catch (e: any) {
      // Catch error in case something goes awry with fetching auth header.
      return { err: e }
    }
  }

  async createSession(): Promise<QuerySession> {
    const saved = await this.postJSON<QueryExecuteResponse>(
      `${this.credentials.mysqlAddress}/psdb.v1alpha1.Database/CreateSession`,
      {}
    )
    if (saved.ok && !saved.ok.error) {
      if (saved.ok.session) {
        this.session = saved.ok.session
      }
      return saved.ok.session
    } else {
      throw saved.err
    }
  }

  async execute(query: string): Promise<ExecutedQuery> {
    try {
      const startTime = new Date().getTime()
      const saved = await this.postJSON<QueryExecuteResponse>(
        `${this.credentials.mysqlAddress}/psdb.v1alpha1.Database/Execute`,
        {
          query: query,
          session: this.session
        }
      )
      const endTime = new Date().getTime()
      const elapsedTime = endTime - startTime
      if (saved.ok && !saved.ok.error) {
        const body = saved.ok
        const result = body.result
        const rows = result ? parse(result) : null
        const headers = result?.fields?.map((f) => f.name)

        this.session = body.session

        // Transform response into something we understand, this matches our
        // console's `QueryConsole` response format.
        return {
          headers,
          rows,
          size: rows.length,
          statement: query,
          time: elapsedTime
        }
      } else if (saved.ok && saved.ok.error) {
        return {
          statement: query,
          errorMessage: saved.ok.error.message,
          time: elapsedTime
        }
      } else {
        let errorCode: string | null = null
        if (saved.err instanceof ClientError) {
          errorCode = saved.err.body.code
        }

        return {
          statement: query,
          errorCode: errorCode,
          errorMessage: apiMessage(saved.err),
          time: elapsedTime
        }
      }
    } catch (e) {
      return {
        statement: query,
        errorMessage: 'An unexpected error occurred. Please try again later.'
      }
    }
  }

  async Session(): Promise<QuerySession | null> {
    if (this.session) {
      return this.session
    }

    return await this.createSession()
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
