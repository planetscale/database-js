import { connect, ExecutedQuery } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'

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

describe('execute', () => {
  test('it properly returns and decodes a response', async () => {
    const mockSession = {
      signature: 'V6cmWP8EOlhUQFB1Ca/IsRQoKGDpHmuNhAdn1ObLrCE=',
      vitessSession: {
        autocommit: true,
        options: {
          includedFields: 'ALL',
          clientFoundRows: true
        },
        foundRows: '1',
        rowCount: '-1',
        DDLStrategy: 'direct',
        SessionUUID: 'dbtDuhIRDpZPzDUkgXIuzg',
        enableSystemSettings: true
      }
    }

    const mockResponse = {
      session: mockSession,
      result: {
        fields: [
          {
            name: ':vtg1',
            type: 'INT64'
          }
        ],
        rows: [
          {
            lengths: ['1'],
            values: 'MQ=='
          }
        ]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      rows: [
        {
          ':vtg1': 1
        }
      ],
      size: 1,
      statement: 'SELECT 1 from dual;',
      time: 1
    }

    mockPool
      .intercept({
        path: EXECUTE_PATH,
        method: 'POST'
      })
      .reply(200, mockResponse)

    const connection = connect(config)
    const got = await connection.execute('SELECT 1 from dual;')
    got.time = 1

    expect(got).toEqual(want)

    mockPool
      .intercept({
        path: EXECUTE_PATH,
        method: 'POST'
      })
      .reply(200, (opts) => {
        expect(opts.headers).toContain('authorization')
        const bodyObj = JSON.parse(opts.body.toString())
        expect(bodyObj.session).toEqual(mockSession)
        return mockResponse
      })

    const got2 = await connection.execute('SELECT 1 from dual;')
    got2.time = 1

    expect(got2).toEqual(want)
  })

  test('it properly escapes query parameters', async () => {
    const mockResponse = {
      session: null,
      result: {
        fields: [
          {
            name: ':vtg1',
            type: 'INT64'
          }
        ],
        rows: [
          {
            lengths: ['1'],
            values: 'MQ=='
          }
        ]
      }
    }

    const want: ExecutedQuery = {
      headers: [':vtg1'],
      rows: [
        {
          ':vtg1': 1
        }
      ],
      size: 1,
      statement: "SELECT 1 from dual where foo = 'bar';",
      time: 1
    }

    mockPool
      .intercept({
        path: EXECUTE_PATH,
        method: 'POST'
      })
      .reply(200, (opts) => {
        const bodyObj = JSON.parse(opts.body.toString())
        expect(bodyObj.query).toEqual(want.statement)
        return mockResponse
      })

    const connection = connect(config)
    const got = await connection.execute('SELECT ? from dual where foo = ?;', [1, 'bar'])
    got.time = 1

    expect(got).toEqual(want)
  })
})

describe('refresh', () => {
  test('it sets the session variable when true', async () => {
    const connection = connect(config)
    const mockSession = {
      signature: 'testvitesssession',
      vitessSession: {
        autocommit: true,
        options: {
          includedFields: 'ALL',
          clientFoundRows: true
        },
        DDLStrategy: 'direct',
        SessionUUID: 'Z2zXmUvMs64GwM9pcaUMhQ',
        enableSystemSettings: true
      }
    }

    mockPool
      .intercept({
        path: CREATE_SESSION_PATH,
        method: 'POST'
      })
      .reply(200, mockSession)

    const got = await connection.refresh()

    expect(got).toEqual(true)
  })
})
