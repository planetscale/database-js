export function utf8Encode(str: string | null): string {
  if (str === '' || str === null) {
    return ''
  }

  return binaryToHex(str)
}

function binaryToHex(str: string): string {
  const decoder = new TextDecoder('utf-8')
  const arr = []
  str.split('').forEach(function (c) {
    arr.push(c.charCodeAt(0))
  })
  return decoder.decode(Uint8Array.from(arr))
}
