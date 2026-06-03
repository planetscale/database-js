import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { decodeUtf8, hex, uint8Array, uint8ArrayToHex } from '../src/text'

describe('text', () => {
  describe('decodeUtf8', () => {
    test('decodes ascii bytes', () => {
      assert.deepStrictEqual(decodeUtf8('a'), 'a')
    })

    test('decodes empty string', () => {
      assert.deepStrictEqual(decodeUtf8(''), '')
    })

    test('decodes null value', () => {
      assert.deepStrictEqual(decodeUtf8(null), '')
    })

    test('decodes undefined value', () => {
      assert.deepStrictEqual(decodeUtf8(undefined), '')
    })

    test('decodes multi-byte characters', () => {
      assert.deepStrictEqual(decodeUtf8('\xF0\x9F\xA4\x94'), '🤔')
    })
  })

  describe('hex', () => {
    test('encodes binary as hex', () => {
      assert.deepStrictEqual(hex('\0\0'), '0x0000')
    })

    test('encodes ascii as hex', () => {
      assert.deepStrictEqual(hex('aa'), '0x6161')
    })
  })

  describe('uint8Array', () => {
    test('converts to an array of 8-bit unsigned integers', () => {
      assert.deepStrictEqual(uint8Array(''), new Uint8Array([]))
      assert.deepStrictEqual(uint8Array('Å'), new Uint8Array([197]))
    })
  })

  describe('uint8ArrayToHex', () => {
    test('converts an array of 8-bit unsigned integers to hex', () => {
      assert.deepStrictEqual(uint8ArrayToHex(new Uint8Array([])), "x''")
      assert.deepStrictEqual(uint8ArrayToHex(new Uint8Array([197])), "x'c5'")
    })
  })
})
