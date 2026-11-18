const assert = require('assert')
const {
  formatBuildVersion,
  getBundleVersion
} = require('../scripts/build-version.cjs')

const sample = new Date('2026-11-17T17:22:00Z')
assert.strictEqual(formatBuildVersion(sample), '2026.11.18.82')
assert.strictEqual(formatBuildVersion(new Date('2026-11-17T16:00:00Z')), '2026.11.18.0')
assert.strictEqual(getBundleVersion('2026.11.18.82'), '2026.11.18')

console.log('build-version tests passed')
