import { format } from './sanitization.js'
export { format } from './sanitization.js'
export { hex } from './text.js'
import { decode } from './text.js'
import { Version } from './version.js'

type Row<T extends ExecuteAs = 'object'> = T extends 'array' ? any[] : T extends 'object' ? Record<string, any> : never

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

export interface ExecutedQuery<T = Row<'array'> | Row<'object'>> {
  headers: string[]
  types: Types
  rows: T[]
  fields: Field[]
  size: number
  statement: string
  insertId: string
  rowsAffected: number
  time: number
}

type Fetch = (input: string, init?: Req) => Promise<Res>

type Req = {
  method: string
  headers: Record<string, string>
  body: string
  cache?: RequestCache
}

type Res = {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<any>
  text(): Promise<string>
}

export type Cast = typeof cast
type Format = typeof format
type Variable = '@@boost_cached_queries'
type Variables = Record<Variable, string>

export interface Config {
  url?: string
  database?: string
  username?: string
  password?: string
  host?: string
  variables?: Variables
  fetch?: Fetch
  format?: Format
  cast?: Cast
}

type Session = {
  database?: string
  variables?: Variables
}

interface QueryResultRow {
  lengths: string[]
  values?: string
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
  timing?: number // duration in seconds
}

interface QueryResult {
  rowsAffected?: string | null
  insertId?: string | null
  fields?: Field[] | null
  rows?: QueryResultRow[]
}

type ExecuteAs = 'array' | 'object'

type ExecuteArgs = Record<string, any> | any[] | null

type ExecuteOptions<T extends ExecuteAs = 'object'> = T extends 'array'
  ? { as?: 'object'; cast?: Cast; database?: string; variables?: Variables }
  : T extends 'object'
  ? { as: 'array'; cast?: Cast; database?: string; variables?: Variables }
  : never

export class Client {
  public readonly config: Config

  constructor(config: Config) {
    this.config = config
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>, override?: Session): Promise<T> {
    return this.connection(override).transaction(fn)
  }

  async execute<T = Row<'object'>>(
    query: string,
    args?: ExecuteArgs,
    options?: ExecuteOptions<'object'>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'array'>>(
    query: string,
    args: ExecuteArgs,
    options: ExecuteOptions<'array'>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'object'> | Row<'array'>>(
    query: string,
    args: ExecuteArgs = null,
    options: any = { as: 'object' }
  ): Promise<ExecutedQuery<T>> {
    return this.connection().execute<T>(query, args, options)
  }

  connection(override?: Session): Connection {
    return new Connection({ ...this.config, ...override })
  }
}

export type Transaction = Tx

class Tx {
  private conn: Connection

  constructor(conn: Connection) {
    this.conn = conn
  }

  async execute<T = Row<'object'>>(
    query: string,
    args?: ExecuteArgs,
    options?: Omit<ExecuteOptions<'object'>, keyof Session>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'array'>>(
    query: string,
    args: ExecuteArgs,
    options: Omit<ExecuteOptions<'array'>, keyof Session>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'object'> | Row<'array'>>(
    query: string,
    args: ExecuteArgs = null,
    options: any = { as: 'object' }
  ): Promise<ExecutedQuery<T>> {
    const { database: _, variables: __, ...executeOptions } = options
    return this.conn.execute<T>(query, args, executeOptions)
  }
}

function protocol(protocol: string): string {
  return protocol === 'http:' ? protocol : 'https:'
}

function buildURL(url: URL): string {
  const scheme = `${protocol(url.protocol)}//`

  return new URL(url.pathname, `${scheme}${url.host}`).toString()
}

export class Connection {
  public readonly config: Config
  private fetch: Fetch
  private session: QuerySession | null
  private url: string

  constructor(config: Config) {
    this.config = config
    this.fetch = config.fetch || fetch!
    this.session = null

    if (config.url) {
      const url = new URL(config.url)
      this.config.username = url.username
      this.config.password = url.password
      this.config.host = url.hostname
      this.url = buildURL(url)
    } else {
      this.url = new URL(`https://${this.config.host}`).toString()
    }
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>, override?: Session): Promise<T> {
    const conn = new Connection({ ...this.config, ...override }) // Create a new connection specifically for the transaction
    const tx = new Tx(conn)

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

  async execute<T = Row<'object'>>(
    query: string,
    args?: ExecuteArgs,
    options?: ExecuteOptions<'object'>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'array'>>(
    query: string,
    args: ExecuteArgs,
    options: ExecuteOptions<'array'>
  ): Promise<ExecutedQuery<T>>
  async execute<T = Row<'object'> | Row<'array'>>(
    query: string,
    args: ExecuteArgs = null,
    options: any = { as: 'object' }
  ): Promise<ExecutedQuery<T>> {
    console.log('// defaults', { database: this.config.database, variables: this.config.variables })
    console.log('// overrides', { database: options.database, variables: options.variables })

    const url = new URL('/psdb.v1alpha1.Database/Execute', this.url)

    const formatter = this.config.format || format
    const sql = args ? formatter(query, args) : query

    const saved = await postJSON<QueryExecuteResponse>(this.config, this.fetch, url, {
      query: sql,
      session: this.session
    })

    const { result, session, error, timing } = saved
    if (session) {
      this.session = session
    }

    if (error) {
      throw new DatabaseError(error.message, 400, error)
    }

    const rowsAffected = result?.rowsAffected ? parseInt(result.rowsAffected, 10) : 0
    const insertId = result?.insertId ?? '0'

    const fields = result?.fields ?? []
    // ensure each field has a type assigned,
    // the only case it would be omitted is in the case of
    // NULL due to the protojson spec. NULL in our enum
    // is 0, and empty fields are omitted from the JSON response,
    // so we should backfill an expected type.
    for (const field of fields) {
      field.type ||= 'NULL'
    }

    const castFn = options.cast || this.config.cast || cast
    const rows = result ? parse<T>(result, castFn, options.as || 'object') : []
    const headers = fields.map((f) => f.name)

    const typeByName = (acc: Types, { name, type }: Field) => ({ ...acc, [name]: type })
    const types = fields.reduce<Types>(typeByName, {})
    const timingSeconds = timing ?? 0

    return {
      headers,
      types,
      fields,
      rows,
      rowsAffected,
      insertId,
      size: rows.length,
      statement: sql,
      time: timingSeconds * 1000
    }
  }

  private async createSession(): Promise<QuerySession> {
    const url = new URL('/psdb.v1alpha1.Database/CreateSession', this.url)
    const { session } = await postJSON<QueryExecuteResponse>(this.config, this.fetch, url)
    this.session = session
    return session
  }
}

async function postJSON<T>(config: Config, fetch: Fetch, url: string | URL, body = {}): Promise<T> {
  const auth = btoa(`${config.username}:${config.password}`)
  const response = await fetch(url.toString(), {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': `database-js/${Version}`,
      Authorization: `Basic ${auth}`
    },
    cache: 'no-store'
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

function parseArrayRow<T>(fields: Field[], rawRow: QueryResultRow, cast: Cast): T {
  const row = decodeRow(rawRow)

  return fields.map((field, ix) => {
    return cast(field, row[ix])
  }) as T
}

function parseObjectRow<T>(fields: Field[], rawRow: QueryResultRow, cast: Cast): T {
  const row = decodeRow(rawRow)

  return fields.reduce(
    (acc, field, ix) => {
      acc[field.name] = cast(field, row[ix])
      return acc
    },
    {} as Record<string, ReturnType<Cast>>
  ) as T
}

function parse<T>(result: QueryResult, cast: Cast, returnAs: ExecuteAs): T[] {
  const fields = result.fields ?? []
  const rows = result.rows ?? []
  return rows.map((row) =>
    returnAs === 'array' ? parseArrayRow<T>(fields, row, cast) : parseObjectRow<T>(fields, row, cast)
  )
}

function decodeRow(row: QueryResultRow): Array<string | null> {
  const values = row.values ? atob(row.values) : ''
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
    case 'GEOMETRY':
      return value
    case 'JSON':
      return JSON.parse(decode(value))
    default:
      return decode(value)
  }
}
