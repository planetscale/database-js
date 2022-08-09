export function utf8Encode(text: string | null): string {
  return text ? binaryToHex(text) : ''
}

function binaryToHex(text: string): string {
  const decoder = new TextDecoder('utf-8')
  const arr = []
  text.split('').forEach(function (c) {
    arr.push(c.charCodeAt(0))
  })
  return decoder.decode(Uint8Array.from(arr))
}
