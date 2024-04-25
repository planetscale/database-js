import SqlString from 'sqlstring'
import { cast, connect, format, hex, DatabaseError, type Cast } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'
import packageJSON from '../package.json'

import goldenTestdbJSON from '../golden/testdb.json'
import goldenDualJSON from '../golden/dual.json'

const mockHosts = ['http://localhost:8080', 'https://example.com']
const CREATE_SESSION_PATH = '/psdb.v1alpha1.Database/CreateSession'
const EXECUTE_PATH = '/psdb.v1alpha1.Database/Execute'
const config = {
  username: 'someuser',
  password: 'password',
  host: 'example.com',
  fetch
}

function uint8ArrayFromHex(text: string): Uint8Array {
  if (text.startsWith('0x')) {
    text = text.slice(2)
  }
  return Uint8Array.from((text.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)))
}

const mockAgent = new MockAgent()
mockAgent.disableNetConnect()

setGlobalDispatcher(mockAgent)

// Provide the base url to the request
const mockPool = mockAgent.get((value) => mockHosts.includes(value))
const mockSession = 42

describe('config', () => {
  test('parses database url', async () => {
    const mockResponse = {
      session: mockSession,
      result: { fields: [], rows: [] }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toEqual(`Basic ${btoa('someuser:password')}`)
      expect(opts.headers['User-Agent']).toEqual(`database-js/${packageJSON.version}`)
      return mockResponse
    })

    const connection = connect({ fetch, url: 'mysql://someuser:password@example.com' })
    const got = await connection.execute('SELECT 1 from dual;')
    expect(got).toBeDefined()
  })

  test('parses database URL when using HTTP', async () => {
    const mockResponse = {
      session: mockSession,
      result: { fields: [], rows: [] }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toEqual(`Basic ${btoa('someuser:password')}`)
      expect(opts.headers['User-Agent']).toEqual(`database-js/${packageJSON.version}`)
      return mockResponse
    })

    const connection = connect({ fetch, url: 'http://someuser:password@localhost:8080' })
    const got = await connection.execute('SELECT 1 from dual;')
    expect(got).toBeDefined()
  })

  test('exposes config as a public field', async () => {
    const config = { url: 'mysql://someuser:password@example.com/db' }
    const connection = connect(config)
    expect(connection.config).toEqual({
      host: 'example.com',
      username: 'someuser',
      password: 'password',
      url: 'mysql://someuser:password@example.com/db'
    })
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
      timing: 1
    }

    const want = {
      headers: [':vtg1', 'null'],
      types: { ':vtg1': 'INT32', null: 'NULL' },
      fields: [
        { name: ':vtg1', type: 'INT32' },
        { name: 'null', type: 'NULL' }
      ],
      rows: [{ ':vtg1': 1, null: null }],
      size: 1,
      statement: 'SELECT 1, null from dual;',
      rowsAffected: 0,
      insertId: '0',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT 1, null from dual;')

    expect(got).toEqual(want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT 1, null from dual;')

    expect(got2).toEqual(want)
  })

  test('it properly returns and decodes a select query (select null)', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: 'null' }],
        rows: [{ lengths: ['-1'] }]
      },
      timing: 1
    }

    const want = {
      headers: ['null'],
      types: { null: 'NULL' },
      fields: [{ name: 'null', type: 'NULL' }],
      rows: [{ null: null }],
      size: 1,
      statement: 'SELECT null',
      rowsAffected: 0,
      insertId: '0',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT null')

    expect(got).toEqual(want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT null')

    expect(got2).toEqual(want)
  })

  test('it properly returns and decodes a select query with rows as array when designated', async () => {
    const mockResponse = {
      session: mockSession,
      result: {
        fields: [{ name: ':vtg1', type: 'INT32' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1
    }

    const want = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      rows: [[1]],
      fields: [{ name: ':vtg1', type: 'INT32' }],
      size: 1,
      statement: 'SELECT 1 from dual;',
      time: 1000,
      rowsAffected: 0,
      insertId: '0'
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
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
    const want = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: 0,
      insertId: '0',
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
      timing: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "UPDATE `foo` SET bar='planetscale'"
    const want = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: 1,
      insertId: '0',
      size: 0,
      statement: query,
      time: 1000
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
      timing: 1
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    const query = "INSERT INTO `foo` (bar) VALUES ('planetscale');"
    const want = {
      headers: [],
      types: {},
      fields: [],
      rows: [],
      rowsAffected: 1,
      insertId: '2',
      size: 0,
      statement: query,
      time: 1000
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
      timing: 1
    }

    const want = {
      headers: [':vtg1'],
      rows: [{ ':vtg1': 1 }],
      types: { ':vtg1': 'INT32' },
      fields: [{ name: ':vtg1', type: 'INT32' }],
      size: 1,
      insertId: '0',
      rowsAffected: 0,
      statement: "SELECT 1 from dual where foo = 'bar';",
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
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
      timing: 1
    }

    const want = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT32' },
      fields: [{ name: ':vtg1', type: 'INT32' }],
      rows: [{ ':vtg1': 1 }],
      size: 1,
      insertId: '0',
      rowsAffected: 0,
      statement: 'select `login`, `email` from `users` where id = 42',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
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
      timing: 1
    }

    const want = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT64' },
      fields: [{ name: ':vtg1', type: 'INT64' }],
      rows: [{ ':vtg1': BigInt(1) }],
      size: 1,
      insertId: '0',
      rowsAffected: 0,
      statement: 'select 1 from dual',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })

    const inflate: Cast = (field, value) => (field.type === 'INT64' ? BigInt(value as string) : value)
    const connection = connect({ ...config, cast: inflate })
    const got = await connection.execute('select 1 from dual')

    expect(got).toEqual(want)
  })

  test('uses custom cast function when it is passed to execute', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [{ name: ':vtg1', type: 'INT64' }],
        rows: [{ lengths: ['1'], values: 'MQ==' }]
      },
      timing: 1
    }

    const want = {
      headers: [':vtg1'],
      types: { ':vtg1': 'INT64' },
      fields: [{ name: ':vtg1', type: 'INT64' }],
      rows: [{ ':vtg1': 'I am a biggish int' }],
      size: 1,
      insertId: '0',
      rowsAffected: 0,
      statement: 'select 1 from dual',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.query).toEqual(want.statement)
      return mockResponse
    })
    const connInflate: Cast = (field, value) => (field.type === 'INT64' ? 'I am a biggish int' : value)
    const inflate: Cast = (field, value) => (field.type === 'INT64' ? BigInt(value as string) : value)
    const connection = connect({ ...config, cast: inflate })
    const got = await connection.execute('select 1 from dual', {}, { cast: connInflate })

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
      timing: 1
    }

    const want = {
      headers: ['document'],
      types: { document: 'JSON' },
      fields: [{ name: 'document', type: 'JSON' }],
      rows: [{ document: JSON.parse(document) }],
      size: 1,
      insertId: '0',
      rowsAffected: 0,
      statement: 'select document from documents',
      time: 1000
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
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

  test('casts float to number', () => {
    expect(cast({ name: 'test', type: 'FLOAT32' }, '2.32')).toEqual(2.32)
    expect(cast({ name: 'test', type: 'FLOAT64' }, '2.32')).toEqual(2.32)
  })

  test('casts binary data to array of 8-bit unsigned integers', () => {
    expect(cast({ name: 'test', type: 'BLOB', charset: 63 }, '')).toEqual(new Uint8Array([]))
    expect(cast({ name: 'test', type: 'BLOB', charset: 63 }, 'Å')).toEqual(new Uint8Array([197]))
    expect(cast({ name: 'test', type: 'VARBINARY', charset: 63 }, 'Å')).toEqual(new Uint8Array([197]))
  })

  test('casts binary text data to text', () => {
    expect(cast({ name: 'test', type: 'VARBINARY', charset: 255 }, 'table')).toEqual('table')
  })

  test('casts JSON string to JSON object', () => {
    expect(cast({ name: 'test', type: 'JSON' }, '{ "foo": "bar" }')).toStrictEqual({ foo: 'bar' })
  })
})

describe('parse e2e', () => {
  test('golden (testdb.json)', async () => {
    const mockResponse = {
      session: mockSession,
      result: goldenTestdbJSON,
      timing: 1
    }

    const want = {
      id: '1',
      a: 1,
      b: 1,
      c: 1,
      d: 1,
      e: '1',
      f: '1.1',
      g: '1.1',
      h: 1.1,
      i: 1.1,
      j: uint8ArrayFromHex('0x07'),
      k: '1000-01-01',
      l: '1000-01-01 01:01:01',
      m: '1970-01-01 00:01:01',
      n: '01:01:01',
      o: 2006,
      p: 'p',
      q: 'q',
      r: uint8ArrayFromHex('0x72000000'),
      s: uint8ArrayFromHex('0x73'),
      t: uint8ArrayFromHex('0x74'),
      u: uint8ArrayFromHex('0x75'),
      v: uint8ArrayFromHex('0x76'),
      w: uint8ArrayFromHex('0x77'),
      x: 'x',
      y: 'y',
      z: 'z',
      aa: 'aa',
      ab: 'foo',
      ac: 'foo,bar',
      ad: { ad: null },
      ae: uint8ArrayFromHex(
        '0x0000000001020000000300000000000000000000000000000000000000000000000000F03F000000000000F03F00000000000000400000000000000000'
      ),
      af: uint8ArrayFromHex('0x000000000101000000000000000000F03F000000000000F03F'),
      ag: uint8ArrayFromHex(
        '0x0000000001020000000300000000000000000000000000000000000000000000000000F03F000000000000F03F00000000000000400000000000000000'
      ),
      ah: uint8ArrayFromHex(
        '0x00000000010300000002000000040000000000000000000000000000000000000000000000000000000000000000000840000000000000084000000000000000000000000000000000000000000000000004000000000000000000F03F000000000000F03F000000000000F03F00000000000000400000000000000040000000000000F03F000000000000F03F000000000000F03F'
      ),
      ai: 1,
      aj: 1,
      ak: 1,
      al: '1',
      xa: 'xa',
      xb: 'xb',
      xc: uint8ArrayFromHex('0x78630000'),
      xd: 'xd',
      NULL: null
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('xxx')

    expect(got.rows[0]).toEqual(want)
  })

  test('golden (dual.json)', async () => {
    const mockResponse = {
      session: mockSession,
      result: goldenDualJSON,
      timing: 1
    }

    const want = {
      a: 'ÿ'
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      expect(opts.headers['Authorization']).toMatch(/Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      expect(bodyObj.session).toEqual(null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('xxx')

    expect(got.rows[0]).toEqual(want)
  })
})
