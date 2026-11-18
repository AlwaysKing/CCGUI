const TIME_ZONE = 'Asia/Shanghai'

function getBuildTimeParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  })
  const values = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
  }
  return values
}

function formatBuildVersion(date = new Date()) {
  const { year, month, day, hour, minute } = getBuildTimeParts(date)
  const minutes = Number(hour) * 60 + Number(minute)
  return `${year}.${Number(month)}.${Number(day)}.${minutes}`
}

function resolveBuildVersion(date = new Date()) {
  return process.env.CCGUI_BUILD_VERSION || formatBuildVersion(date)
}

function getBundleVersion(buildVersion = resolveBuildVersion()) {
  return buildVersion.split('.').slice(0, 3).join('.')
}

function writeGithubOutput() {
  const buildVersion = resolveBuildVersion()
  process.stdout.write(`build_version=${buildVersion}\n`)
  process.stdout.write(`bundle_version=${getBundleVersion(buildVersion)}\n`)
}

if (require.main === module) {
  const mode = process.argv[2]
  if (mode === '--github-output') {
    writeGithubOutput()
  } else if (mode === 'bundle') {
    process.stdout.write(`${getBundleVersion()}\n`)
  } else {
    process.stdout.write(`${resolveBuildVersion()}\n`)
  }
}

module.exports = {
  TIME_ZONE,
  formatBuildVersion,
  getBundleVersion,
  resolveBuildVersion
}
