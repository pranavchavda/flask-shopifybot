import { Agent, MCPServerStdio } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';

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

// Create agent with MCP server
export const basicChatAgent = new Agent({
  name: 'BasicChatbot',
  model: process.env.OPENAI_MODEL || 'gpt-4.1',
  instructions: `You are a simple AI assistant for a coffee shop called iDrinkCoffee.
    
Respond to user queries in a helpful and friendly manner.
Keep your responses concise and casual.

You have access to Shopify tools to help with store-related questions.
Use these tools when appropriate to answer questions about products, collections, orders, etc.

Always respond in a friendly, helpful tone as an assistant for iDrinkCoffee shop.`,
  mcpServers: [shopifyMCPServer],

});

console.log('Created basic agent with Shopify MCP integration');
console.log('======= BASIC-AGENT.JS INITIALIZATION COMPLETE =======');
