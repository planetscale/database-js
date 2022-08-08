type Stringable = { toString: () => string }
type Value = null | undefined | number | boolean | string | Array<Value> | Date | Stringable

export function format(query: string, values: Value[]): string {
  let index = 0
  return query.replace(/\?/g, (match) => {
    return index < values.length ? sanitize(values[index++]) : match
  })
}

function sanitize(value: Value): string {
  if (value == null) {
    return 'null'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  if (typeof value === 'string') {
    return quote(value)
  }

  if (Array.isArray(value)) {
    return value.map(sanitize).join(', ')
  }

  if (value instanceof Date) {
    return quote(value.toISOString())
  }

  return quote(value.toString())
}

function quote(text: string): string {
  return `'${escape(text)}'`
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
      return "\\'"
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
