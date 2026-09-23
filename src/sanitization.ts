import { uint8ArrayToHex } from './text.js'

type Stringable = { toString: () => string }
type Value = null | undefined | number | boolean | string | Array<Value> | Date | Stringable

export function format(query: string, values: Record<string, any> | any[]): string {
  return Array.isArray(values) ? replacePosition(query, values) : replaceNamed(query, values)
}

function replacePosition(query: string, values: Value[]): string {
  let index = 0
  return replacePlaceholders(query, '?', (position, inExecutableComment) => {
    if (index >= values.length) {
      return
    }

    return { end: position + 1, value: sanitize(values[index++], inExecutableComment) }
  })
}

function replaceNamed(query: string, values: Record<string, Value>): string {
  return replacePlaceholders(query, ':', (position, inExecutableComment) => {
    let end = position + 1
    while (end < query.length && isWordChar(query.charCodeAt(end))) {
      end++
    }

    if (end === position + 1) {
      return
    }

    const name = query.slice(position + 1, end)
    return hasOwn(values, name) ? { end, value: sanitize(values[name], inExecutableComment) } : undefined
  })
}

type Replacement = { end: number; value: string }

function replacePlaceholders(
  query: string,
  marker: '?' | ':',
  replacementAt: (position: number, inExecutableComment: boolean) => Replacement | undefined
): string {
  let position = 0
  let copyFrom = 0
  let result = ''
  let executableCommentEnd = -1
  let variableEnd = -1

  while (position < query.length) {
    const char = query[position]

    if (position === executableCommentEnd) {
      executableCommentEnd = -1
      position += 2
      continue
    }

    const inExecutableComment = executableCommentEnd !== -1

    // Locate the version comment's closing delimiter before tokenizing its
    // executable SQL body. Vitess 22 and 23 end the comment at the first raw
    // closing delimiter. Vitess 24 tokenizes the body inline instead: a quoted
    // `*/` does not close it, one nested /* */ comment is consumed, and line
    // comments run past `*/`. Reject bodies where those rules disagree rather
    // than guess which one the server uses.
    if (!inExecutableComment && char === '/' && query[position + 1] === '*' && query[position + 2] === '!') {
      const end = query.indexOf('*/', position + 3)
      if (end === -1) {
        position = query.length
        continue
      }
      // A disabled Vitess 24 version comment tracks raw nested openers even
      // inside tokens, while Vitess 23 stops at their first closing delimiter.
      // Checking starts before the closing `*` so overlapping `/*/` is rejected.
      const nestedComment = query.indexOf('/*', position + 3)
      if (nestedComment !== -1 && nestedComment < end) {
        throw ambiguousExecutableComment()
      }
      executableCommentEnd = end
      position += 3
      continue
    }

    const contextEnd = inExecutableComment ? executableCommentEnd : query.length

    // Vitess permits quote characters inside @user and @@system variable
    // tokens. Skip the complete token before interpreting quotes or comments.
    if (char === '@') {
      position = tokenEnd(skipVariable(query, position, contextEnd), contextEnd, inExecutableComment)
      variableEnd = position
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      position = tokenEnd(skipQuoted(query, position, char, contextEnd), contextEnd, inExecutableComment)
      continue
    }

    if (inExecutableComment && isLineComment(query, position)) {
      const end = skipLineComment(query, position + (char === '#' ? 1 : 2), contextEnd)
      // Vitess 24 reads // as division inside a version comment. # and --
      // agree across versions only when their comment ends before */.
      const reachesBoundary = end === contextEnd && query[contextEnd - 1] !== '\n'
      if ((char === '/' && query[position + 1] === '/') || reachesBoundary) {
        throw ambiguousExecutableComment()
      }
      position = end
      continue
    }

    if (char === '#') {
      position = skipLineComment(query, position + 1, contextEnd)
      continue
    }

    // Vitess accepts `//` as a line comment in addition to MySQL's `#` and `-- ` forms.
    if (char === '/' && query[position + 1] === '/') {
      position = skipLineComment(query, position + 2, contextEnd)
      continue
    }

    if (char === '-' && query[position + 1] === '-' && isDashComment(query, position + 2)) {
      position = skipLineComment(query, position + 2, contextEnd)
      continue
    }

    if (char === '/' && query[position + 1] === '*') {
      if (inExecutableComment) {
        throw ambiguousExecutableComment()
      }
      position = skipBlockComment(query, position + 2, contextEnd)
      continue
    }

    const replacement = char === marker ? replacementAt(position, inExecutableComment) : undefined
    if (replacement) {
      const next = nextTokenChar(query, replacement.end)
      if (replacement.value.endsWith("'") && (next === "'" || next === '"')) {
        throw new Error('Cannot format query: use AS before a quoted alias that follows a quoted value')
      }
      // Keep the value distinct from adjacent tokens. This prevents quote
      // characters joining variable names and digits becoming version tags.
      const previousIsToken = position > 0 && isVariableNameChar(query.charCodeAt(position - 1))
      const startsExecutableComment = inExecutableComment && query.startsWith('/*!', position - 3)
      const separatorBefore = position === variableEnd || startsExecutableComment || previousIsToken ? ' ' : ''
      const separatorAfter = needsSeparatorAfter(query, replacement.end) ? ' ' : ''
      result += query.slice(copyFrom, position) + separatorBefore + replacement.value + separatorAfter
      copyFrom = replacement.end
      position = replacement.end
      continue
    }

    position++
  }

  return copyFrom === 0 ? query : result + query.slice(copyFrom)
}

// Resolve an unterminated token (-1) to the end of its context. Inside an
// executable comment, Vitess versions disagree on where such a token ends.
function tokenEnd(end: number, limit: number, inExecutableComment: boolean): number {
  if (end !== -1) return end
  if (inExecutableComment) throw ambiguousExecutableComment()
  return limit
}

function ambiguousExecutableComment(): Error {
  return new Error('Cannot format query: Vitess versions parse differently inside this /*! */ comment')
}

// Returns -1 when the variable name runs into the limit.
function skipVariable(query: string, position: number, limit: number): number {
  let end = position + 1
  if (query[end] === '@') end++
  if (end >= limit) return -1

  if (query[end] === '`') {
    return skipQuoted(query, end, '`', limit)
  }

  // Vitess always consumes the first character after @, then accepts letters,
  // digits, _, $, dots, and quote characters in the rest of the variable name.
  end++
  while (end < limit && isVariableNameChar(query.charCodeAt(end))) {
    end++
  }
  return end
}

// Returns -1 when the quoted token is not closed before the limit.
function skipQuoted(query: string, position: number, quote: string, limit: number): number {
  const backslashEscapes = quote !== '`'

  for (let i = position + 1; i < limit; i++) {
    if (backslashEscapes && query[i] === '\\') {
      i++
      continue
    }

    if (query[i] === quote) {
      if (query[i + 1] === quote) {
        i++
        continue
      }
      return i + 1
    }
  }

  return -1
}

function skipLineComment(query: string, position: number, limit: number): number {
  const newline = query.indexOf('\n', position)
  return newline === -1 || newline >= limit ? limit : newline + 1
}

function skipBlockComment(query: string, position: number, limit: number): number {
  const end = query.indexOf('*/', position)
  return end === -1 || end >= limit ? limit : end + 2
}

function isLineComment(query: string, position: number): boolean {
  const char = query[position]
  const next = query[position + 1]
  return (
    char === '#' ||
    (char === '/' && next === '/') ||
    (char === '-' && next === '-' && isDashComment(query, position + 2))
  )
}

function isDashComment(query: string, position: number): boolean {
  return position >= query.length || ' \t\n\r\f\v'.includes(query[position])
}

function isWordChar(code: number): boolean {
  // Preserve the ASCII `\w` behavior of the previous named-placeholder regexp.
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}

function isVariableNameChar(code: number): boolean {
  return isWordChar(code) || code === 36 || code === 46 || code === 39 || code === 34 || code === 96
}

function needsSeparatorAfter(query: string, position: number): boolean {
  if (position >= query.length) return false
  const char = query[position]
  return isVariableNameChar(query.charCodeAt(position)) || char === '?' || char === ':'
}

function nextTokenChar(query: string, position: number): string | undefined {
  while (position < query.length) {
    while (position < query.length && ' \t\n\r'.includes(query[position])) position++

    const char = query[position]
    if (char === '#') {
      position = skipLineComment(query, position + 1, query.length)
      continue
    }
    if (char === '/' && query[position + 1] === '/') {
      position = skipLineComment(query, position + 2, query.length)
      continue
    }
    if (char === '-' && query[position + 1] === '-' && isDashComment(query, position + 2)) {
      position = skipLineComment(query, position + 2, query.length)
      continue
    }
    if (char === '/' && query[position + 1] === '*' && query[position + 2] !== '!') {
      position = skipBlockComment(query, position + 2, query.length)
      continue
    }
    return char
  }
}

function hasOwn(obj: unknown, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, name)
}

function sanitize(value: Value, inExecutableComment = false): string {
  if (value == null) {
    return 'null'
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Cannot format query: non-finite numbers are not valid SQL values')
    }
    return String(value)
  }

  if (typeof value === 'bigint') {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'string') {
    return quote(value, inExecutableComment)
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error('Cannot format query: empty arrays are not valid SQL values')
    }
    return value.map((item) => sanitize(item, inExecutableComment)).join(', ')
  }

  if (value instanceof Date) {
    return quote(value.toISOString().slice(0, -1), inExecutableComment)
  }

  if (value instanceof Uint8Array) {
    return uint8ArrayToHex(value)
  }

  return quote(value.toString(), inExecutableComment)
}

function quote(text: string, inExecutableComment: boolean): string {
  let escaped = escape(text)
  if (inExecutableComment) {
    // Split block-comment delimiters across adjacent string literals so an
    // interpolated value cannot alter the surrounding version comment. MySQL
    // and Vitess concatenate adjacent string literals into the original value.
    escaped = splitCommentDelimiters(escaped)
  }
  return `'${escaped}'`
}

function splitCommentDelimiters(text: string): string {
  let result = ''

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    result += char

    const next = text[i + 1]
    if ((char === '/' && next === '*') || (char === '*' && next === '/')) {
      // Close and reopen the literal between both characters. Checking every
      // adjacent pair also handles overlapping inputs such as /*/ and */*.
      result += "' '"
    }
  }

  return result
}

const re = /[\0\b\n\r\t\x1a\\"']/g

function escape(text: string): string {
  return text.replace(re, replacement)
}

function replacement(text: string): string {
  switch (text) {
    case '"':
      return '\\"'
    case "'":
      return "''"
    case '\n':
      return '\\n'
    case '\r':
      return '\\r'
    case '\t':
      return '\\t'
    case '\\':
      return '\\\\'
    case '\0':
      return '\\0'
    case '\b':
      return '\\b'
    case '\x1a':
      return '\\Z'
    default:
      return ''
  }
}
