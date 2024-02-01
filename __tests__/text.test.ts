import { decode, hex, uint8Array, uint8ArrayToHex } from '../src/text'

describe('text', () => {
  describe('decode', () => {
    test('decodes ascii bytes', () => {
      expect(decode('a')).toEqual('a')
    })

    test('decodes empty string', () => {
      expect(decode('')).toEqual('')
    })

    test('decodes null value', () => {
      expect(decode(null)).toEqual('')
    })

    test('decodes undefined value', () => {
      expect(decode(undefined)).toEqual('')
    })

    test('decodes multi-byte characters', () => {
      expect(decode('\xF0\x9F\xA4\x94')).toEqual('🤔')
    })
  })

  describe('hex', () => {
    test('encodes binary as hex', () => {
      expect(hex('\0\0')).toEqual('0x0000')
    })

    test('encodes ascii as hex', () => {
      expect(hex('aa')).toEqual('0x6161')
    })
  })

  describe('uint8Array', () => {
    test('converts to an array of 8-bit unsigned integers', () => {
      expect(uint8Array('')).toEqual(new Uint8Array([]))
      expect(uint8Array('Å')).toEqual(new Uint8Array([197]))
    })
  })

  describe('uint8ArrayToHex', () => {
    test('converts an array of 8-bit unsigned integers to hex', () => {
      expect(uint8ArrayToHex(new Uint8Array([197]))).toEqual('0xc5')
    })
  })
})
