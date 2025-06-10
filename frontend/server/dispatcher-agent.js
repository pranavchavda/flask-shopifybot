import { Agent } from '@openai/agents';
import { webSearchExecutorTool } from './executor-websearch.js';
import { shopifyExecutorTool } from './executor-shopify.js';

/**
 * Create a todo executor tool for handling todo MCP operations
 */
function createTodoExecutorTool() {
  // We'll create a simple todo executor that connects to the todo MCP server
  
  const todoExecutorAgent = new Agent({
    name: 'TodoExecutorAgentInternal',
    instructions: `You are a todo operations specialist. Your SOLE function is to execute todo operations using tools available through the Todo MCP Server.

Input: You will receive a JSON object with an 'action' key (string) and an 'args' key (object).

Your Responsibilities:
1. The 'action' provided MUST EXACTLY match the name of a tool available to you via the Todo MCP Server.
2. You MUST use the tool corresponding to the 'action' and pass the provided 'args' to it.
3. Your output MUST be the direct, raw JSON response from the todo tool.
4. If the 'action' does NOT match any available todo tool, output: {"error": "Invalid todo action", "actionAttempted": "<action_value>"}.

ABSOLUTELY DO NOT:
- Engage in conversation.
- Provide explanations or summaries.
- Output any text other than the raw JSON tool result or the specified error JSON object.`,
    model: process.env.EXECUTOR_MODEL || 'gpt-4.1',
    // Note: MCP server connection will be handled elsewhere
  });

  return todoExecutorAgent.asTool(
    'TodoToolExecutor',
    'Performs todo operations. Input should be an object like {"action": "tool_to_call_on_todo_mcp", ...args}. Returns the result of the todo operation.'
  );
}

/**
 * Create a dispatcher agent with dynamically discovered tools
 */
export function createDispatcherTool(discoveredTools) {
  const availableToolNames = discoveredTools.allTools.map(t => t.name).join(', ');
  
  const todoExecutorTool = createTodoExecutorTool();
  
  const taskDispatcherAgent = new Agent({
    name: 'TaskDispatcherAgent',
    instructions: `You are a meticulous task dispatcher.
You will receive a user's 'originalQuery' and a JSON 'plan' as input. The plan outlines tasks to be executed.
Your role is to parse the plan, then sequentially execute each task using the EXACT 'agent_tool_name' and 'args' specified in the plan.

Available tools discovered from MCP servers:
${availableToolNames}

You have access to the following executor tools:
- WebSearchToolExecutor: For web searches
- ShopifyToolExecutor: For Shopify store operations  
- TodoToolExecutor: For todo/task management operations

CRITICAL: Use the exact tool names that were discovered from the MCP servers. Do NOT use tool names that are not in the discovered list.

After all tasks are completed, compile all their outputs into a JSON array.
Respond ONLY with a JSON object with a single top-level key "response", whose value is a JSON array of objects, each with:
- "taskId": number
- "output": the result of the task
- optional "error": string if the task failed

Example:
[
  {"taskId": 1, "output": "Output of task 1"},
  {"taskId": 2, "output": "Error: Something went wrong with task 2"}
]
Do not add any commentary.`,
    model: process.env.DISPATCHER_MODEL || 'gpt-4.1-mini',
    tools: [
      webSearchExecutorTool,
      shopifyExecutorTool,
      todoExecutorTool
    ]
  });

  // Convert TaskDispatcherAgent to a tool
  return taskDispatcherAgent.asTool(
    'dispatch',
    'Delegate to TaskDispatcherAgent for task execution. Input should be of the form {originalQuery: string, plan: [], conversationHistory: string}.'
  );
}