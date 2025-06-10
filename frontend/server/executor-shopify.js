import { Agent, MCPServerStdio } from '@openai/agents';

// ShopifyExecutorAgent
// Configure the Shopify MCP server for the executor
const childEnv = { ...process.env };

const shopifyMcpServer = new MCPServerStdio({
  name: 'Shopify MCP Server',
  command: 'npx',
  args: ['-y', '@pranavchavda/shopify-mcp-stdio-client'],
  env: childEnv,
  shell: true,
});
await shopifyMcpServer.connect();

export const shopifyExecutorAgent = new Agent({
  name: 'ShopifyExecutorAgentInternal',
  instructions: `You are a Shopify operations specialist. Your SOLE function is to execute Shopify operations using tools available through the Shopify MCP Server.

Input: You will receive a JSON object with an 'action' key (string) and an 'args' key (object).

Your Responsibilities:
1.  The 'action' provided MUST EXACTLY match the name of a tool available to you via the Shopify MCP Server.
2.  You MUST use the tool corresponding to the 'action' and pass the provided 'args' to it.
3.  Your output MUST be the direct, raw JSON response from the Shopify tool.
4.  If the 'action' does NOT match any available Shopify tool, or if the tool execution results in an error, your output MUST be a JSON object of the form: {"error": "Descriptive error message", "actionAttempted": "<action_value>"}.

ABSOLUTELY DO NOT:
-   Engage in conversation.
-   Provide explanations or summaries.
-   Attempt to perform actions not directly mapped to an available Shopify tool.
-   Output any text other than the raw JSON tool result or the specified error JSON object.

Example of valid tool use:
Input: {"action": "search_products", "args": {"query": "red t-shirts"}}
(You internally call the 'search_products' tool with '{"query": "red t-shirts"}')
Output: (Raw JSON result from the 'search_products' tool)

Example of handling an unknown action:
Input: {"action": "invent_new_product_category", "args": {}}
Output: {"error": "Action 'invent_new_product_category' is not a valid Shopify tool.", "actionAttempted": "invent_new_product_category"}
`,
  model: process.env.EXECUTOR_MODEL || 'gpt-4.1',
  mcpServers: [shopifyMcpServer],
});

// Convert ShopifyExecutorAgent to a tool
export const shopifyExecutorTool = shopifyExecutorAgent.asTool(
  'ShopifyToolExecutor',
  'Performs Shopify operations. Input should be an object like {"action": "tool_to_call_on_shopify_mcp", ...args}. Returns the result of the Shopify operation.'
);