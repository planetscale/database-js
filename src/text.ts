export function decode(text: string | null): string {
  if (!text) return ''
  const decoder = new TextDecoder('utf-8')
  const bytes = text.split('').map((c) => c.charCodeAt(0))
  return decoder.decode(Uint8Array.from(bytes))
}
