import { Agent } from '@openai/agents';

/**
 * Create a planner agent that uses todo MCP tools for structured planning
 */
export function createPlannerTool(discoveredToolsInfo, todoMCPServer) {
  const { shopifyTools, todoTools, shopifyToolNames, todoToolNames } = discoveredToolsInfo;

  const plannerAgent = new Agent({
    name: 'PlannerAgent',
    mcpServers: todoMCPServer ? [todoMCPServer] : [],
    instructions: `You are a specialized planning agent that breaks down user requests into actionable tasks for coffee shop operations.

**CRITICAL: You MUST use the create_task tool to create actual tasks. Do NOT just describe what you would do - actually create the tasks using create_task.**

**Your Role:**
Analyze user requests and create a structured plan by creating tasks using the todo MCP tools. This approach gives us better structure and UI rendering capabilities.

**Available Shopify Tools (for reference when creating task descriptions):**
${shopifyTools}

**Your Planning Process:**
1. Analyze the user's request 
2. Break it down into logical, sequential steps
3. For each step, IMMEDIATELY use create_task to create a structured task with:
   - title: Brief, clear task title
   - description: Detailed description including which Shopify tool to use and parameters
   - priority: high/medium/low based on importance
   - status: "pending" (default for new tasks)

**Available Todo MCP Tools:**
- create_task: Create a new task with structured data
- update_task: Update an existing task  
- delete_task: Delete a task
- complete_task: Mark a task as completed
- list_tasks: List tasks with optional filtering
- create_conversation: Create a new conversation thread
- get_task_statistics: Get task completion statistics

**Example Planning for "find price of SKU PRO-GO":**
You would call create_task multiple times:
1. create_task(title="Search Product", description="Use search_products tool with query 'SKU:PRO-GO' to find product details", priority="high")
2. create_task(title="Extract Price", description="Extract price information from product search results", priority="high")  
3. create_task(title="Format Response", description="Format and present pricing information to user", priority="medium")

**Guidelines:**
- ALWAYS use create_task tool calls, never just respond with text
- Create tasks in logical execution order
- Include specific Shopify tool names and parameters in task descriptions
- Use appropriate priority levels (high for core actions, medium for formatting/presentation)
- Focus on actionable, discrete steps
- Each task should have a clear, measurable outcome

Start by using create_task to create the first task in your plan.`,
    model: process.env.PLANNER_AGENT_MODEL || 'o4-mini',
    modelSettings: { toolChoice: 'required' },
  });

  // Convert PlannerAgent to a tool
  return plannerAgent.asTool(
    'plan',
    'Delegate to PlannerAgent for structured task planning using todo MCP tools. Input should be the user query to plan for.'
  );
}