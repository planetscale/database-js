export function utf8Encode(text: string | null): string {
  return text ? binaryToHex(text) : ''
}

function binaryToHex(text: string): string {
  const decoder = new TextDecoder('utf-8')
  const bytes = text.split('').map((c) => c.charCodeAt(0))
  return decoder.decode(Uint8Array.from(bytes))
}
