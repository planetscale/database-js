import { utf8Encode } from '../src/text'

describe('text', () => {
  describe('utf8Encode', () => {
    test('encodes "a" properly', () => {
      expect(utf8Encode('a')).toEqual('a')
    })

    test('encodes "\\a" properly', () => {
      expect(utf8Encode('\\a')).toEqual('\\a')
    })

    test('encodes blank string properly', () => {
      expect(utf8Encode('')).toEqual('')
    })
  })
})
