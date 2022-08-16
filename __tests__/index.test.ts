import SqlString from 'sqlstring'
import { cast, connect, format, hex, ExecutedQuery, DatabaseError } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'
import packageJSON from '../package.json'

const mockHost = 'https://example.com'

const CREATE_SESSION_PATH = '/psdb.v1alpha1.Database/CreateSession'
const EXECUTE_PATH = '/psdb.v1alpha1.Database/Execute'
const config = {
  username: 'someuser',
  password: 'password',
  host: 'example.com',
  fetch
}

const mockAgent = new MockAgent()
mockAgent.disableNetConnect()

setGlobalDispatcher(mockAgent)

// Provide the base url to the request
const mockPool = mockAgent.get(mockHost)
const mockSession = 42

describe('config', () => {
  test('parses database url', async () => {
    const mockResponse = {
      session: mockSession,
      result: { fields: [], rows: [] }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      expect(opts.headers['authorization']).toEqual(`Basic ${btoa('someuser:password')}`)
      expect(opts.headers['user-agent']).toEqual(`database-js/${packageJSON.version}`)
      return mockResponse
    })

    const connection = connect({ fetch, url: 'mysql://someuser:password@example.com' })
    const got = await connection.execute('SELECT 1 from dual;')
    expect(got).toBeDefined()
  })
})

describe('execute', () => {
  test('it properly returns and decodes a select query', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      rows: [{ ':vtg1': 1 }],
      error: null,
      size: 1,
      statement: 'SELECT 1 from dual;',
      time: 1,
      rowsAffected: null,
      insertId: null
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      expect(opts.headers['authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT 1 from dual;')
    got.time = 1

    expect(got).toEqual(want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      expect(opts.headers['authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT 1 from dual;')
    got2.time = 1

    expect(got2).toEqual(want)
  })

  test('it properly returns an executed query for a DDL statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {}
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = 'CREATE TABLE `foo` (bar json);'
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      rows: [],
      rowsAffected: null,
      insertId: null,
      error: null,
      size: 0,
      statement: query,
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute(query)
    got.time = 1

    expect(got).toEqual(want)
  })

  test('it properly returns an executed query for an UPDATE statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        rowsAffected: '1'
      }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "UPDATE `foo` SET bar='planetscale'"
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      rows: [],
      rowsAffected: 1,
      insertId: null,
      error: null,
      size: 0,
      statement: query,
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute(query)
    got.time = 1

    expect(got).toEqual(want)
  })

  test('it properly returns an executed query for an INSERT statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        rowsAffected: '1',
        insertId: '2'
      }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "INSERT INTO `foo` (bar) VALUES ('planetscale');"
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      rows: [],
      rowsAffected: 1,
      insertId: '2',
      error: null,
      size: 0,
      statement: query,
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute(query)
    got.time = 1

    expect(got).toEqual(want)
  })

  test('it properly returns network errors when unauthenticated', async () => {
    const mockError = { code: 'unauthenticated', message: 'invalid auth credentials' }

    const mockResponse = {
      session: mockSession,
      error: mockError
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(401, mockResponse)

    const connection = connect(config)
    try {
      await connection.execute('SELECT * from foo;')
    } catch (err) {
      expect(err).toEqual(new DatabaseError(mockError.message, 401, mockError))
    }
  })

  test('it properly returns network errors when not json', async () => {
    const mockError = {
      code: 'internal',
      message: 'Internal Server Error'
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(500, mockError)

    const connection = connect(config)
    try {
      await connection.execute('SELECT * from foo;')
    } catch (err) {
      expect(err).toEqual(new DatabaseError(mockError.message, 500, mockError))
    }
  })

  test('it properly returns an error from the API', async () => {
    const mockError = {
      message:
        'target: test.0.primary: vttablet: rpc error: code = NotFound desc = Table \'vt_test_0.foo\' doesn\'t exist (errno 1146) (sqlstate 42S02) (CallerID: unsecure_grpc_client): Sql: "select * from foo", BindVars: {#maxLimit: "type:INT64 value:\\"10001\\""}',
      code: 'NOT_FOUND'
    }

    const mockResponse = {
      session: mockSession,
      error: mockError
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const want: ExecutedQuery = {
      headers: [],
      types: {},
      rows: [],
      size: 0,
      insertId: null,
      rowsAffected: null,
      error: mockError,
      statement: 'SELECT * from foo;',
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute('SELECT * from foo;')
    got.time = 1

    expect(got).toEqual(want)
  })

  test('it properly escapes query parameters', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      rows: [{ ':vtg1': 1 }],
      types: { ':vtg1': 'INT32' },
      size: 1,
      error: null,
      insertId: null,
      rowsAffected: null,
      statement: "SELECT 1 from dual where foo = 'bar';",
      time: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT ? from dual where foo = ?;', [1, 'bar'])
    got.time = 1

    expect(got).toEqual(want)
  })

  test('it uses custom format function', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      rows: [{ ':vtg1': 1 }],
      size: 1,
      error: null,
      insertId: null,
      rowsAffected: null,
      statement: 'select `login`, `email` from `users` where id = 42',
      time: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })

    const connection = connect({ ...config, format: SqlString.format })
    const got = await connection.execute('select ?? from ?? where id = ?', [['login', 'email'], 'users', 42])
    got.time = 1

    expect(got).toEqual(want)
  })

  test('uses custom cast function', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT64' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT64' },
      rows: [{ ':vtg1': BigInt(1) }],
      size: 1,
      error: null,
      insertId: null,
      rowsAffected: null,
      statement: 'select 1 from dual',
      time: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })

    const inflate = (field, value) => (field.type === 'INT64' ? BigInt(value) : value)
    const connection = connect({ ...config, cast: inflate })
    const got = await connection.execute('select 1 from dual')
    got.time = 1

    expect(got).toEqual(want)
  })

  test('parses json column values', async () => {
    const document = JSON.stringify({ answer: 42 })

    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: 'document', type: 'JSON' }],
        rows: [{ lengths: [String(document.length)], values: btoa(document) }]
      }
    }

    const want: ExecutedQuery = {
      headers: ['document'],
      types: { document: 'JSON' },
      rows: [{ document: JSON.parse(document) }],
      size: 1,
      error: null,
      insertId: null,
      rowsAffected: null,
      statement: 'select document from documents',
      time: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('select document from documents')
    got.time = 1

    expect(got).toEqual(want)
  })
})

describe('refresh', () => {
  test('it sets the session variable when true', async () => {
    const connection = connect(config)
    mockPool.intercept({ path: CREATE_SESSION_PATH, method: 'POST' }).reply(200, JSON.stringify(mockSession))
    await connection.refresh()
  })
})

describe('format', () => {
  test('exports format function', () => {
    const query = 'select 1 from user where id=?'
    const expected = 'select 1 from user where id=42'
    expect(format(query, [42])).toEqual(expected)
  })
})

describe('hex', () => {
  test('exports hex function', () => {
    expect(hex('\0')).toEqual('0x00')
  })
})

describe('cast', () => {
  test('casts int to number', () => {
    expect(cast({ name: 'test', type: 'INT8' }, '12')).toEqual(12)
  })
})
