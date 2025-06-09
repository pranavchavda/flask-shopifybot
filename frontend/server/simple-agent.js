import { Agent, MCPServerStdio } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';

// Debug logging for startup
console.log('======= SIMPLE-AGENT.JS INITIALIZATION =======');

// --- Shopify MCP server configuration ---
// Ensure OpenAI API key is set
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Define the Shopify MCP server configuration using MCPServerStdio
// Prepare environment with proper inheritance
const childEnv = { ...process.env };
childEnv.MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

// Create the MCP server with shell:true to resolve path issues
const shopifyMCPServer = new MCPServerStdio({
  name: 'Shopify MCP Server',
  command: 'npx',
  args: [
    '-y',
    '@pranavchavda/shopify-mcp-stdio-client@latest'
  ],
  env: childEnv,
  shell: true // Use shell to resolve path issues
});

console.log('Created Shopify MCP server configuration');

// Set the OpenAI API key for the agent to use
setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
console.log('Set default OpenAI API key');

// Create a simple chatbot agent with Shopify MCP tools
export const simpleChatAgent = new Agent({
  name: 'ShopifyBot',
  model: process.env.OPENAI_MODEL || 'gpt-4o',
  instructions: `You are EspressoBot, a helpful assistant for a coffee shop called iDrinkCoffee.
    
You have access to various Shopify tools to help with product management and operations for the coffee shop.
You can search for products, get product details, update products, and more.

When asked questions about coffee or products, provide helpful and friendly responses.
When asked to perform operations on the Shopify store, use the appropriate tools to do so.

Always respond in a friendly, helpful tone as an assistant for iDrinkCoffee shop.`,
  mcpServers: [shopifyMCPServer]
});

// Initialize the MCP server connection
export async function initializeMCPServer() {
  try {
    console.log('Attempting to connect to Shopify MCP server...');
    await shopifyMCPServer.connect();
    console.log('Successfully connected to Shopify MCP server');
    return true;
  } catch (error) {
    console.error('Failed to connect to Shopify MCP server:', error);
    return false;
  }
}

// Close the MCP server connection
export async function closeMCPServer() {
  try {
    await shopifyMCPServer.close();
    console.log('Successfully closed Shopify MCP server connection');
    return true;
  } catch (error) {
    console.error('Failed to close Shopify MCP server connection:', error);
    return false;
  }
}

console.log('======= SIMPLE-AGENT.JS INITIALIZATION COMPLETE =======');
