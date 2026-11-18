const { signAsync } = require('@electron/osx-sign')

module.exports = async function signMac(options) {
  const identity = options.identity || '-'
  const isAdHoc = identity === '-'

  return signAsync({
    ...options,
    identity,
    identityValidation: false,
    optionsForFile: filePath => {
      const fileOptions = options.optionsForFile?.(filePath) || {}
      return isAdHoc ? { ...fileOptions, timestamp: false } : fileOptions
    }
  })
}
