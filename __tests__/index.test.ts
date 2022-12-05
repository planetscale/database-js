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

describe('transaction', () => {
  test('it runs a transaction successfully', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }

    let numRequests = 0

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })

    const connection = connect(config)
    await connection.transaction((tx) => {
      return tx.execute('SELECT 1 from dual;')
    })

    expect(numRequests).toEqual(3)
  })

  test('it rolls back when an error occurs', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      }
    }
    const mockError = { code: 'unauthenticated', message: 'invalid auth credentials' }

    let numRequests = 0

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(401, () => {
      numRequests++
      return mockError
    })
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, () => {
      numRequests++
      return mockResponse
    })

    const connection = connect(config)
    try {
      await connection.transaction((tx) => {
        return Promise.all([tx.execute('SELECT 1'), tx.execute('SELECT 1')])
      })
    } catch (err) {
      expect(numRequests).toEqual(4)
      expect(err).toEqual(new DatabaseError('Unauthorized', 401, mockError))
    }
  })
})

describe('execute', () => {
  test('it properly returns and decodes a select query', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }, { name: 'null' }],
        rows: [{ lengths: ['1', '-1'], values: 'MQ==' }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: [':vtg1', 'null'],
      types: { ':vtg1': 'INT32', null: 'NULL' },
      fields: [
        { name: ':vtg1', type: 'INT32' },
        { name: 'null', type: 'NULL' }
      ],
      rows: [{ ':vtg1': 1, null: null }],
      size: 1,
      statement: 'SELECT 1, null from dual;',
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
    const got = await connection.execute('SELECT 1, null from dual;')

    expect(got).toEqual(want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      expect(opts.headers['authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT 1, null from dual;')
    got2.time = 1

    expect(got2).toEqual(want)
  })

  test('it properly returns and decodes a select query (select null)', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: 'null' }],
        rows: [{ lengths: ['-1'] }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: ['null'],
      types: { null: 'NULL' },
      fields: [{ name: 'null', type: 'NULL' }],
      rows: [{ null: null }],
      size: 1,
      statement: 'SELECT null',
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
    const got = await connection.execute('SELECT null')

    expect(got).toEqual(want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts) => {
      expect(opts.headers['authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT null')
    got2.time = 1

    expect(got2).toEqual(want)
  })

  test('it properly returns and decodes a select query with rows as array when designated', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      rows: [[1]],
      fields: [{ name: ':vtg1', type: 'INT32' }],
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
    const got = await connection.execute('SELECT 1 from dual;', null, { as: 'array' })

    expect(got).toEqual(want)
  })

  test('it properly returns an executed query for a DDL statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {},
      timing: 0
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = 'CREATE TABLE `foo` (bar json);'
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: null,
      insertId: null,
      size: 0,
      statement: query,
      time: 0
    }

    const connection = connect(config)
    const got = await connection.execute(query)

    expect(got).toEqual(want)
  })

  test('it properly returns an executed query for an UPDATE statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        rowsAffected: '1'
      },
      timing: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "UPDATE `foo` SET bar='planetscale'"
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: 1,
      insertId: null,
      size: 0,
      statement: query,
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute(query)

    expect(got).toEqual(want)
  })

  test('it properly returns an executed query for an INSERT statement', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        rowsAffected: '1',
        insertId: '2'
      },
      timing: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "INSERT INTO `foo` (bar) VALUES ('planetscale');"
    const want: ExecutedQuery = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: 1,
      insertId: '2',
      size: 0,
      statement: query,
      time: 1
    }

    const connection = connect(config)
    const got = await connection.execute(query)

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

  test('it throws errors returned as a database error', async () => {
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

    const connection = connect(config)
    try {
      await connection.execute('SELECT * from foo;')
    } catch (err) {
      expect(err).toEqual(new DatabaseError(mockError.message, 400, mockError))
    }
  })

  test('it properly escapes query parameters', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      rows: [{ ':vtg1': 1 }],
      types: { ':vtg1': 'INT32' },
      fields: [{ name: ':vtg1', type: 'INT32' }],
      size: 1,
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

    expect(got).toEqual(want)
  })

  test('it uses custom format function', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      fields: [{ name: ':vtg1', type: 'INT32' }],
      rows: [{ ':vtg1': 1 }],
      size: 1,
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

    expect(got).toEqual(want)
  })

  test('uses custom cast function', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT64' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT64' },
      fields: [{ name: ':vtg1', type: 'INT64' }],
      rows: [{ ':vtg1': BigInt(1) }],
      size: 1,
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

    expect(got).toEqual(want)
  })

  test('parses json column values', async () => {
    const document = JSON.stringify({ answer: 42 })

    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: 'document', type: 'JSON' }],
        rows: [{ lengths: [String(document.length)], values: btoa(document) }]
      },
      timing: 1000
    }

    const want: ExecutedQuery = {
      headers: ['document'],
      types: { document: 'JSON' },
      fields: [{ name: 'document', type: 'JSON' }],
      rows: [{ document: JSON.parse(document) }],
      size: 1,
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
