import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { cast } from '../src/cast'

describe('cast', () => {
  test('casts NULL values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'email',
          type: 'VARCHAR'
        },
        null
      ),
      null
    )
  })

  test('casts INT64, UINT64 values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'id',
          type: 'UINT64'
        },
        '1'
      ),
      '1'
    )
  })

  test('casts DATETIME, DATE, TIMESTAMP, TIME values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'created_at',
          type: 'DATETIME'
        },
        '2024-01-01 00:00:00'
      ),
      '2024-01-01 00:00:00'
    )
  })

  test('casts DECIMAL values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'decimal',
          type: 'DECIMAL'
        },
        '5.4'
      ),
      '5.4'
    )
  })

  test('casts JSON values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'metadata',
          type: 'JSON'
        },
        '{ "color": "blue" }'
      ),
      { color: 'blue' }
    )
  })

  test('casts INT8, UINT8, INT16, UINT16, INT24, UINT24, INT32, UINT32, INT64, UINT64, YEAR values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'verified',
          type: 'INT8'
        },
        '1'
      ),
      1
    )
    assert.deepStrictEqual(
      cast(
        {
          name: 'age',
          type: 'INT32'
        },
        '21'
      ),
      21
    )
  })

  test('casts FLOAT32, FLOAT64 values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'float',
          type: 'FLOAT32'
        },
        '20.4'
      ),
      20.4
    )
    assert.deepStrictEqual(
      cast(
        {
          name: 'double',
          type: 'FLOAT64'
        },
        '101.4'
      ),
      101.4
    )
  })

  test('casts BLOB, BIT, GEOMETRY, BINARY, VARBINARY values', () => {
    /** See e2e tests in __tests__/golden.test.ts. */
  })

  test('casts BINARY, VARBINARY string values', () => {
    /** See e2e tests in __tests__/golden.test.ts. */
  })

  test('casts VARCHAR values', () => {
    assert.deepStrictEqual(
      cast(
        {
          name: 'email',
          type: 'VARCHAR',
          charset: 255
        },
        'user@planetscale.com'
      ),
      'user@planetscale.com'
    )
  })
})
