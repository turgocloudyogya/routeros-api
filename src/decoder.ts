export function decodeWord(buffer: Buffer): string[] {
  const words: string[] = []
  let offset = 0

  while (offset < buffer.length) {
    let lengthByte = buffer.readUInt8(offset)
    let wordLength: number
    let headerSize = 1

    if ((lengthByte & 0x80) === 0x00) {
      wordLength = lengthByte
    } else if ((lengthByte & 0xC0) === 0x80) {
      wordLength = ((lengthByte & 0x3F) << 8) + buffer.readUInt8(offset + 1)
      headerSize = 2
    } else if ((lengthByte & 0xE0) === 0xC0) {
      wordLength =
        ((lengthByte & 0x1F) << 16) +
        (buffer.readUInt8(offset + 1) << 8) +
        buffer.readUInt8(offset + 2)
      headerSize = 3
    } else if ((lengthByte & 0xF0) === 0xE0) {
      wordLength =
        ((lengthByte & 0x0F) << 24) +
        (buffer.readUInt8(offset + 1) << 16) +
        (buffer.readUInt8(offset + 2) << 8) +
        buffer.readUInt8(offset + 3)
      headerSize = 4
    } else if ((lengthByte & 0xF8) === 0xF0) {
      wordLength =
        (buffer.readUInt8(offset + 1) << 24) +
        (buffer.readUInt8(offset + 2) << 16) +
        (buffer.readUInt8(offset + 3) << 8) +
        buffer.readUInt8(offset + 4)
      headerSize = 5
    } else {
      break
    }

    if (wordLength === 0) {
      words.push("")
      offset += headerSize
      if (offset >= buffer.length) break
      continue
    }

    const startOfWord = offset + headerSize
    const endOfWord = startOfWord + wordLength

    if (endOfWord > buffer.length) {
      break
    }

    const word = buffer.slice(startOfWord, endOfWord).toString("utf8")
    words.push(word)
    offset = endOfWord
  }

  return words
}
