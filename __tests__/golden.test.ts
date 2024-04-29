import { connect } from '../dist/index'
import { fetch, MockAgent, setGlobalDispatcher } from 'undici'

import database from '../golden/database.json'
import dual from '../golden/dual.json'

const mockHosts = ['http://localhost:8080', 'https://example.com']
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

describe('golden', () => {
  test('runs e2e database tests', async () => {
    const mockResponse = {
      session: mockSession,
      result: database,
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
      ad: { ad: null, foo: 'ü' },
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

  test('runs e2e dual tests', async () => {
    const mockResponse = {
      session: mockSession,
      result: dual,
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

function uint8ArrayFromHex(text: string) {
  if (text.startsWith('0x')) {
    text = text.slice(2)
  }
  return Uint8Array.from((text.match(/.{1,2}/g) ?? []).map((byte) => parseInt(byte, 16)))
}
