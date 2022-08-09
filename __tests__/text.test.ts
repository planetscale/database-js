import { utf8Encode } from '../src/text'

describe('text', () => {
  describe('utf8Encode', () => {
    test('encodes "a" properly', () => {
      expect(utf8Encode('a')).toEqual('a')
    })

    test('encodes "\\a" properly', () => {
      expect(utf8Encode('\\a')).toEqual('\\a')
    })

    test('encodes empty string', () => {
      expect(utf8Encode('')).toEqual('')
    })

    test('encodes null value', () => {
      expect(utf8Encode(null)).toEqual('')
    })

    test('encodes undefined value', () => {
      expect(utf8Encode(undefined)).toEqual('')
    })
  })
})
