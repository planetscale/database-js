import type { Field } from './index.js'
import { decode, uint8Array } from './text.js'

/**
 * https://github.com/vitessio/vitess/blame/v18.0.2/go/mysql/json/helpers.go#L86-L112
 */

export function cast(field: Field, value: any): any {
  if (value == null) {
    return value
  }

  if (isBigInt(field)) {
    return value;
  }

  if (isDateOrTime(field)) {
    return value;
  }

  if (isDecimal(field)) {
    return value;
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

  if (isText(field)) {
    return value
  }

  return decode(value)
}

/**
 * https://github.com/vitessio/vitess/blob/v18.0.2/go/sqltypes/type.go#L113-L116
 */

function _isNull(field: Field) {
  return field.type === 'NULL'
}

/**
 * These are integral, but we want to leave the `BigInt` casting to the caller.
 *
 * https://github.com/planetscale/database-js/pull/90
 */

function isBigInt(field: Field) {
  return field.type === 'INT64' || field.type === 'UINT64'
}

/**
 * https://github.com/vitessio/vitess/blob/v18.0.2/go/sqltypes/type.go#L103-L106
 */

function isDateOrTime(field: Field) {
  return field.type === 'DATETIME' || field.type === 'DATE' || field.type === 'TIMESTAMP' || field.type === 'TIME'
}

function isDecimal(field: Field) {
  return field.type === 'DECIMAL'
}

function isJson(field: Field) {
  return field.type === 'JSON'
}

const INTEGRAL_FIELD_TYPES = [
  'INT8',
  'INT16',
  'INT24',
  'INT32',
  'UINT8',
  'UINT16',
  'UINT24',
  'UINT32',
  'YEAR',
]

function isIntegral(field: Field) {
  return INTEGRAL_FIELD_TYPES.includes(field.type)
}

const FLOAT_FIELD_TYPES = [
  'FLOAT32',
  'FLOAT64',
]

function isFloat(field: Field) {
  return FLOAT_FIELD_TYPES.includes(field.type)
}

/**
 * https://github.com/planetscale/vitess-types/blob/main/src/vitess/query/v17/query.proto#L98-L106
 */

enum Flags {
  NONE = 0,
  ISINTEGRAL = 256,
  ISUNSIGNED = 512,
  ISFLOAT = 1024,
  ISQUOTED = 2048,
  ISTEXT = 4096,
  ISBINARY = 8192
}

/**
 * https://github.com/vitessio/vitess/blob/v17.0.5/go/sqltypes/type.go#L47-L53
 *
 * INT8, UINT8, INT16, UINT16, INT24, UINT24, INT32, UINT32, INT64, UINT64, YEAR
 */

function _isIntegral(field: Field) {
  return ((field.flags ?? 0) & Flags.ISINTEGRAL) === Flags.ISINTEGRAL
}

/**
 * https://github.com/vitessio/vitess/blob/v17.0.5/go/sqltypes/type.go#L68-L72
 *
 * FLOAT32, FLOAT64
 */

function _isFloat(field: Field) {
  return ((field.flags ?? 0) & Flags.ISFLOAT) === Flags.ISFLOAT
}

/**
 * https://github.com/vitessio/vitess/blob/v17.0.5/go/sqltypes/type.go#L86-L90
 *
 * TEXT, VARCHAR, CHAR, HEXNUM, HEXVAL, BITNUM
 */

function isText(field: Field) {
  return ((field.flags ?? 0) & Flags.ISTEXT) === Flags.ISTEXT
}

/**
 * https://github.com/vitessio/vitess/blob/main/go/sqltypes/type.go#L80-L84
 *
 * TIMESTAMP, DATE, TIME, DATETIME, TEXT, BLOB, VARCHAR, VARBINARY, CHAR, BINARY, ENUM, SET, GEOMETRY, JSON
 */

function isQuoted(field: Field) {
  return ((field.flags ?? 0) & Flags.ISQUOTED) === Flags.ISQUOTED && field.type !== 'BIT'
}

/**
 * https://github.com/vitessio/vitess/blob/main/go/sqltypes/type.go#L96-L100
 *
 * BLOB, VARBINARY, BINARY
 */

function isBinary(field: Field) {
  return ((field.flags ?? 0) & Flags.ISBINARY) === Flags.ISBINARY
}
