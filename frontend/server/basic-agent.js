import { Agent, MCPServerStdio } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';
import { mcpToolDiscovery } from './mcp-tool-discovery.js';

// Debug logging for startup
console.log('======= BASIC-AGENT.JS INITIALIZATION =======');
console.log('OPENAI_API_KEY available:', !!process.env.OPENAI_API_KEY);
console.log('MCP_BEARER_TOKEN available:', !!process.env.MCP_BEARER_TOKEN);

// Set the OpenAI API key for the agent to use
setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
console.log('Set default OpenAI API key');

// --- Shopify MCP server configuration ---
// Prepare environment with proper inheritance. MCP_BEARER_TOKEN is expected to be in process.env.
const childEnv = { ...process.env };

const shopifyMCPServer = new MCPServerStdio({
  name: 'Shopify MCP Server',
  command: 'npx',
  args: ['-y', '@pranavchavda/shopify-mcp-stdio-client'],
  env: childEnv,
  shell: true, // Important for npx path resolution
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

// Discover available tools from MCP servers (with fallback)
console.log('🔍 Discovering MCP tools...');
let discoveredTools, toolsForPlanner;
try {
  discoveredTools = await mcpToolDiscovery.discoverTools();
  toolsForPlanner = mcpToolDiscovery.getFormattedToolsForPlanner();
} catch (error) {
  console.warn('⚠️ Tool discovery failed, using fallback tools:', error.message);
  discoveredTools = mcpToolDiscovery.getFallbackTools();
  mcpToolDiscovery.shopifyTools = discoveredTools.shopifyTools;
  mcpToolDiscovery.todoTools = discoveredTools.todoTools;
  toolsForPlanner = mcpToolDiscovery.getFormattedToolsForPlanner();
}

// Now create the planner and dispatcher with discovered tools
const { createPlannerTool } = await import('./planner-agent.js');
const { createDispatcherTool } = await import('./dispatcher-agent.js');

const plannerTool = createPlannerTool(toolsForPlanner, todoMCPServer);
const dispatcherTool = createDispatcherTool(discoveredTools);

console.log('=== AGENT TOOLS DEBUG ===');
console.log('Planner tool created:', !!plannerTool);
console.log('Dispatcher tool created:', !!dispatcherTool);
console.log('Planner tool name:', plannerTool?.name);
console.log('Dispatcher tool name:', dispatcherTool?.name);

// Create the main basic agent that integrates synthesizer functionality
export const basicChatAgent = new Agent({
  name: 'EspressoBot',
  tools: [plannerTool, dispatcherTool], 
  instructions: `You are EspressoBot. You MUST always use tools.

Use 'plan' tool first, then 'dispatch' tool.`,
  model: process.env.SYNTHESIZER_MODEL || 'gpt-4.1-mini',
  modelSettings: { 
    toolChoice: 'required',
    temperature: 0.1
  },
  mcpServers: [shopifyMCPServer, todoMCPServer],
});

console.log('Created basic agent with Shopify and Todo MCP integration and synthesizer functionality');
console.log('======= BASIC-AGENT.JS INITIALIZATION COMPLETE =======');
