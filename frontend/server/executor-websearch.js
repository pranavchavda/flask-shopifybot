import { Agent } from '@openai/agents';
import { webSearchTool } from '@openai/agents-openai';

// WebSearchExecutorAgent
export const webSearchExecutorAgent = new Agent({
  name: 'WebSearchExecutorAgentInternal',
  instructions: 'You are a web search specialist. Execute the web search task precisely based on the provided query and return the result.',
  model: process.env.EXECUTOR_MODEL || 'gpt-4.1',
  tools: [
    new webSearchTool({
      search_context_size: 'medium',
    }),
  ],
  tool_use_behavior: 'stop_on_first_tool',
});

// Convert WebSearchExecutorAgent to a tool
export const webSearchExecutorTool = webSearchExecutorAgent.asTool(
  'WebSearchToolExecutor',
  'Performs a web search. Input should be an object like {"query": "search terms"}. Returns search results.'
);