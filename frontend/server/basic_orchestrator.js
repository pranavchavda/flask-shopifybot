import { Router } from 'express';
import * as prismaClient from '@prisma/client';
import { run } from '@openai/agents';
import { basicChatAgent, todoMCPServer } from './basic-agent.js';

// Debug logging
console.log('======= BASIC_ORCHESTRATOR.JS INITIALIZATION =======');

const PrismaClient = prismaClient.PrismaClient;
const prisma = new PrismaClient();
const router = Router();

console.log('Created PrismaClient and router');

// Helper to send SSE messages
function sendSse(res, eventName, data) {
  if (res.writableEnded) {
    console.warn(`BACKEND Orchestrator: Attempted to send SSE event '${eventName}' after stream ended.`);
    return;
  }
  try {
    // Use standard SSE format with separate event and data lines
    // This matches what the frontend expects
    console.log(`Sending SSE event: ${eventName}`);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    console.error(`BACKEND Orchestrator: Error writing to SSE stream (event: ${eventName}):`, e.message);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

router.post('/run', async (req, res) => {
  console.log('\n========= BASIC ORCHESTRATOR REQUEST RECEIVED =========');
  const { message, conv_id: existing_conv_id } = req.body || {};
  let conversationId = existing_conv_id;

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  console.log('SSE headers set');

  try {
    if (typeof message !== 'string' || !message.trim()) {
      sendSse(res, 'error', { message: 'Request body must include a non-empty message string' });
      return res.end();
    }
    
    console.log('Request message:', message);

    const USER_ID = 1; // Assuming a fixed user ID for now
    let conversation;

    if (conversationId) {
      conversation = await prisma.conversations.findUnique({ where: { id: conversationId } });
      if (!conversation) {
        sendSse(res, 'error', { message: 'Conversation not found' });
        return res.end();
      }
      console.log('Found existing conversation:', conversationId);
    } else {
      conversation = await prisma.conversations.create({
        data: {
          user_id: USER_ID,
          title: `Conversation ${new Date().toISOString()}`,
          filename: `conversation-${Date.now()}.json`,
        },
      });
      conversationId = conversation.id;
      console.log('Created new conversation:', conversationId);
    }

    // Persist user message
    await prisma.messages.create({
      data: {
        conv_id: conversationId,
        role: 'user',
        content: message,
      },
    });
    console.log('Persisted user message');

    // Fetch conversation history
    const history = await prisma.messages.findMany({
      where: { conv_id: conversationId },
      orderBy: { id: 'asc' },
    });

    // Format conversation history
    const MAX_HISTORY_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || '10', 10);
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const historyText = recentHistory.map(m => `${m.role}: ${m.content}`).join('\n');
    
    console.log('Formatted conversation history with', recentHistory.length, 'messages');

    // Prepare agent input
    let agentInput = message;
    if (historyText) {
      agentInput = `Previous conversation:\n${historyText}\n\nUser: ${message}`;
    }
    
    console.log('Agent input prepared');
    
    // Notify client with conversation ID
    sendSse(res, 'conv_id', { conversationId });
    // Track whether planner completed events were emitted
    let planCompleted = false;

    // Run agent
    let assistantResponse = '';
    try {
      // Run the agent directly using the run() function - following the examples pattern
      console.log('Running basic agent...');
      console.log('Agent input (first 100 chars):', agentInput.substring(0, 100) + (agentInput.length > 100 ? '...' : ''));
      
      // Send planner status to indicate planning phase has started
      sendSse(res, 'planner_status', { state: 'planning', plan: null });
      
      // Use the run function directly from @openai/agents
      const result = await run(basicChatAgent, agentInput, {
        onEvent: async (event) => {
          // Handle different agent events for enhanced streaming
          console.log('=== AGENT EVENT ===');
          console.log(JSON.stringify(event));
          console.log('Event type:', event.type);
          console.log('Event data keys:', Object.keys(event.data || {}));
          if (event.data?.tool) {
            console.log('Tool name:', event.data.tool.name);
          }
          console.log('==================');
          
          if (event.data?.tool?.name === 'plan') {
            if (event.type === 'tool_use' || event.type === 'tool_start') {
              sendSse(res, 'planner_status', { state: 'executing', plan: null });
            }
            if (event.type === 'tool_result' || event.type === 'tool_end') {
              console.log('Planner completed - fetching tasks from todo MCP');
              try {
                const tasksResult = await todoMCPServer.callTool('list_tasks', { limit: 10, status: 'pending' });
                const tasksArray = Array.isArray(tasksResult.tasks)
                  ? tasksResult.tasks
                  : Array.isArray(tasksResult)
                  ? tasksResult
                  : [];
                const taskProgressItems = tasksArray.map(task => ({
                  id: task.id,
                  content: task.title || '',
                  status: task.status === 'completed' ? 'completed' : 'pending',
                  conversation_id: conversationId,
                  toolName: 'todo_task',
                  action: task.description,
                  args: task,
                }));
                sendSse(res, 'planner_status', { state: 'completed', plan: taskProgressItems });
                taskProgressItems.forEach(task =>
                  sendSse(res, 'task_progress', {
                    taskId: task.id,
                    status: task.status,
                    description: task.content,
                    toolName: task.toolName,
                    action: task.action,
                    args: task.args,
                  })
                );
                planCompleted = true;
              } catch (error) {
                console.error('Error fetching tasks from todo MCP:', error);
                sendSse(res, 'planner_status', { state: 'completed', plan: [] });
                planCompleted = true;
              }
            }
          }
          
          // Handle ALL tool calls and results with enhanced logging
          if (event.type === 'tool_use') {
            console.log('=== TOOL USE EVENT ===');
            console.log('Tool name:', event.data?.tool?.name);
            console.log('Tool parameters:', event.data?.tool?.parameters);
            console.log('Full event data:', JSON.stringify(event.data, null, 2));
            
            if (['create_task', 'update_task', 'complete_task', 'list_tasks'].includes(event.data?.tool?.name)) {
              console.log('✅ Todo MCP tool call detected:', event.data?.tool?.name);
            }
          }
          
          if (event.type === 'tool_result') {
            console.log('=== TOOL RESULT EVENT ===');
            console.log('Tool name:', event.data?.tool?.name);
            console.log('Tool result:', event.data.result);
            console.log('Full event data:', JSON.stringify(event.data, null, 2));
            
            if (['create_task', 'update_task', 'complete_task', 'list_tasks'].includes(event.data?.tool?.name)) {
              console.log('✅ Todo MCP tool result detected:', event.data?.tool?.name);
              
              try {
                let result;
                if (typeof event.data.result === 'string') {
                  result = JSON.parse(event.data.result);
                } else {
                  result = event.data.result;
                }
                
                console.log('Parsed result:', JSON.stringify(result, null, 2));
                
                // Convert todo MCP tasks to our task progress format
                if (event.data?.tool?.name === 'create_task') {
                  // Handle different possible result formats
                  let taskData = null;
                  
                  if (result.id) {
                    // Direct task object
                    taskData = result;
                  } else if (result.task) {
                    // Nested task object
                    taskData = result.task;
                  } else {
                    // Try to extract from text response
                    console.log('Attempting to extract task from text response');
                    const textMatch = result.text?.match(/{\s*"id":\s*(\d+).*?}/s);
                    if (textMatch) {
                      try {
                        taskData = JSON.parse(textMatch[0]);
                      } catch (e) {
                        console.warn('Failed to parse task from text:', e);
                      }
                    }
                  }
                  
                  if (taskData && taskData.id) {
                    console.log('Sending task progress for task:', taskData.id, taskData.title);
                    sendSse(res, 'task_progress', {
                      taskId: taskData.id,
                      status: taskData.status || 'pending',
                      description: taskData.title,
                      toolName: 'created_task',
                      action: taskData.description,
                      args: taskData
                    });
                  } else {
                    console.warn('Could not extract task data from result:', result);
                  }
                }
              } catch (e) {
                console.warn('Could not parse todo MCP result:', e);
              }
            }
          }
          
          // If this is a tool use event and it's the dispatcher tool
          if (event.type === 'tool_use' && event.data?.tool?.name === 'dispatch') {
            sendSse(res, 'task_progress', { status: 'executing_tasks' });
          }
          
          // If this is a tool result from the dispatcher
          if (event.type === 'tool_result' && event.data?.tool?.name === 'dispatch') {
            try {
              const dispatchResult = JSON.parse(event.data.result);
              const results = dispatchResult?.response || dispatchResult || [];
              
              // Update task progress
              results.forEach(taskResult => {
                sendSse(res, 'task_progress', { 
                  taskId: taskResult.taskId, 
                  status: taskResult.error ? 'failed' : 'completed',
                  result: taskResult.output || taskResult.error
                });
              });
              
              sendSse(res, 'dispatcher_done', { results });
            } catch (e) {
              console.warn('Could not parse dispatcher result for streaming:', e);
            }
          }
        }
      });
      
      console.log('Agent run completed');

      // Fallback: if planner completion events were not detected, emit completed plan now
      if (!planCompleted) {
        console.log('Planner completion not detected during events, using fallback to fetch tasks');
        try {
          const tasksResult = await todoMCPServer.callTool('list_tasks', { limit: 10, status: 'pending' });
          const tasksArray = Array.isArray(tasksResult.tasks)
            ? tasksResult.tasks
            : Array.isArray(tasksResult)
            ? tasksResult
            : [];
          const taskProgressItems = tasksArray.map(task => ({
            id: task.id,
            content: task.title || '',
            status: task.status === 'completed' ? 'completed' : 'pending',
            conversation_id: conversationId,
            toolName: 'todo_task',
            action: task.description,
            args: task,
          }));
          sendSse(res, 'planner_status', { state: 'completed', plan: taskProgressItems });
          taskProgressItems.forEach(task =>
            sendSse(res, 'task_progress', {
              taskId: task.id,
              status: task.status,
              description: task.content,
              toolName: task.toolName,
              action: task.action,
              args: task.args,
            })
          );
        } catch (error) {
          console.error('Error fetching tasks from todo MCP in fallback:', error);
          sendSse(res, 'planner_status', { state: 'completed', plan: [] });
        }
      }

      // Extract the final output from the result
      assistantResponse = result.finalOutput || '';
      console.log('Response received, length:', assistantResponse.length);

      // First, send the conversation ID (needed for UI to work properly)
      sendSse(res, 'conversation_id', { conv_id: conversationId });

      // Stream response to client as a single delta (could be chunked for real streaming)
      sendSse(res, 'assistant_delta', { delta: assistantResponse });

      // Send done event to mark completion
      sendSse(res, 'done', {});
      
    } catch (agentError) {
      console.error('Error running agent:', agentError);
      throw agentError;
    }
    
    // Persist assistant message
    if (assistantResponse.trim()) {
      await prisma.messages.create({
        data: {
          conv_id: conversationId,
          role: 'assistant',
          content: assistantResponse,
        },
      });
      console.log('Persisted assistant response');
    }

  } catch (error) {
    console.error('\n====== BASIC ORCHESTRATOR ERROR ======');
    console.error('Error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (!res.writableEnded) {
      sendSse(res, 'error', { 
        message: 'An error occurred', 
        details: error.message
      });
    }
    
    if (!res.writableEnded) {
      console.log("BACKEND Orchestrator: Ending stream due to error.");
      res.end();
    }
  } finally {
    if (!res.writableEnded) {
      sendSse(res, 'done', {});
      res.end();
      console.log('Stream ended with done event');
    }
    
    console.log('========= BASIC ORCHESTRATOR REQUEST COMPLETED =========');
  }
});

export default router;
