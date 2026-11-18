const fs = require('fs')
const path = require('path')
const { getCcguiHome } = require('../runtime-paths')

const STORE_VERSION = 1

function getTeamFilePath(projectId) {
  return path.join(getCcguiHome(), 'projects', projectId, 'agent-teams.json')
}

function loadTeams(projectId) {
  const filePath = getTeamFilePath(projectId)
  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return Array.isArray(raw?.teams) ? raw.teams : []
  } catch {
    return []
  }
}

function saveTeams(projectId, teams = []) {
  const filePath = getTeamFilePath(projectId)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({
    version: STORE_VERSION,
    teams
  }, null, 2), 'utf8')
}

function findTeam(teams, teamId) {
  return teams.find(team => team?.id === teamId) || null
}

function isTeamMember(team, sessionId) {
  return Boolean(team?.members?.[sessionId])
}

function removeTeam(teams, teamId) {
  const index = teams.findIndex(team => team?.id === teamId)
  if (index === -1) {
    return null
  }
  return teams.splice(index, 1)[0] || null
}

module.exports = {
  findTeam,
  isTeamMember,
  loadTeams,
  removeTeam,
  saveTeams
}
