function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/').trim()
}

function toPositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseHashLocation(hash = '') {
  const match = String(hash || '').match(/^#L(\d+)(?:-L?(\d+))?(?::(\d+))?$/i)
  if (!match) {
    return null
  }

  return {
    line: toPositiveInteger(match[1]),
    column: toPositiveInteger(match[3])
  }
}

function parseColonLocation(source = '') {
  const match = String(source || '').match(/^(.*?):(\d+)(?::(\d+))?$/)
  if (!match) {
    return null
  }

  return {
    path: match[1],
    line: toPositiveInteger(match[2]),
    column: toPositiveInteger(match[3])
  }
}

export function parseFileNavigationTarget(value = '') {
  const source = normalizePath(value)
  if (!source) {
    return { path: '', line: null, column: null }
  }

  const hashIndex = source.indexOf('#')
  if (hashIndex >= 0) {
    const hashLocation = parseHashLocation(source.slice(hashIndex))
    if (hashLocation) {
      return {
        path: source.slice(0, hashIndex),
        line: hashLocation.line,
        column: hashLocation.column
      }
    }
  }

  const colonLocation = parseColonLocation(source)
  if (colonLocation?.path) {
    return {
      path: normalizePath(colonLocation.path),
      line: colonLocation.line,
      column: colonLocation.column
    }
  }

  return { path: source, line: null, column: null }
}
