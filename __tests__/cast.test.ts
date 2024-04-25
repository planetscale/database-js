import { cast } from '../src/cast'

describe('cast', () => {
  test('casts NULL values', () => {
    expect(
      cast(
        {
          name: 'email',
          type: 'VARCHAR',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'email',
          columnLength: 1020,
          charset: 255
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
          type: 'UINT64',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'id',
          columnLength: 20,
          charset: 63,
          flags: 49699
        },
        '1'
      )
    ).toEqual('1')
  })

  test('casts DECIMAL values', () => {
    expect(
      cast(
        {
          name: 'decimal',
          type: 'DECIMAL',
          table: 'decimals',
          orgTable: 'decimals',
          database: 'blob',
          orgName: 'decimal',
          columnLength: 12,
          charset: 63,
          decimals: 2,
          flags: 32768
        },
        '5.4'
      )
    ).toEqual('5.4')
  })

  test('casts DATETIME, DATE, TIMESTAMP, TIME values', () => {
    expect(
      cast(
        {
          name: 'created_at',
          type: 'DATETIME',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'created_at',
          columnLength: 19,
          charset: 63,
          flags: 128
        },
        '2024-01-01 00:00:00'
      )
    ).toEqual('2024-01-01 00:00:00')
  })

  test('casts JSON values', () => {
    expect(
      cast(
        {
          name: 'metadata',
          type: 'JSON',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'metadata',
          columnLength: 4294967295,
          charset: 63,
          flags: 144
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
          type: 'INT8',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'verified',
          columnLength: 1,
          charset: 63,
          flags: 32768
        },
        '1'
      )
    ).toEqual(1)
    expect(
      cast(
        {
          name: 'age',
          type: 'INT32',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'age',
          columnLength: 11,
          charset: 63,
          flags: 32768
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
          type: 'FLOAT32',
          table: 'decimals',
          orgTable: 'decimals',
          database: 'blob',
          orgName: 'float',
          columnLength: 12,
          charset: 63,
          decimals: 31,
          flags: 32768
        },
        '20.4'
      )
    ).toEqual(20.4)
    expect(
      cast(
        {
          name: 'double',
          type: 'FLOAT64',
          table: 'decimals',
          orgTable: 'decimals',
          database: 'blob',
          orgName: 'double',
          columnLength: 22,
          charset: 63,
          decimals: 31,
          flags: 32768
        },
        '101.4'
      )
    ).toEqual(101.4)
  })

  test('casts VARCHAR values', () => {
    expect(
      cast(
        {
          name: 'email',
          type: 'VARCHAR',
          table: 'users',
          orgTable: 'users',
          database: 'database-js',
          orgName: 'email',
          columnLength: 1020,
          charset: 255
        },
        'user@planetscale.com'
      )
    ).toEqual('user@planetscale.com')
  })

  test('casts BLOB, BIT, GEOMETRY, BINARY, VARBINARY values', () => {
    /** See e2e tests for more complete assertions */

    expect(
      cast(
        {
          name: 'bytes',
          type: 'BLOB',
          table: 'binary_test',
          orgTable: 'binary_test',
          database: 'database-js',
          orgName: 'bytes',
          columnLength: 4294967295,
          charset: 63,
          flags: 4241
        },
        '\u0001\u0002\u0003'
      )
    ).toEqual(new Uint8Array([1, 2, 3]))
  })

  test('casts BINARY, VARBINARY string values', () => {
    /** See e2e tests for more complete assertions */

    expect(
      cast(
        {
          name: 'Index_type',
          type: 'VARBINARY',
          table: 'SHOW_STATISTICS',
          orgName: 'Index_type',
          columnLength: 44,
          charset: 255,
          flags: 129
        },
        'BTREE'
      )
    ).toEqual('BTREE')
    expect(
      cast(
        {
          name: 'Tables_in_users',
          type: 'VARBINARY',
          table: 'TABLES',
          orgTable: 'tables',
          orgName: 'Tables_in_users',
          columnLength: 256,
          charset: 255,
          flags: 4225
        },
        'users'
      )
    ).toEqual('users')
  })
})
