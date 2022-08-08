import { format } from '../src/sanitization'

describe('sanitization', () => {
  describe('format', () => {
    test('does nothing with empty values', () => {
      const query = 'select 1 from user where id=?'
      expect(format(query, [])).toEqual(query)
    })

    test('formats as many values as given', () => {
      const query = 'select 1 from user where id=? and deleted=?'
      const expected = 'select 1 from user where id=42 and deleted=?'
      expect(format(query, [42])).toEqual(expected)
    })

    test('formats number values', () => {
      const query = 'select 1 from user where id=? and id2=?'
      const expected = 'select 1 from user where id=12 and id2=42'
      expect(format(query, [12, 42])).toEqual(expected)
    })

    test('formats string values', () => {
      const query = 'select 1 from user where state=?'
      const expected = "select 1 from user where state='active'"
      expect(format(query, ['active'])).toEqual(expected)
    })

    test('formats null values', () => {
      const query = 'update user set state=?, name=? where id=?'
      const expected = 'update user set state=null, name=null where id=42'
      expect(format(query, [null, undefined, 42])).toEqual(expected)
    })

    test('formats boolean values', () => {
      const query = 'select 1 from user where active=? and deleted=?'
      const expected = 'select 1 from user where active=true and deleted=false'
      expect(format(query, [true, false])).toEqual(expected)
    })

    test('formats date values', () => {
      const ts = Date.UTC(2022, 1, 8, 13, 15, 45)
      const query = 'select 1 from user where created_at > ?'
      const expected = "select 1 from user where created_at > '2022-02-08T13:15:45.000Z'"
      expect(format(query, [new Date(ts)])).toEqual(expected)
    })

    test('formats array values', () => {
      const query = 'select 1 from user where id > ? and state in (?)'
      const expected = "select 1 from user where id > 42 and state in ('active', 'inactive')"
      expect(format(query, [42, ['active', 'inactive']])).toEqual(expected)
    })

    test('formats objects with toString method', () => {
      const state = { toString: () => 'active' }
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = 'active'"
      expect(format(query, [state])).toEqual(expected)
    })

    test('escapes double quotes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = 'select 1 from user where state = \'\\"a\\"\''
      expect(format(query, ['"a"'])).toEqual(expected)
    })

    test('escapes single quotes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\'a\\''"
      expect(format(query, ["'a'"])).toEqual(expected)
    })

    test('escapes new lines', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\na\\n'"
      expect(format(query, ['\na\n'])).toEqual(expected)
    })

    test('escapes carriage returns', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ra\\r'"
      expect(format(query, ['\ra\r'])).toEqual(expected)
    })

    test('escapes tabs', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ta\\t'"
      expect(format(query, ['\ta\t'])).toEqual(expected)
    })

    test('escapes back slashes', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\\\a\\\\'"
      expect(format(query, ['\\a\\'])).toEqual(expected)
    })

    test('escapes null byte', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\0a\\0'"
      expect(format(query, ['\0a\0'])).toEqual(expected)
    })

    test('escapes back space', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\ba\\b'"
      expect(format(query, ['\ba\b'])).toEqual(expected)
    })

    test('escapes control-z', () => {
      const query = 'select 1 from user where state = ?'
      const expected = "select 1 from user where state = '\\Za\\Z'"
      expect(format(query, ['\x1aa\x1a'])).toEqual(expected)
    })
  })
})
