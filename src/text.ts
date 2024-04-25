const decoder = new TextDecoder('utf-8')

export function decodeUtf8(text: string | null | undefined): string {
  return text ? decoder.decode(uint8Array(text)) : ''
}

export function hex(text: string): string {
  const digits = bytes(text).map((b) => b.toString(16).padStart(2, '0'))
  return `0x${digits.join('')}`
}

export function uint8Array(text: string): Uint8Array {
  return Uint8Array.from(bytes(text))
}

export function uint8ArrayToHex(uint8: Uint8Array): string {
  const digits = Array.from(uint8).map((i) => i.toString(16).padStart(2, '0'))
  return `0x${digits.join('')}`
}

function bytes(text: string): number[] {
  return text.split('').map((c) => c.charCodeAt(0))
}
