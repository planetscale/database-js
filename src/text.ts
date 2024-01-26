const decoder = new TextDecoder('utf-8')

export function decode(text: string | null | undefined): string {
  return text ? decoder.decode(Uint8Array.from(bytes(text))) : ''
}

export function hex(text: string): string {
  const digits = bytes(text).map((b) => b.toString(16).padStart(2, '0'))
  return `0x${digits.join('')}`
}

function bytes(text: string): number[] {
  return text.split('').map((c) => c.charCodeAt(0))
}
