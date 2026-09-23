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

    test('does not replace positional placeholders inside quoted SQL', () => {
      const query = 'select \'?\' as single_quote, "?" as double_quote, `?` as identifier, ? as value'
      const expected = 'select \'?\' as single_quote, "?" as double_quote, `?` as identifier, 42 as value'
      assert.deepStrictEqual(format(query, [42]), expected)
    })

    test('prevents a value from escaping through a question mark in a string literal', () => {
      const query = "select secret from user where note='prefix?suffix' and username=?"
      const expected = "select secret from user where note='prefix?suffix' and username=' OR 1=1 -- '"
      assert.deepStrictEqual(format(query, [' OR 1=1 -- ']), expected)
    })

    test('honors escaped and doubled quote delimiters', () => {
      const backslash = "select '\\'? still quoted', ? as value"
      assert.deepStrictEqual(format(backslash, [1]), "select '\\'? still quoted', 1 as value")

      const doubledSingle = "select 'isn''t ?', ? as value"
      assert.deepStrictEqual(format(doubledSingle, [2]), "select 'isn''t ?', 2 as value")

      const doubledDouble = 'select "a""?b", ? as value'
      assert.deepStrictEqual(format(doubledDouble, [3]), 'select "a""?b", 3 as value')

      const doubledBacktick = 'select `a``?b`, ? as value'
      assert.deepStrictEqual(format(doubledBacktick, [4]), 'select `a``?b`, 4 as value')
    })

    test('does not replace positional placeholders inside comments', () => {
      const queries = [
        ['select 1 -- ?\nwhere id=?', 'select 1 -- ?\nwhere id=5'],
        ['select 1 -- ?\rwhere id=?', 'select 1 -- ?\rwhere id=?'],
        ['select 1 -- ?\r\nwhere id=?', 'select 1 -- ?\r\nwhere id=5'],
        ['select 1 # ?\nwhere id=?', 'select 1 # ?\nwhere id=5'],
        ['select 1 // ?\nwhere id=?', 'select 1 // ?\nwhere id=5'],
        ['select /* ? */ ? from user', 'select /* ? */ 5 from user']
      ]

      for (const [query, expected] of queries) {
        assert.deepStrictEqual(format(query, [5]), expected)
      }
    })

    test('does not let Vitess // comment text desynchronize quoted SQL', () => {
      const query = "select id from user // don't change this\nwhere note = '?' and id = ?"
      const expected = "select id from user // don't change this\nwhere note = '?' and id = ' OR 1=1 -- '"
      assert.deepStrictEqual(format(query, [' OR 1=1 -- ']), expected)

      const namedQuery = "select id from user // don't change this\nwhere note = ':id' and id = :id"
      const namedExpected = "select id from user // don't change this\nwhere note = ':id' and id = ' OR 1=1 -- '"
      assert.deepStrictEqual(format(namedQuery, { id: ' OR 1=1 -- ' }), namedExpected)
    })

    test('does not treat quotes in Vitess variable names as string delimiters', () => {
      const attack = ' OR 1=1 -- '
      const query = "select @foo' from user where note = '?' and id = ?"
      const expected = "select @foo' from user where note = '?' and id = ' OR 1=1 -- '"
      assert.deepStrictEqual(format(query, [attack]), expected)

      const namedQuery = "select @@foo' from user where note = ':id' and id = :id"
      const namedExpected = "select @@foo' from user where note = ':id' and id = ' OR 1=1 -- '"
      assert.deepStrictEqual(format(namedQuery, { id: attack }), namedExpected)

      // Vitess consumes the first character after @ as part of the variable,
      // even when that character would otherwise be a placeholder marker.
      assert.deepStrictEqual(format('select @? as variable, ? as value', [42]), 'select @? as variable, 42 as value')
    })

    test('requires whitespace after two dashes to start a comment', () => {
      const query = 'select 1--? + ?'
      assert.deepStrictEqual(format(query, [2, 3]), 'select 1--2 + 3')
      assert.deepStrictEqual(format('select 1--\f? + ?', [2, 3]), 'select 1--\f? + ?')
      assert.deepStrictEqual(format('select 1--\v? + ?', [2, 3]), 'select 1--\v? + ?')
    })

    test('recognizes form feed and vertical tab after a double-dash comment marker', () => {
      for (const whitespace of ['\f', '\v']) {
        const positional = `select id from user --${whitespace} don't change this\nwhere note = 'prefix?suffix' and id = ?`
        const positionalExpected = `select id from user --${whitespace} don't change this\nwhere note = 'prefix?suffix' and id = ' OR 1=1 -- '`
        assert.deepStrictEqual(format(positional, [' OR 1=1 -- ']), positionalExpected)

        const named = `select id from user --${whitespace} don't change this\nwhere note = 'prefix:id-suffix' and id = :id`
        const namedExpected = `select id from user --${whitespace} don't change this\nwhere note = 'prefix:id-suffix' and id = ' OR 1=1 -- '`
        assert.deepStrictEqual(format(named, { id: ' OR 1=1 -- ' }), namedExpected)
      }
    })

    test('does not replace placeholders inside optimizer hints', () => {
      const query = 'select /*+ QB_NAME(?) */ ? as value'
      const expected = "select /*+ QB_NAME(?) */ '*/ 99 as injected -- ' as value"
      assert.deepStrictEqual(format(query, ['*/ 99 as injected -- ']), expected)
    })

    test('replaces placeholders in executable MySQL comments', () => {
      const query = "select /*!50708 ? + 'literal?' + ? */ ?"
      const expected = "select /*!50708 1 + 'literal?' + 2 */ 3"
      assert.deepStrictEqual(format(query, [1, 2, 3]), expected)
    })

    test('does not let a value close an executable MySQL comment', () => {
      const query = 'select /*!80000 ? as optional_value, */ ? as value'
      const expected = "select /*!80000 '*' '/ 99 as injected -- ' as optional_value, */ 5 as value"
      assert.deepStrictEqual(format(query, ['*/ 99 as injected -- ', 5]), expected)

      const named = 'select /*!80000 :optional as optional_value, */ :value as value'
      const namedExpected = "select /*!80000 '*'' *' '/ payload' as optional_value, */ 5 as value"
      assert.deepStrictEqual(format(named, { optional: "*' */ payload", value: 5 }), namedExpected)

      assert.deepStrictEqual(
        format('select /*!80000 ? as optional_value */', ['a*/b*/c']),
        "select /*!80000 'a*' '/b*' '/c' as optional_value */"
      )
      assert.deepStrictEqual(
        format('select /*!80000 ? as optional_value */', ['a/*b']),
        "select /*!80000 'a/' '*b' as optional_value */"
      )

      assert.deepStrictEqual(
        format('select id from user where id = ? /*!99999 and note = ? */', [42, '/*/ OR 1=1 -- ']),
        "select id from user where id = 42 /*!99999 and note = '/' '*' '/ OR 1=1 -- ' */"
      )
      assert.deepStrictEqual(
        format('select id from user where id = ? /*!99999 and note = ? */', [42, '*/* OR 1=1 -- ']),
        "select id from user where id = 42 /*!99999 and note = '*' '/' '* OR 1=1 -- ' */"
      )
    })

    test('rejects executable MySQL comments that Vitess versions tokenize differently', () => {
      const ambiguous = [
        // Vitess 24 treats a quoted */ as part of the string, not the end of the comment.
        "select id /*!99999 ' */ from user where note = '?' and id = ?",
        "select /*!80000 '*/' as x, */ id from user where note like '%?%'",
        'select /*!80000 `a*/` */ ?',
        'select /*!80000 @`a*/` */ ?',
        // Vitess 24 consumes one nested comment, including when skipping the body.
        "select id /*!99999 ' /* */ from user where note = '? /* x */ y */' and id = ?",
        'select id from user where id = 1 /*!99999 /* hint */ and note = ? */',
        'select /*!99999 --/*/ ? */',
        // Vitess 24 lets line comments run past */, and reads // as division.
        'select /*! 1 -- ignored */ + ?',
        'select /*!80000 1 # a */ + ?',
        "select /*!80000 1 // it's\n */ + ?"
      ]

      for (const query of ambiguous) {
        assert.throws(() => format(query, ['*/ OR 1=1 -- ']), /Vitess versions parse differently/, query)
      }

      assert.throws(() => format('select /*!80000 :id # a */ + :id', { id: 1 }), /Vitess versions parse differently/)
    })

    test('allows terminated line comments that Vitess versions parse identically', () => {
      assert.deepStrictEqual(
        format('select /*!80000 1 -- comment\n + ? */', [2]),
        'select /*!80000 1 -- comment\n + 2 */'
      )
      assert.deepStrictEqual(
        format('select /*!80000 1 # comment\n + ? */', [2]),
        'select /*!80000 1 # comment\n + 2 */'
      )
      assert.deepStrictEqual(format('select /*!80000 ? # comment\n*/ + 1', [2]), 'select /*!80000 2 # comment\n*/ + 1')
      assert.deepStrictEqual(
        format('select /*!80000 ? -- comment\n*/ + 1', [2]),
        'select /*!80000 2 -- comment\n*/ + 1'
      )
    })

    test('separates values from executable-comment version prefixes and following tokens', () => {
      assert.deepStrictEqual(format('select /*!? + */ 1', [100000]), 'select /*! 100000 + */ 1')
      assert.deepStrictEqual(format('select /*!:value + */ 1', { value: 100000 }), 'select /*! 100000 + */ 1')

      assert.deepStrictEqual(format('select ?e1', [42]), 'select 42 e1')
      assert.deepStrictEqual(format('select ?`e1`', ['value']), "select 'value' `e1`")
      assert.deepStrictEqual(format('select _utf8?', ['value']), "select _utf8 'value'")

      // Adjacent string literals concatenate even with whitespace, so an
      // explicit AS is required to preserve a quoted alias.
      assert.throws(() => format("select ?'e1'", ['value']), /use AS before a quoted alias/)
      assert.throws(() => format('select ?"e1"', ['value']), /use AS before a quoted alias/)
      assert.throws(() => format("select ? 'e1'", ['value']), /use AS before a quoted alias/)
      assert.throws(() => format("select ? /* comment */ 'e1'", ['value']), /use AS before a quoted alias/)
      assert.throws(() => format("select ? -- comment\n 'e1'", ['value']), /use AS before a quoted alias/)
      assert.deepStrictEqual(format("select ? AS 'e1'", ['value']), "select 'value' AS 'e1'")
    })

    test('separates values from a preceding variable token', () => {
      // Vitess accepts quote characters in variable names, so `@v'...'` would
      // make the value's opening quote part of the variable.
      const attack = ' or 1=1 -- '
      assert.deepStrictEqual(format('select @v?', [attack]), "select @v ' or 1=1 -- '")
      assert.deepStrictEqual(format('select @@x.y?', [attack]), "select @@x.y ' or 1=1 -- '")
      assert.deepStrictEqual(format('select @`v`?', [1]), 'select @`v` 1')
      assert.deepStrictEqual(format('select /*!80000 @v? */', [attack]), "select /*!80000 @v ' or 1=1 -- ' */")
      assert.deepStrictEqual(format('select @v:id', { id: attack }), "select @v ' or 1=1 -- '")

      // Vitess consumes the character after @ or @@, even whitespace.
      assert.deepStrictEqual(format('select @@ ?', [attack]), "select @@  ' or 1=1 -- '")

      // Values already separated from the variable are unchanged.
      assert.deepStrictEqual(format('select @v = ?', [attack]), "select @v = ' or 1=1 -- '")
    })

    test('leaves placeholders in unterminated quoted SQL and comments unchanged', () => {
      const quoted = "select 'unterminated ? and ?"
      assert.deepStrictEqual(format(quoted, [1, 2]), quoted)

      const commented = 'select /* unterminated ? and ?'
      assert.deepStrictEqual(format(commented, [1, 2]), commented)
    })

    test('does not replace named placeholders inside quoted SQL or comments', () => {
      const query = 'select \':id\', " :id", `:id`, :id /* :id */'
      const expected = 'select \':id\', " :id", `:id`, 42 /* :id */'
      assert.deepStrictEqual(format(query, { id: 42 }), expected)
    })

    test('prevents a named value from escaping through a placeholder in a string literal', () => {
      const query = "select secret from user where note='prefix:id-suffix' and username=:id"
      const expected = "select secret from user where note='prefix:id-suffix' and username=' OR 1=1 -- '"
      assert.deepStrictEqual(format(query, { id: ' OR 1=1 -- ' }), expected)
    })

    test('replaces named placeholders in executable MySQL comments', () => {
      const query = "select /*!50708 :id + ':id' */ :id"
      const expected = "select /*!50708 42 + ':id' */ 42"
      assert.deepStrictEqual(format(query, { id: 42 }), expected)
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

    test('rejects empty array values instead of deleting a placeholder', () => {
      const query = 'select secret from user where id = 1--? AND tenant_id = 42'
      assert.throws(() => format(query, [[]]), /empty arrays/)
      assert.throws(() => format('select * from user where id in (:ids)', { ids: [] }), /empty arrays/)
      assert.throws(() => format('select * from user where id in (?)', [[[]]]), /empty arrays/)
    })

    test('rejects non-finite numbers', () => {
      const query = 'select 1 from user where id = ?'
      assert.throws(() => format(query, [NaN]), /non-finite numbers/)
      assert.throws(() => format(query, [Infinity]), /non-finite numbers/)
      assert.throws(() => format(query, [-Infinity]), /non-finite numbers/)
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

    test('escapes single quotes by doubling', () => {
      const query = 'select 1 from user where state = ?'
      assert.deepStrictEqual(format(query, ["'a'"]), "select 1 from user where state = '''a'''")
      assert.deepStrictEqual(format(query, ["' OR 1=1 -- "]), "select 1 from user where state = ''' OR 1=1 -- '")
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
