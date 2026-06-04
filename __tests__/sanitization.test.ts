import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { format } from '../src/sanitization'

describe('sanitization', () => {
  describe('format', () => {
    test('does no replacement for missing object key', () => {
      const query = 'select 1 from user where id=:id'
      assert.deepStrictEqual(format(query, {}), query)
    })

    test('replaces named parameters', () => {
      const query = 'select 1 from user where state in (:state) and deleted_at=:deleted_at'
      const expected = "select 1 from user where state in ('active', 'inactive') and deleted_at=true"
      assert.deepStrictEqual(format(query, { state: ['active', 'inactive'], deleted_at: true }), expected)
    })

    test('replaces duplicate named parameters', () => {
      const query = 'select 1 from user where id=:id or actor_id=:id'
      const expected = 'select 1 from user where id=42 or actor_id=42'
      assert.deepStrictEqual(format(query, { id: 42 }), expected)
    })

    test('does nothing with empty values list', () => {
      const query = 'select 1 from user where id=?'
      assert.deepStrictEqual(format(query, []), query)
    })

    test('formats as many values as given', () => {
      const query = 'select 1 from user where id=? and deleted=?'
      const expected = 'select 1 from user where id=42 and deleted=?'
      assert.deepStrictEqual(format(query, [42]), expected)
    })

    test('formats number values', () => {
      const query = 'select 1 from user where id=? and id2=?'
      const expected = 'select 1 from user where id=12 and id2=42'
      assert.deepStrictEqual(format(query, [12, 42]), expected)
    })

    test('formats bigint values', () => {
      const query = 'select 1 from user where id=? and id2=? and id3=?'
      const expected = 'select 1 from user where id=12 and id2=42 and id3=9223372036854775807'
      assert.deepStrictEqual(format(query, [12n, 42n, 9223372036854775807n]), expected)
    })

    test('formats string values', () => {
      const query = 'select 1 from user where state=?'
      const expected = "select 1 from user where state='active'"
      assert.deepStrictEqual(format(query, ['active']), expected)
    })

    test('formats null values', () => {
      const query = 'update user set state=?, name=? where id=?'
      const expected = 'update user set state=null, name=null where id=42'
      assert.deepStrictEqual(format(query, [null, undefined, 42]), expected)
    })

    test('formats boolean values', () => {
      const query = 'select 1 from user where active=? and deleted=?'
      const expected = 'select 1 from user where active=true and deleted=false'
      assert.deepStrictEqual(format(query, [true, false]), expected)
    })

    test('formats date values', () => {
      const ts = Date.UTC(2022, 1, 8, 13, 15, 45)
      const query = 'select 1 from user where created_at > ?'
      const expected = "select 1 from user where created_at > '2022-02-08T13:15:45.000'"
      assert.deepStrictEqual(format(query, [new Date(ts)]), expected)
    })

    test('formats array values', () => {
      const query = 'select 1 from user where id > ? and state in (?)'
      const expected = "select 1 from user where id > 42 and state in ('active', 'inactive')"
      assert.deepStrictEqual(format(query, [42, ['active', 'inactive']]), expected)
    })

    test('formats objects with toString method', () => {
      const state = { toString: () => 'active' }
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = 'active'"
      assert.deepStrictEqual(format(query, [state]), expected)
    })

    test('formats empty Uint8Array', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = x''"
      assert.deepStrictEqual(format(query, [new Uint8Array([])]), expected)
    })

    test('escapes double quotes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = 'select 1 from user where state = \'\\"a\\"\''
      assert.deepStrictEqual(format(query, ['"a"']), expected)
    })

    test('escapes single quotes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\'a\\''"
      assert.deepStrictEqual(format(query, ["'a'"]), expected)
    })

    test('escapes new lines', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\na\\n'"
      assert.deepStrictEqual(format(query, ['\na\n']), expected)
    })

    test('escapes carriage returns', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ra\\r'"
      assert.deepStrictEqual(format(query, ['\ra\r']), expected)
    })

    test('escapes tabs', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ta\\t'"
      assert.deepStrictEqual(format(query, ['\ta\t']), expected)
    })

    test('escapes back slashes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\\\a\\\\'"
      assert.deepStrictEqual(format(query, ['\\a\\']), expected)
    })

    test('escapes null byte', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\0a\\0'"
      assert.deepStrictEqual(format(query, ['\0a\0']), expected)
    })

    test('escapes back space', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ba\\b'"
      assert.deepStrictEqual(format(query, ['\ba\b']), expected)
    })

    test('escapes control-z', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\Za\\Z'"
      assert.deepStrictEqual(format(query, ['\x1aa\x1a']), expected)
    })
  })
})
