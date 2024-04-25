import type { Field } from './index.js'
import { decodeUtf8, uint8Array } from './text.js'

/**
 * https://github.com/vitessio/vitess/blame/v19.0.3/go/mysql/json/helpers.go#L86-L112
 */

export function cast(field: Field, value: any): any {
  if (value == null) {
    return value
  }

  if (isBigInt(field)) {
    return value
  }

  if (isDateOrTime(field)) {
    return value
  }

  if (isDecimal(field)) {
    return value
  }

  if (isJson(field)) {
    return JSON.parse(value)
  }

  if (isIntegral(field)) {
    return parseInt(value, 10)
  }

  if (isFloat(field)) {
    return parseFloat(value)
  }

  if (isBinary(field)) {
    return uint8Array(value)
  }

  return decodeUtf8(value)
}

/**
 * These are integral, but we want to leave the `BigInt` casting to the caller.
 *
 * https://github.com/planetscale/database-js/pull/90
 */

const BIG_INT_FIELD_TYPES = ['INT64', 'UINT64']

function isBigInt(field: Field) {
  return BIG_INT_FIELD_TYPES.includes(field.type)
}

/**
 * https://github.com/vitessio/vitess/blob/v19.0.3/go/sqltypes/type.go#L103-L106
 */

const DATE_OR_DATETIME_FIELD_TYPES = ['DATETIME', 'DATE', 'TIMESTAMP', 'TIME']

function isDateOrTime(field: Field) {
  return DATE_OR_DATETIME_FIELD_TYPES.includes(field.type)
}

function isDecimal(field: Field) {
  return field.type === 'DECIMAL'
}

function isJson(field: Field) {
  return field.type === 'JSON'
}

const INTEGRAL_FIELD_TYPES = ['INT8', 'INT16', 'INT24', 'INT32', 'UINT8', 'UINT16', 'UINT24', 'UINT32', 'YEAR']

function isIntegral(field: Field) {
  return INTEGRAL_FIELD_TYPES.includes(field.type)
}

const FLOAT_FIELD_TYPES = ['FLOAT32', 'FLOAT64']

function isFloat(field: Field) {
  return FLOAT_FIELD_TYPES.includes(field.type)
}

/**
 * https://dev.mysql.com/doc/dev/mysql-server/latest/page_protocol_basic_character_set.html
 */

const BinaryId = 63

function isBinary(field: Field) {
  return field.charset === BinaryId
}
