import { Agent } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';

// Debug logging for startup
console.log('======= SUPER-SIMPLE-AGENT.JS INITIALIZATION =======');
console.log('OPENAI_API_KEY available:', !!process.env.OPENAI_API_KEY);

// Set the OpenAI API key for the agent to use
setDefaultOpenAIKey(process.env.OPENAI_API_KEY);
console.log('Set default OpenAI API key');

// Create a very simple agent without any MCP servers
export const superSimpleAgent = new Agent({
  name: 'SuperSimpleChatbot',
  model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
  instructions: `You are a simple AI assistant for a coffee shop called iDrinkCoffee.
    
Respond to user queries in a helpful and friendly manner.
Keep your responses concise and casual.

You do not have access to any external tools or services.
Provide general information and be helpful within your training knowledge.

Always respond in a friendly, helpful tone as an assistant for iDrinkCoffee shop.`,
  // No MCP servers or tools - completely standalone
});

console.log('Created super simple agent without MCP integration');
console.log('======= SUPER-SIMPLE-AGENT.JS INITIALIZATION COMPLETE =======');