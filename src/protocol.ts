import { encodeWord } from "./encoder"

export function buildCommand(words: string[]): Buffer {
  const parts: Buffer[] = []
  for (const word of words) {
    parts.push(encodeWord(word))
  }
  parts.push(encodeWord(""))
  return Buffer.concat(parts)
}

export function splitSentences(words: string[]): string[][] {
  const sentences: string[][] = []
  let current: string[] = []
  for (const w of words) {
    if (w === "") {
      if (current.length > 0) {
        sentences.push(current)
        current = []
      }
    } else {
      current.push(w)
    }
  }
  if (current.length > 0) {
    sentences.push(current)
  }
  return sentences
}

export type QueryValue = string | number | boolean
export type QueryRow = Record<string, QueryValue>

function isFormattableIP(s: string): boolean {
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?$/.test(s)) return true
  if (/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(s)) return true
  if (s.includes(":")) return true
  return false
}

export function autoFormatValue(s: string): QueryValue {
  const lower = s.toLowerCase()
  if (lower === "true") return true
  if (lower === "false") return false
  if (isFormattableIP(s)) return s
  if (/^-?\d+$/.test(s)) return parseInt(s, 10)
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s)
  return s
}

export function formatRows(rows: Record<string, string>[]): QueryRow[] {
  return rows.map((row) => {
    const f: QueryRow = {}
    for (const [k, v] of Object.entries(row)) {
      f[k] = autoFormatValue(v)
    }
    return f
  })
}

export function parseResponse(words: string[]): Record<string, string>[] {
  if (!Array.isArray(words) || words.length === 0) {
    return []
  }

  if (words[0] === "!done") {
    return [{ success: "true" }]
  }

  const trapIdx = words.indexOf("!trap")
  if (trapIdx !== -1) {
    const attrs: Record<string, string> = {}
    for (const w of words.slice(trapIdx + 1)) {
      if (w.startsWith("=.")) {
        const eqIdx = w.indexOf("=", 2)
        if (eqIdx > 2) {
          attrs[w.substring(2, eqIdx)] = w.substring(eqIdx + 1)
        } else {
          attrs[w.substring(2)] = ""
        }
      } else if (w.startsWith("=")) {
        const eqIdx = w.indexOf("=", 1)
        if (eqIdx > 1) {
          attrs[w.substring(1, eqIdx)] = w.substring(eqIdx + 1)
        } else {
          attrs[w.substring(1)] = ""
        }
      }
    }
    return [attrs]
  }

  const reIndices: number[] = words
    .map((w, i) => (w === "!re" ? i : -1))
    .filter((i) => i !== -1)

  if (reIndices.length === 0 && words.some((w) => !w.startsWith("!") && w !== "")) {
    reIndices.push(-1)
  }

  const results: Record<string, string>[] = []

  for (let i = 0; i < reIndices.length; i++) {
    const start = reIndices[i] + 1
    const end = reIndices[i + 1] !== undefined ? reIndices[i + 1] : words.length

    if (start >= end) continue

    const entry = words.slice(start, end).filter((w) => !w.startsWith("!") && w !== "")

    const obj: Record<string, string> = {}
    for (const prop of entry) {
      const cleaned = prop.startsWith("=.") ? prop.substring(2) : prop.substring(1)
      const eqIndex = cleaned.indexOf("=")
      if (eqIndex > 0) {
        const key = cleaned.substring(0, eqIndex)
        const value = cleaned.substring(eqIndex + 1)
        obj[key] = value
      } else if (eqIndex === -1) {
        obj[cleaned] = ""
      }
    }
    results.push(obj)
  }

  return results
}
