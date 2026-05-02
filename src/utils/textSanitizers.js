const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])|(?:[A-Za-z]))/g

export function stripAnsi(value) {
  if (typeof value !== 'string') {
    return value
  }

  return value.replace(ANSI_ESCAPE_PATTERN, '')
}
