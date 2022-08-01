import { connect } from '../dist/index'
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
  test('reuses the same session', () => {})
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
      .reply(200, (opts) => {
        return mockSession
      })

    const got = await connection.refresh()

    expect(got).toEqual(true)
  })
})
