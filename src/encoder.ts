export function encodeWord(word: string): Buffer {
  const textBuffer = Buffer.from(word)
  const textLength = textBuffer.length

  if (textLength < 0x80) {
    return Buffer.concat([Buffer.from([textLength]), textBuffer])
  }

  if (textLength < 0x4000) {
    return Buffer.concat([
      Buffer.from([((textLength >> 8) | 0x80), (textLength & 0xFF)]),
      textBuffer,
    ])
  }

  if (textLength < 0x200000) {
    return Buffer.concat([
      Buffer.from([((textLength >> 16) | 0xC0), ((textLength >> 8) & 0xFF), (textLength & 0xFF)]),
      textBuffer,
    ])
  }

  if (textLength < 0x10000000) {
    return Buffer.concat([
      Buffer.from([((textLength >> 24) | 0xE0), ((textLength >> 16) & 0xFF), ((textLength >> 8) & 0xFF), (textLength & 0xFF)]),
      textBuffer,
    ])
  }

  return Buffer.concat([
    Buffer.from([0xF0, ((textLength >> 24) & 0xFF), ((textLength >> 16) & 0xFF), ((textLength >> 8) & 0xFF), (textLength & 0xFF)]),
    textBuffer,
  ])
}
