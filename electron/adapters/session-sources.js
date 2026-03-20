const { claudeSessionSource } = require('./claude/session-source')
const { codexSessionSource } = require('./codex/session-source')

const providerSessionSources = [
  claudeSessionSource,
  codexSessionSource
]

const providerSessionSourcesById = Object.fromEntries(
  providerSessionSources.map(source => [source.provider, source])
)

module.exports = {
  providerSessionSources,
  providerSessionSourcesById
}
