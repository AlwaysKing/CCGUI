function createEmptyTurnUsage(modelContextWindow = 0) {
  return {
    total_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_input_tokens: 0,
    reasoning_output_tokens: 0,
    model_context_window: modelContextWindow || 0
  }
}

function mergeTurnUsage(currentUsage = createEmptyTurnUsage(), nextUsage = {}) {
  return {
    ...currentUsage,
    total_tokens: (currentUsage.total_tokens || 0) + (nextUsage.total_tokens || 0),
    input_tokens: (currentUsage.input_tokens || 0) + (nextUsage.input_tokens || 0),
    output_tokens: (currentUsage.output_tokens || 0) + (nextUsage.output_tokens || 0),
    cache_read_input_tokens: (currentUsage.cache_read_input_tokens || 0) + (nextUsage.cache_read_input_tokens || 0),
    reasoning_output_tokens: (currentUsage.reasoning_output_tokens || 0) + (nextUsage.reasoning_output_tokens || 0),
    model_context_window: nextUsage.model_context_window || currentUsage.model_context_window || 0
  }
}

module.exports = {
  createEmptyTurnUsage,
  mergeTurnUsage
}
