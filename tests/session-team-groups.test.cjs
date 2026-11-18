const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { transformSync } = require('esbuild')

const sourcePath = path.join(__dirname, '..', 'src', 'utils', 'session-team-groups.js')
const source = fs.readFileSync(sourcePath, 'utf8')
const transformed = transformSync(source, {
  loader: 'js',
  format: 'cjs',
  platform: 'node'
})
const testModule = { exports: {} }
new Function('module', 'exports', 'require', transformed.code)(testModule, testModule.exports, require)

const {
  buildSessionListGroups,
  mergeSessionOrderWithHidden,
  moveSessionIdsInOrder,
  orderSessionsByList
} = testModule.exports

const sessions = [
  { id: 'loose-new', teamId: null, updatedAt: '2026-11-15T12:00:00.000Z' },
  { id: 'member', teamId: 'team-a', teamName: 'Alpha Team', role: 'member', updatedAt: '2026-11-15T11:00:00.000Z' },
  { id: 'leader', teamId: 'team-a', teamName: 'Alpha Team', role: 'leader', updatedAt: '2026-11-15T10:00:00.000Z' },
  { id: 'stale', teamId: 'team-b', role: 'member', updatedAt: '2026-11-15T09:00:00.000Z' },
  { id: 'loose-old', updatedAt: '2026-11-15T08:00:00.000Z' }
]

const groups = buildSessionListGroups(sessions)
assert.strictEqual(groups.length, 4)
assert.strictEqual(groups[0].key, 'session:loose-new')
assert.strictEqual(groups[1].key, 'team:team-a')
assert.strictEqual(groups[1].teamName, 'Alpha Team')
assert.deepStrictEqual(groups[1].sessions.map(session => session.id), ['member', 'leader'])
assert.strictEqual(groups[2].key, 'team:team-b')
assert.strictEqual(groups[2].teamName, '团队 team-b')
assert.strictEqual(groups[3].key, 'session:loose-old')

const orderedSessions = orderSessionsByList(sessions, [
  'loose-old',
  'member',
  'leader',
  'stale'
])
assert.deepStrictEqual(
  orderedSessions.map(session => session.id),
  ['loose-new', 'loose-old', 'member', 'leader', 'stale']
)

assert.deepStrictEqual(
  moveSessionIdsInOrder(
    ['a', 'b', 'c', 'd'],
    ['c'],
    ['a'],
    'before'
  ),
  ['c', 'a', 'b', 'd']
)
assert.deepStrictEqual(
  moveSessionIdsInOrder(
    ['a', 'b', 'c', 'd'],
    ['a', 'b'],
    ['d'],
    'after'
  ),
  ['c', 'd', 'a', 'b']
)
assert.deepStrictEqual(
  mergeSessionOrderWithHidden(
    ['c', 'a', 'b'],
    ['a', 'hidden', 'b', 'c'],
    ['a', 'b', 'c', 'hidden']
  ),
  ['c', 'a', 'hidden', 'b']
)
assert.deepStrictEqual(
  mergeSessionOrderWithHidden(
    ['b', 'a'],
    ['hidden-first', 'a', 'b', 'stale'],
    ['a', 'b', 'hidden-first']
  ),
  ['hidden-first', 'b', 'a']
)

const flatGroups = buildSessionListGroups(sessions, { groupTeams: false })
assert.strictEqual(flatGroups.length, sessions.length)
assert(flatGroups.every(group => group.teamId === null && group.sessions.length === 1))

console.log('session-team-groups-tests: ok')
