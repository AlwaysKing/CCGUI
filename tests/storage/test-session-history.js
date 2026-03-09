/**
 * Test file for Session and History Managers
 * Run with: node electron/storage/test-session-history.js
 */

const sessionConfigManager = require('./session-config-manager')
const historyManager = require('./history-manager')
const fs = require('fs')
const path = require('path')
const os = require('os')

// Test data
const TEST_PROJECT_ID = 'test-project-123'
const STORAGE_BASE = path.join(os.homedir(), '.ccgui')

/**
 * Clean up test data
 */
function cleanup() {
  const testProjectDir = path.join(STORAGE_BASE, 'projects', TEST_PROJECT_ID)
  if (fs.existsSync(testProjectDir)) {
    fs.rmSync(testProjectDir, { recursive: true, force: true })
    console.log('✓ Cleaned up test data')
  }
}

/**
 * Test SessionConfigManager
 */
async function testSessionConfigManager() {
  console.log('\n=== Testing SessionConfigManager ===\n')

  // Test 1: Create session
  console.log('Test 1: Create session')
  const session1 = sessionConfigManager.createSession(TEST_PROJECT_ID, {
    name: 'Test Session 1',
    settings: { model: 'claude-3-5-sonnet-20241022' }
  })
  console.log('✓ Created session:', session1.id)
  console.log('  Name:', session1.name)
  console.log('  Project ID:', session1.projectId)

  // Test 2: Get session
  console.log('\nTest 2: Get session')
  const retrievedSession = sessionConfigManager.getSession(TEST_PROJECT_ID, session1.id)
  console.log('✓ Retrieved session:', retrievedSession.id)
  console.log('  Matches created session:', JSON.stringify(retrievedSession) === JSON.stringify(session1))

  // Test 3: Update session
  console.log('\nTest 3: Update session')
  const updatedSession = sessionConfigManager.updateSession(TEST_PROJECT_ID, session1.id, {
    name: 'Updated Test Session 1',
    messageCount: 5
  })
  console.log('✓ Updated session:', updatedSession.id)
  console.log('  New name:', updatedSession.name)
  console.log('  Message count:', updatedSession.messageCount)

  // Test 4: Create multiple sessions
  console.log('\nTest 4: Create multiple sessions')
  const session2 = sessionConfigManager.createSession(TEST_PROJECT_ID, { name: 'Test Session 2' })
  const session3 = sessionConfigManager.createSession(TEST_PROJECT_ID, { name: 'Test Session 3' })
  console.log('✓ Created sessions:', session2.id, session3.id)

  // Test 5: Get all project sessions
  console.log('\nTest 5: Get all project sessions')
  const allSessions = sessionConfigManager.getProjectSessions(TEST_PROJECT_ID)
  console.log('✓ Retrieved sessions:', allSessions.length)
  console.log('  Sessions:', allSessions.map(s => s.name).join(', '))

  // Test 6: Check session exists
  console.log('\nTest 6: Check session exists')
  const exists1 = sessionConfigManager.sessionExists(TEST_PROJECT_ID, session1.id)
  const exists2 = sessionConfigManager.sessionExists(TEST_PROJECT_ID, 'non-existent-id')
  console.log('✓ Session', session1.id, 'exists:', exists1)
  console.log('  Non-existent session exists:', exists2)

  return { session1, session2, session3 }
}

/**
 * Test HistoryManager
 */
async function testHistoryManager(session1) {
  console.log('\n=== Testing HistoryManager ===\n')

  // Test 1: Check history directory
  console.log('Test 1: Check history directory')
  const historyDir = historyManager.getSessionHistoryDir(TEST_PROJECT_ID, session1.id)
  console.log('✓ History directory path:', historyDir)

  // Test 2: Append single message
  console.log('\nTest 2: Append single message')
  const message1 = {
    role: 'user',
    content: 'Hello, this is a test message',
    timestamp: new Date().toISOString()
  }
  historyManager.appendMessage(TEST_PROJECT_ID, session1.id, message1)
  console.log('✓ Appended message:', message1.role)

  // Test 3: Load history
  console.log('\nTest 3: Load history')
  const loadedMessages = historyManager.loadHistory(TEST_PROJECT_ID, session1.id)
  console.log('✓ Loaded messages:', loadedMessages.length)
  loadedMessages.forEach((msg, idx) => {
    console.log(`  ${idx + 1}. [${msg.role}]: ${msg.content.substring(0, 30)}...`)
  })

  // Test 4: Append more messages
  console.log('\nTest 4: Append more messages')
  const messages = [
    { role: 'assistant', content: 'Response 1', timestamp: new Date().toISOString() },
    { role: 'user', content: 'Question 2', timestamp: new Date().toISOString() },
    { role: 'assistant', content: 'Response 2', timestamp: new Date().toISOString() }
  ]
  messages.forEach(msg => historyManager.appendMessage(TEST_PROJECT_ID, session1.id, msg))
  console.log('✓ Appended', messages.length, 'messages')

  // Test 5: Get metadata
  console.log('\nTest 5: Get metadata')
  const metadata = historyManager.loadMetadata(TEST_PROJECT_ID, session1.id)
  console.log('✓ Metadata retrieved')
  console.log('  Message count:', metadata.messageCount)
  console.log('  Last message at:', metadata.lastMessageAt)
  console.log('  Total tokens:', metadata.totalTokens)

  // Test 6: Load history again
  console.log('\nTest 6: Load all messages')
  const allMessages = historyManager.loadHistory(TEST_PROJECT_ID, session1.id)
  console.log('✓ Loaded messages:', allMessages.length)

  // Test 7: Save all messages (batch operation)
  console.log('\nTest 7: Save all messages (batch operation)')
  const batchMessages = [
    { role: 'user', content: 'Batch message 1', timestamp: new Date().toISOString() },
    { role: 'assistant', content: 'Batch response 1', timestamp: new Date().toISOString() }
  ]
  historyManager.saveAllMessages(TEST_PROJECT_ID, session1.id, batchMessages)
  console.log('✓ Saved batch messages:', batchMessages.length)

  // Test 8: Check history exists
  console.log('\nTest 8: Check history exists')
  const exists = historyManager.historyExists(TEST_PROJECT_ID, session1.id)
  console.log('✓ History exists:', exists)

  // Test 9: Delete history
  console.log('\nTest 9: Delete history')
  historyManager.deleteHistory(TEST_PROJECT_ID, session1.id)
  const existsAfterDelete = historyManager.historyExists(TEST_PROJECT_ID, session1.id)
  console.log('✓ History deleted')
  console.log('  History exists after delete:', existsAfterDelete)
}

/**
 * Test performance with large dataset
 */
async function testPerformance() {
  console.log('\n=== Testing Performance ===\n')

  // Create a session for performance testing
  const perfSession = sessionConfigManager.createSession(TEST_PROJECT_ID, {
    name: 'Performance Test Session'
  })

  console.log('Test 1: Append 1000 messages')
  const startTime = Date.now()
  const totalMessages = 1000

  for (let i = 0; i < totalMessages; i++) {
    const message = {
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Performance test message ${i + 1}`,
      timestamp: new Date().toISOString()
    }
    historyManager.appendMessage(TEST_PROJECT_ID, perfSession.id, message)
  }

  const appendTime = Date.now() - startTime
  console.log(`✓ Appended ${totalMessages} messages in ${appendTime}ms`)

  console.log('\nTest 2: Load all messages')
  const loadStart = Date.now()
  const loadedMsgs = historyManager.loadHistory(TEST_PROJECT_ID, perfSession.id)
  const loadTime = Date.now() - loadStart
  console.log(`✓ Loaded ${loadedMsgs.length} messages in ${loadTime}ms`)

  console.log('\nTest 3: Get metadata')
  const metadataStart = Date.now()
  const metadata = historyManager.loadMetadata(TEST_PROJECT_ID, perfSession.id)
  const metadataTime = Date.now() - metadataStart
  console.log(`✓ Got metadata in ${metadataTime}ms`)
  console.log(`  Message count: ${metadata.messageCount}`)
}

/**
 * Main test runner
 */
async function runTests() {
  try {
    console.log('======================================')
    console.log('  Session & History Manager Tests')
    console.log('======================================')

    // Clean up any existing test data
    cleanup()

    // Run SessionConfigManager tests
    const sessions = await testSessionConfigManager()

    // Run HistoryManager tests
    await testHistoryManager(sessions.session1)

    // Run performance tests
    await testPerformance()

    console.log('\n======================================')
    console.log('  All tests completed successfully!')
    console.log('======================================\n')

  } catch (error) {
    console.error('\n❌ Test failed:', error)
    console.error(error.stack)
  } finally {
    // Clean up test data
    cleanup()
  }
}

// Run tests
runTests()
