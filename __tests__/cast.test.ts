import { cast } from '../src/cast'

describe('cast', () => {
  test('casts NULL values', () => {
    expect(
      cast(
        {
          name: 'email',
          type: 'VARCHAR'
        },
        null
      )
    ).toEqual(null)
  })

  test('casts INT64, UINT64 values', () => {
    expect(
      cast(
        {
          name: 'id',
          type: 'UINT64'
        },
        '1'
      )
    ).toEqual('1')
  })

  test('casts DATETIME, DATE, TIMESTAMP, TIME values', () => {
    expect(
      cast(
        {
          name: 'created_at',
          type: 'DATETIME'
        },
        '2024-01-01 00:00:00'
      )
    ).toEqual('2024-01-01 00:00:00')
  })

  test('casts DECIMAL values', () => {
    expect(
      cast(
        {
          name: 'decimal',
          type: 'DECIMAL'
        },
        '5.4'
      )
    ).toEqual('5.4')
  })

  test('casts JSON values', () => {
    expect(
      cast(
        {
          name: 'metadata',
          type: 'JSON'
        },
        '{ "color": "blue" }'
      )
    ).toStrictEqual({ color: 'blue' })
  })

  test('casts INT8, UINT8, INT16, UINT16, INT24, UINT24, INT32, UINT32, INT64, UINT64, YEAR values', () => {
    expect(
      cast(
        {
          name: 'verified',
          type: 'INT8'
        },
        '1'
      )
    ).toEqual(1)
    expect(
      cast(
        {
          name: 'age',
          type: 'INT32'
        },
        '21'
      )
    ).toEqual(21)
  })

  test('casts FLOAT32, FLOAT64 values', () => {
    expect(
      cast(
        {
          name: 'float',
          type: 'FLOAT32'
        },
        '20.4'
      )
    ).toEqual(20.4)
    expect(
      cast(
        {
          name: 'double',
          type: 'FLOAT64'
        },
        '101.4'
      )
    ).toEqual(101.4)
  })

  test('casts BLOB, BIT, GEOMETRY, BINARY, VARBINARY values', () => {
    /** See e2e tests. */
  })

  test('casts BINARY, VARBINARY string values', () => {
    /** See e2e tests. */
  })

  test('casts VARCHAR values', () => {
    expect(
      cast(
        {
          name: 'email',
          type: 'VARCHAR'
        },
        'user@planetscale.com'
      )
    ).toEqual('user@planetscale.com')
  })
})
