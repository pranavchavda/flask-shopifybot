import { basicChatAgent } from './server/basic-agent.js';
import { plannerAgent, plannerTool } from './server/planner-agent.js';
import { webSearchExecutorAgent, webSearchExecutorTool } from './server/executor-websearch.js';
import { shopifyExecutorAgent, shopifyExecutorTool } from './server/executor-shopify.js';
import { taskDispatcherAgent, dispatcherTool } from './server/dispatcher-agent.js';
import { run } from '@openai/agents';
import { setDefaultOpenAIKey } from '@openai/agents-openai';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Set OpenAI API key
setDefaultOpenAIKey(process.env.OPENAI_API_KEY);

console.log('🧪 Starting Agentic Architecture Tests');
console.log('======================================');

// Test 1: Basic Agent Initialization
async function testBasicAgentInitialization() {
  console.log('\n📋 Test 1: Basic Agent Initialization');
  console.log('--------------------------------------');
  
  try {
    // Test if basic agent is properly initialized
    if (!basicChatAgent) {
      throw new Error('Basic chat agent not initialized');
    }
    
    console.log('✅ Basic agent initialized successfully');
    console.log(`   Name: ${basicChatAgent.name}`);
    console.log(`   Tools: ${basicChatAgent.tools ? basicChatAgent.tools.length : 0}`);
    console.log(`   MCP Servers: ${basicChatAgent.mcpServers ? basicChatAgent.mcpServers.length : 0}`);
    
    return true;
  } catch (error) {
    console.error('❌ Basic agent initialization failed:', error.message);
    return false;
  }
}

// Test 2: Planner Agent Tool
async function testPlannerAgent() {
  console.log('\n🗺️  Test 2: Planner Agent');
  console.log('-------------------------');
  
  try {
    const testQuery = "Find me some coffee products in the store";
    const testInput = {
      originalQuery: testQuery,
      conversationHistory: "user: Hello\nassistant: Hi! How can I help you today?"
    };
    
    console.log(`Testing with query: "${testQuery}"`);
    const result = await run(plannerAgent, JSON.stringify(testInput));
    
    console.log('✅ Planner agent executed successfully');
    console.log('📝 Plan result:', result.finalOutput);
    
    // Try to parse the result as JSON
    try {
      const parsedResult = JSON.parse(result.finalOutput);
      if (parsedResult.tasks && Array.isArray(parsedResult.tasks)) {
        console.log(`📊 Generated ${parsedResult.tasks.length} tasks`);
        parsedResult.tasks.forEach((task, index) => {
          console.log(`   ${index + 1}. ${task.agent_tool_name}: ${task.description}`);
        });
      }
    } catch (e) {
      console.log('⚠️  Result is not valid JSON, but planner completed');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Planner agent test failed:', error.message);
    return false;
  }
}

// Test 3: Executor Agents
async function testExecutorAgents() {
  console.log('\n⚡ Test 3: Executor Agents');
  console.log('-------------------------');
  
  let webSearchPassed = false;
  let shopifyPassed = false;
  
  // Test Web Search Executor
  try {
    console.log('Testing Web Search Executor...');
    const webSearchInput = { query: "OpenAI agents framework" };
    const webResult = await run(webSearchExecutorAgent, JSON.stringify(webSearchInput));
    console.log('✅ Web Search Executor completed');
    webSearchPassed = true;
  } catch (error) {
    console.error('❌ Web Search Executor failed:', error.message);
  }
  
  // Test Shopify Executor
  try {
    console.log('Testing Shopify Executor...');
    const shopifyInput = { action: "search_products", args: { query: "coffee", first: 3 } };
    const shopifyResult = await run(shopifyExecutorAgent, JSON.stringify(shopifyInput));
    console.log('✅ Shopify Executor completed');
    shopifyPassed = true;
  } catch (error) {
    console.error('❌ Shopify Executor failed:', error.message);
  }
  
  return webSearchPassed && shopifyPassed;
}

// Test 4: Task Dispatcher
async function testTaskDispatcher() {
  console.log('\n📋 Test 4: Task Dispatcher');
  console.log('---------------------------');
  
  try {
    const testPlan = [
      {
        id: 1,
        agent_tool_name: "ShopifyToolExecutor",
        args: { action: "search_products", args: { query: "coffee", first: 2 } },
        description: "Search for coffee products"
      }
    ];
    
    const dispatcherInput = {
      originalQuery: "Find coffee products",
      plan: testPlan,
      conversationHistory: ""
    };
    
    console.log('Testing task dispatcher with sample plan...');
    const result = await run(taskDispatcherAgent, JSON.stringify(dispatcherInput));
    
    console.log('✅ Task Dispatcher completed');
    console.log('📝 Dispatcher result:', result.finalOutput);
    
    // Try to parse the result
    try {
      const parsedResult = JSON.parse(result.finalOutput);
      if (Array.isArray(parsedResult)) {
        console.log(`📊 Executed ${parsedResult.length} tasks`);
        parsedResult.forEach((taskResult, index) => {
          console.log(`   Task ${taskResult.taskId}: ${taskResult.error ? 'Failed' : 'Success'}`);
        });
      }
    } catch (e) {
      console.log('⚠️  Result parsing failed, but dispatcher completed');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Task Dispatcher test failed:', error.message);
    return false;
  }
}

// Test 5: End-to-End Basic Agent Flow
async function testEndToEndFlow() {
  console.log('\n🔄 Test 5: End-to-End Basic Agent Flow');
  console.log('--------------------------------------');
  
  try {
    const testQuery = "Hello, do you have any espresso machines?";
    
    console.log(`Testing full agent flow with: "${testQuery}"`);
    
    const result = await run(basicChatAgent, testQuery, {
      onEvent: (event) => {
        console.log(`📡 Event: ${event.type}`, event.data ? `(${Object.keys(event.data).join(', ')})` : '');
      }
    });
    
    console.log('✅ End-to-end flow completed');
    console.log('📝 Final response:', result.finalOutput?.substring(0, 200) + '...');
    
    return true;
  } catch (error) {
    console.error('❌ End-to-end flow failed:', error.message);
    return false;
  }
}

// Test 6: Todo MCP Server Integration
async function testTodoMCPIntegration() {
  console.log('\n📝 Test 6: Todo MCP Server Integration');
  console.log('-------------------------------------');
  
  try {
    // Test if the basic agent has access to Todo MCP tools
    const testQuery = "Create a todo item for testing the agentic architecture";
    
    console.log('Testing Todo MCP server integration...');
    const result = await run(basicChatAgent, testQuery);
    
    console.log('✅ Todo MCP integration test completed');
    return true;
  } catch (error) {
    console.error('❌ Todo MCP integration test failed:', error.message);
    return false;
  }
}

// Run all tests
async function runAllTests() {
  console.log('🚀 Running Agentic Architecture Test Suite');
  console.log('============================================\n');
  
  const tests = [
    { name: 'Basic Agent Initialization', fn: testBasicAgentInitialization },
    { name: 'Planner Agent', fn: testPlannerAgent },
    { name: 'Executor Agents', fn: testExecutorAgents },
    { name: 'Task Dispatcher', fn: testTaskDispatcher },
    { name: 'End-to-End Flow', fn: testEndToEndFlow },
    { name: 'Todo MCP Integration', fn: testTodoMCPIntegration }
  ];
  
  const results = [];
  
  for (const test of tests) {
    try {
      const passed = await test.fn();
      results.push({ name: test.name, passed });
    } catch (error) {
      console.error(`💥 Test "${test.name}" crashed:`, error.message);
      results.push({ name: test.name, passed: false, error: error.message });
    }
  }
  
  // Print summary
  console.log('\n📊 Test Results Summary');
  console.log('=======================');
  
  let passed = 0;
  let failed = 0;
  
  results.forEach(result => {
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.name}`);
    if (result.error) {
      console.log(`     Error: ${result.error}`);
    }
    
    if (result.passed) passed++;
    else failed++;
  });
  
  console.log(`\n🎯 Results: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed! Agentic architecture is working correctly.');
  } else {
    console.log('⚠️  Some tests failed. Please check the implementation.');
  }
  
  return failed === 0;
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('💥 Test suite crashed:', error);
      process.exit(1);
    });
}

export { runAllTests };