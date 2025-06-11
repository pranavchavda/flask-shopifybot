import { Agent } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';
import { MCPServerStdio } from '@openai/agents';

// Debug logging for startup
console.log('======= BASIC-AGENT-UNIFIED.JS INITIALIZATION =======');
console.log('OPENAI_API_KEY available:', !!process.env.OPENAI_API_KEY);
console.log('MCP_BEARER_TOKEN available:', !!process.env.MCP_BEARER_TOKEN);

// Set the OpenAI API key for the agent to use
setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
console.log('Set default OpenAI API key');

// --- Shopify MCP server configuration ---
const childEnv = { ...process.env };

const shopifyMCPServer = new MCPServerStdio({
  name: 'Shopify MCP Server',
  command: 'npx',
  args: ['-y', '@pranavchavda/shopify-mcp-stdio-client'],
  env: childEnv,
  shell: true,
});
await shopifyMCPServer.connect();
console.log('Configured Shopify MCP Server');

// --- Todo MCP server configuration ---
const todoMCPServer = new MCPServerStdio({
  name: 'Todo MCP Server',
  command: 'npx',
  args: ['-y', '@pranavchavda/todo-mcp-server'],
  env: childEnv,
  shell: true,
});
await todoMCPServer.connect();
console.log('Configured Todo MCP Server');

// Create the unified agent that handles both planning and execution
export const unifiedAgent = new Agent({
  name: 'EspressoBot',
  instructions: `You are EspressoBot, an AI assistant for a coffee shop that helps with Shopify store management and task organization.

**Your Approach:**
1. When you receive a request, first analyze what needs to be done
2. Break it down into steps and create tasks using the create_task tool
3. Execute each task using the appropriate tools
4. Update task status as you progress (use update_task or complete_task)
5. Provide a clear summary of what was accomplished

**Task Management:**
- ALWAYS include conversation_id when creating tasks to link them to the current conversation
- Use create_task to plan out the steps needed (with conversation_id)
- Use update_task to mark tasks as in progress when you start them
- Use complete_task when you finish a task
- Use list_tasks to show current tasks when asked

**Available Tool Categories:**
1. Todo/Task Management: create_task, update_task, delete_task, complete_task, list_tasks
2. Shopify Operations: search_products, update_pricing, create products, manage collections, etc.
3. Web Search: For external information

**Important Guidelines:**
- Always create tasks for complex operations to show progress
- Update task status in real-time as you work
- Provide clear feedback about what you're doing
- If a task fails, update its status and explain the issue

**Example Flow:**
User: "Find the price of SKU PRO-GO" (conversation_id: 123)
1. create_task(title="Search for product SKU PRO-GO", conversation_id=123)
2. update_task(id=task_id, status="in_progress") 
3. search_products(query="SKU:PRO-GO")
4. complete_task(id=task_id)
5. Return the price information

**CRITICAL: Always include conversation_id in create_task calls!**
Example: create_task(title="My Task", description="Task details", conversation_id=123)`,
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  modelSettings: { 
    temperature: 0.7
  },
  mcpServers: [shopifyMCPServer, todoMCPServer],
});

console.log('Created unified agent with direct MCP integration');
console.log('======= BASIC-AGENT-UNIFIED.JS INITIALIZATION COMPLETE =======');

export { todoMCPServer, shopifyMCPServer };