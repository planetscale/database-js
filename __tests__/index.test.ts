import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { Client, connect, hex, DatabaseError, UnknownError, type Cast } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'
import packageJSON from '../package.json'

const mockHosts = ['http://localhost:8080', 'https://example.com']
const CREATE_SESSION_PATH = '/psdb.v1alpha1.Database/CreateSession'
const EXECUTE_PATH = '/psdb.v1alpha1.Database/Execute'

const mockAgent = new MockAgent()
mockAgent.disableNetConnect()

setGlobalDispatcher(mockAgent)

const config = {
  username: 'someuser',
  password: 'password',
  host: 'example.com',
  fetch
}

// Provide the base url to the request
const mockPool = mockAgent.get((value) => mockHosts.includes(value))
const mockSession = 42

function assertDatabaseError(err: unknown, message: string, status: number, body: { code?: string; message: string }) {
  assert.ok(err instanceof DatabaseError)
  assert.strictEqual(err.message, message)
  assert.strictEqual(err.status, status)
  assert.deepStrictEqual(err.body, body)
}

describe('config', () => {
  test('parses database url', async () => {
    const mockResponse = {
      session: mockSession,
      result: { fields: [], rows: [] }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      assert.deepStrictEqual(opts.headers['Authorization'], `Basic ${btoa('someuser:password')}`)
      assert.deepStrictEqual(opts.headers['User-Agent'], `database-js/${packageJSON.version}`)
      return mockResponse
    })

    const connection = connect({ fetch, url: 'mysql://someuser:password@example.com' })
    const got = await connection.execute('SELECT 1 from dual;')
    assert.notStrictEqual(got, undefined)
  })

  test('parses database URL when using HTTP', async () => {
    const mockResponse = {
      session: mockSession,
      result: { fields: [], rows: [] }
    }

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      assert.deepStrictEqual(opts.headers['Authorization'], `Basic ${btoa('someuser:password')}`)
      assert.deepStrictEqual(opts.headers['User-Agent'], `database-js/${packageJSON.version}`)
      return mockResponse
    })

    const connection = connect({ fetch, url: 'http://someuser:password@localhost:8080' })
    const got = await connection.execute('SELECT 1 from dual;')
    assert.notStrictEqual(got, undefined)
  })

  test('exposes config as a public field', async () => {
    const config = { url: 'mysql://someuser:password@example.com/db' }
    const connection = connect(config)
    assert.deepStrictEqual(connection.config, {
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

    assert.deepStrictEqual(numRequests, 3)
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
      return { error: mockError }
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
      assert.fail('expected transaction to throw')
    } catch (err) {
      assert.deepStrictEqual(numRequests, 4)
      assertDatabaseError(err, mockError.message, 401, mockError)
    }
  })
})

// A fetch that answers every Execute with the session number of the request it
// is answering, records what each request carried, and lets a test hold a
// response open until it decides to release it.
function sessionTrackingFetch() {
  const requests: Array<{ query: string; session: unknown }> = []
  const holds = new Map<string, () => void>()
  let nextSession = 0
  const fetchImpl = async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    requests.push({ query: body.query, session: body.session })
    const session = ++nextSession
    await new Promise<void>((resolve) => {
      if (holds.has(body.query)) {
        holds.set(body.query, resolve)
      } else {
        resolve()
      }
    })
    const payload =
      body.query === 'FAIL'
        ? { session, error: { code: 'aborted', message: 'query failed' } }
        : { session, result: { fields: [], rows: [] } }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return {
    requests,
    fetch: fetchImpl as any,
    hold(query: string) {
      holds.set(query, () => {})
    },
    release(query: string) {
      const resolve = holds.get(query)
      holds.delete(query)
      if (resolve) resolve()
    }
  }
}

describe('connection serialization', () => {
  test('queries on one connection run one after another, each with the previous session', async () => {
    const tracker = sessionTrackingFetch()
    tracker.hold('SELECT 1')
    const connection = connect({ ...config, fetch: tracker.fetch })

    const first = connection.execute('SELECT 1')
    const second = connection.execute('SELECT 2')
    await new Promise((resolve) => setTimeout(resolve, 10))

    // The second query must not have been sent while the first is still in flight.
    assert.deepStrictEqual(
      tracker.requests.map((r) => r.query),
      ['SELECT 1']
    )

    tracker.release('SELECT 1')
    await Promise.all([first, second])

    assert.deepStrictEqual(tracker.requests, [
      { query: 'SELECT 1', session: null },
      { query: 'SELECT 2', session: 1 }
    ])
  })

  test('a failed query does not block the queries behind it', async () => {
    const tracker = sessionTrackingFetch()
    const connection = connect({ ...config, fetch: tracker.fetch })

    const failed = connection.execute('FAIL')
    const after = connection.execute('SELECT 2')

    await assert.rejects(failed, DatabaseError)
    await after
    assert.deepStrictEqual(
      tracker.requests.map((r) => [r.query, r.session]),
      [
        ['FAIL', null],
        ['SELECT 2', 1]
      ]
    )
  })

  test('rollback waits for a query the callback did not await and runs on its session', async () => {
    const tracker = sessionTrackingFetch()
    tracker.hold('UPDATE junk SET i = i + 1')
    const connection = connect({ ...config, fetch: tracker.fetch })

    let pending: Promise<unknown> | undefined
    const transaction = connection.transaction(async (tx) => {
      pending = tx.execute('UPDATE junk SET i = i + 1')
      // The callback fails while the query is still running.
      await new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 5))
    })
    const outcome = transaction.then(
      () => 'resolved',
      (err: Error) => err.message
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    // BEGIN and the update were sent; ROLLBACK is still waiting on the update.
    assert.deepStrictEqual(
      tracker.requests.map((r) => r.query),
      ['BEGIN', 'UPDATE junk SET i = i + 1']
    )

    tracker.release('UPDATE junk SET i = i + 1')
    assert.strictEqual(await outcome, 'boom')
    await pending

    assert.deepStrictEqual(tracker.requests, [
      { query: 'BEGIN', session: null },
      { query: 'UPDATE junk SET i = i + 1', session: 1 },
      { query: 'ROLLBACK', session: 2 }
    ])
  })

  test('commit runs after every query the callback started', async () => {
    const tracker = sessionTrackingFetch()
    const connection = connect({ ...config, fetch: tracker.fetch })

    await connection.transaction(async (tx) => {
      // Not awaited: the queue still orders them before COMMIT.
      void tx.execute('INSERT INTO t VALUES (1)')
      void tx.execute('INSERT INTO t VALUES (2)')
    })

    assert.deepStrictEqual(
      tracker.requests.map((r) => [r.query, r.session]),
      [
        ['BEGIN', null],
        ['INSERT INTO t VALUES (1)', 1],
        ['INSERT INTO t VALUES (2)', 2],
        ['COMMIT', 3]
      ]
    )
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
      assert.match(opts.headers['Authorization'], /Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      assert.deepStrictEqual(bodyObj.session, null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT 1, null from dual;')

    assert.deepStrictEqual(got, want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      assert.match(opts.headers['Authorization'], /Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      assert.deepStrictEqual(bodyObj.session, mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT 1, null from dual;')

    assert.deepStrictEqual(got2, want)
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
      assert.match(opts.headers['Authorization'], /Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      assert.deepStrictEqual(bodyObj.session, null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT null')

    assert.deepStrictEqual(got, want)

    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, (opts: any) => {
      assert.match(opts.headers['Authorization'], /Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      assert.deepStrictEqual(bodyObj.session, mockSession)
      return mockResponse
    })

    const got2 = await connection.execute('SELECT null')

    assert.deepStrictEqual(got2, want)
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
      assert.match(opts.headers['Authorization'], /Basic /)
      const bodyObj = JSON.parse(opts.body.toString())
      assert.deepStrictEqual(bodyObj.session, null)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('SELECT 1 from dual;', { as: 'array' })

    assert.deepStrictEqual(got, want)
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

    assert.deepStrictEqual(got, want)
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

    assert.deepStrictEqual(got, want)
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

    assert.deepStrictEqual(got, want)
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
      assert.fail('expected execute to throw')
    } catch (err) {
      assertDatabaseError(err, mockError.message, 401, mockError)
    }
  })

  test('it returns UnknownError for non-JSON error responses', async () => {
    mockPool
      .intercept({ path: EXECUTE_PATH, method: 'POST' })
      .reply(500, '<html>Bad Gateway</html>', { headers: { 'content-type': 'text/html' } })

    const connection = connect(config)
    try {
      await connection.execute('SELECT * from foo;')
      assert.fail('Expected UnknownError')
    } catch (err) {
      assert.ok(err instanceof UnknownError)
      assert.ok(err instanceof DatabaseError)
      const upstream = err as InstanceType<typeof UnknownError>
      assert.deepStrictEqual(upstream.status, 500)
      assert.deepStrictEqual(upstream.context.body, '<html>Bad Gateway</html>')
      assert.deepStrictEqual(upstream.context.status, 500)
      assert.match(upstream.message, /Expected JSON response/)
    }
  })

  test('it returns UnknownError for JSON without error field', async () => {
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(500, { code: 'internal', message: 'oops' })

    const connection = connect(config)
    try {
      await connection.execute('SELECT * from foo;')
      assert.fail('Expected UnknownError')
    } catch (err) {
      assert.ok(err instanceof UnknownError)
      assert.ok(err instanceof DatabaseError)
      const upstream = err as InstanceType<typeof UnknownError>
      assert.deepStrictEqual(upstream.status, 500)
      assert.ok(upstream.context.body.includes('internal'))
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
      assert.fail('expected execute to throw')
    } catch (err) {
      assertDatabaseError(err, mockError.message, 400, mockError)
    }
  })

  test('it rejects query parameters', async () => {
    const connection = connect(config)
    const message = /Query parameters are not supported/

    await assert.rejects(connection.execute('SELECT ? from dual', [1] as any), message)
    await assert.rejects(connection.execute('SELECT :id from dual', { id: 1 } as any), message)
    await assert.rejects((connection.execute as any)('SELECT 1 from dual', null, { as: 'array' }), message)
  })

  test('it rejects query parameters in transactions and clients', async () => {
    const message = /Query parameters are not supported/

    await assert.rejects(new Client(config).execute('SELECT ? from dual', [1] as any), message)

    // BEGIN and ROLLBACK
    const mockResponse = { session: null, result: null, timing: 1 }
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)
    mockPool.intercept({ path: EXECUTE_PATH, method: 'POST' }).reply(200, mockResponse)

    await assert.rejects(
      connect(config).transaction((tx) => tx.execute('SELECT ? from dual', [1] as any)),
      message
    )
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
      assert.deepStrictEqual(bodyObj.query, want.statement)
      return mockResponse
    })

    const inflate: Cast = (field, value) => (field.type === 'INT64' ? BigInt(value as string) : value)
    const connection = connect({ ...config, cast: inflate })
    const got = await connection.execute('select 1 from dual')

    assert.deepStrictEqual(got, want)
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
      assert.deepStrictEqual(bodyObj.query, want.statement)
      return mockResponse
    })
    const connInflate: Cast = (field, value) => (field.type === 'INT64' ? 'I am a biggish int' : value)
    const inflate: Cast = (field, value) => (field.type === 'INT64' ? BigInt(value as string) : value)
    const connection = connect({ ...config, cast: inflate })
    const got = await connection.execute('select 1 from dual', { cast: connInflate })

    assert.deepStrictEqual(got, want)
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
      assert.deepStrictEqual(bodyObj.query, want.statement)
      return mockResponse
    })

    const connection = connect(config)
    const got = await connection.execute('select document from documents')

    assert.deepStrictEqual(got, want)
  })
})

describe('refresh', () => {
  test('it sets the session variable when true', async () => {
    const connection = connect(config)
    mockPool.intercept({ path: CREATE_SESSION_PATH, method: 'POST' }).reply(200, JSON.stringify(mockSession))
    await connection.refresh()
  })
})

describe('hex', () => {
  test('exports hex function', () => {
    assert.deepStrictEqual(hex('\0'), '0x00')
  })
})
