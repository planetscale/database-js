import SqlString from 'sqlstring'
import { cast, connect, format, hex, DatabaseError, type Cast } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'
import packageJSON from '../package.json'

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
      result: JSON.parse(
        '{"fields":[{"name":"id","type":"INT64","table":"test","orgTable":"test","database":"mattdb","orgName":"id","columnLength":20,"charset":63,"flags":49667},{"name":"a","type":"INT8","table":"test","orgTable":"test","database":"mattdb","orgName":"a","columnLength":4,"charset":63,"flags":32768},{"name":"b","type":"INT16","table":"test","orgTable":"test","database":"mattdb","orgName":"b","columnLength":6,"charset":63,"flags":32768},{"name":"c","type":"INT24","table":"test","orgTable":"test","database":"mattdb","orgName":"c","columnLength":9,"charset":63,"flags":32768},{"name":"d","type":"INT32","table":"test","orgTable":"test","database":"mattdb","orgName":"d","columnLength":11,"charset":63,"flags":32768},{"name":"e","type":"INT64","table":"test","orgTable":"test","database":"mattdb","orgName":"e","columnLength":20,"charset":63,"flags":32768},{"name":"f","type":"DECIMAL","table":"test","orgTable":"test","database":"mattdb","orgName":"f","columnLength":4,"charset":63,"decimals":1,"flags":32768},{"name":"g","type":"DECIMAL","table":"test","orgTable":"test","database":"mattdb","orgName":"g","columnLength":4,"charset":63,"decimals":1,"flags":32768},{"name":"h","type":"FLOAT32","table":"test","orgTable":"test","database":"mattdb","orgName":"h","columnLength":12,"charset":63,"decimals":31,"flags":32768},{"name":"i","type":"FLOAT64","table":"test","orgTable":"test","database":"mattdb","orgName":"i","columnLength":22,"charset":63,"decimals":31,"flags":32768},{"name":"j","type":"BIT","table":"test","orgTable":"test","database":"mattdb","orgName":"j","columnLength":3,"charset":63,"flags":32},{"name":"k","type":"DATE","table":"test","orgTable":"test","database":"mattdb","orgName":"k","columnLength":10,"charset":63,"flags":128},{"name":"l","type":"DATETIME","table":"test","orgTable":"test","database":"mattdb","orgName":"l","columnLength":19,"charset":63,"flags":128},{"name":"m","type":"TIMESTAMP","table":"test","orgTable":"test","database":"mattdb","orgName":"m","columnLength":19,"charset":63,"flags":128},{"name":"n","type":"TIME","table":"test","orgTable":"test","database":"mattdb","orgName":"n","columnLength":10,"charset":63,"flags":128},{"name":"o","type":"YEAR","table":"test","orgTable":"test","database":"mattdb","orgName":"o","columnLength":4,"charset":63,"flags":32864},{"name":"p","type":"CHAR","table":"test","orgTable":"test","database":"mattdb","orgName":"p","columnLength":16,"charset":255},{"name":"q","type":"VARCHAR","table":"test","orgTable":"test","database":"mattdb","orgName":"q","columnLength":16,"charset":255},{"name":"r","type":"BINARY","table":"test","orgTable":"test","database":"mattdb","orgName":"r","columnLength":4,"charset":63,"flags":128},{"name":"s","type":"VARBINARY","table":"test","orgTable":"test","database":"mattdb","orgName":"s","columnLength":4,"charset":63,"flags":128},{"name":"t","type":"BLOB","table":"test","orgTable":"test","database":"mattdb","orgName":"t","columnLength":255,"charset":63,"flags":144},{"name":"u","type":"BLOB","table":"test","orgTable":"test","database":"mattdb","orgName":"u","columnLength":65535,"charset":63,"flags":144},{"name":"v","type":"BLOB","table":"test","orgTable":"test","database":"mattdb","orgName":"v","columnLength":16777215,"charset":63,"flags":144},{"name":"w","type":"BLOB","table":"test","orgTable":"test","database":"mattdb","orgName":"w","columnLength":4294967295,"charset":63,"flags":144},{"name":"x","type":"TEXT","table":"test","orgTable":"test","database":"mattdb","orgName":"x","columnLength":1020,"charset":255,"flags":16},{"name":"y","type":"TEXT","table":"test","orgTable":"test","database":"mattdb","orgName":"y","columnLength":262140,"charset":255,"flags":16},{"name":"z","type":"TEXT","table":"test","orgTable":"test","database":"mattdb","orgName":"z","columnLength":67108860,"charset":255,"flags":16},{"name":"aa","type":"TEXT","table":"test","orgTable":"test","database":"mattdb","orgName":"aa","columnLength":4294967295,"charset":255,"flags":16},{"name":"ab","type":"ENUM","table":"test","orgTable":"test","database":"mattdb","orgName":"ab","columnLength":12,"charset":255,"flags":256},{"name":"ac","type":"SET","table":"test","orgTable":"test","database":"mattdb","orgName":"ac","columnLength":28,"charset":255,"flags":2048},{"name":"ad","type":"JSON","table":"test","orgTable":"test","database":"mattdb","orgName":"ad","columnLength":4294967295,"charset":63,"flags":144},{"name":"ae","type":"GEOMETRY","table":"test","orgTable":"test","database":"mattdb","orgName":"ae","columnLength":4294967295,"charset":63,"flags":144},{"name":"af","type":"GEOMETRY","table":"test","orgTable":"test","database":"mattdb","orgName":"af","columnLength":4294967295,"charset":63,"flags":144},{"name":"ag","type":"GEOMETRY","table":"test","orgTable":"test","database":"mattdb","orgName":"ag","columnLength":4294967295,"charset":63,"flags":144},{"name":"ah","type":"GEOMETRY","table":"test","orgTable":"test","database":"mattdb","orgName":"ah","columnLength":4294967295,"charset":63,"flags":144},{"name":"ai","type":"UINT8","table":"test","orgTable":"test","database":"mattdb","orgName":"ai","columnLength":3,"charset":63,"flags":32800},{"name":"aj","type":"UINT24","table":"test","orgTable":"test","database":"mattdb","orgName":"aj","columnLength":8,"charset":63,"flags":32800},{"name":"ak","type":"UINT32","table":"test","orgTable":"test","database":"mattdb","orgName":"ak","columnLength":10,"charset":63,"flags":32800},{"name":"al","type":"UINT64","table":"test","orgTable":"test","database":"mattdb","orgName":"al","columnLength":20,"charset":63,"flags":32800},{"name":"xa","type":"BINARY","table":"test","orgTable":"test","database":"mattdb","orgName":"xa","columnLength":16,"charset":255,"flags":128},{"name":"xb","type":"BINARY","table":"test","orgTable":"test","database":"mattdb","orgName":"xb","columnLength":16,"charset":255,"flags":128},{"name":"xc","type":"BINARY","table":"test","orgTable":"test","database":"mattdb","orgName":"xc","columnLength":4,"charset":63,"flags":128},{"name":"xd","type":"BLOB","table":"test","orgTable":"test","database":"mattdb","orgName":"xd","columnLength":262140,"charset":255,"flags":144},{"name":"NULL","charset":63,"flags":32896}],"rows":[{"lengths":["1","1","1","1","1","1","3","3","3","3","1","10","19","19","8","4","1","1","4","1","1","1","1","1","1","1","1","2","3","7","12","61","25","61","149","1","1","1","1","2","2","4","2","-1"],"values":"MTExMTExMS4xMS4xMS4xMS4xBzEwMDAtMDEtMDExMDAwLTAxLTAxIDAxOjAxOjAxMTk3MC0wMS0wMSAwMDowMTowMTAxOjAxOjAxMjAwNnBxcgAAAHN0dXZ3eHl6YWFmb29mb28sYmFyeyJhZCI6IG51bGx9AAAAAAECAAAAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADwPwAAAAAAAPA/AAAAAAAAAEAAAAAAAAAAAAAAAAABAQAAAAAAAAAAAPA/AAAAAAAA8D8AAAAAAQIAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPA/AAAAAAAA8D8AAAAAAAAAQAAAAAAAAAAAAAAAAAEDAAAAAgAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIQAAAAAAAAAhAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAPA/AAAAAAAA8D8AAAAAAADwPwAAAAAAAABAAAAAAAAAAEAAAAAAAADwPwAAAAAAAPA/AAAAAAAA8D8xMTExeGF4YnhjAAB4ZA=="}]}',
      ),
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
      result: JSON.parse(
        '{"fields":[{"name":"a","type":"VARCHAR","charset":8,"flags":1}],"rows":[{"lengths":["2"],"values":"w78="}]}',
      ),
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
