import { Router } from 'express';
import * as prismaClient from '@prisma/client';
import { run } from '@openai/agents';
import { unifiedAgent, todoMCPServer } from './basic-agent-unified.js';

const PrismaClient = prismaClient.PrismaClient;
const prisma = new PrismaClient();
const router = Router();

// Helper to send SSE messages
function sendSse(res, eventName, data) {
  if (res.writableEnded) {
    console.warn(`Attempted to send SSE event '${eventName}' after stream ended.`);
    return;
  }
  try {
    console.log(`Sending SSE event: ${eventName}`);
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    console.error(`Error writing to SSE stream (event: ${eventName}):`, e.message);
    if (!res.writableEnded) {
      res.end();
    }
  }
}

router.post('/run', async (req, res) => {
  console.log('\n========= UNIFIED ORCHESTRATOR REQUEST RECEIVED =========');
  const { message, conv_id: existing_conv_id } = req.body || {};
  let conversationId = existing_conv_id;

  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  console.log('SSE headers set');

  // Track created tasks for this session
  const sessionTaskIds = new Set();
  let isStreaming = false;

  try {
    if (typeof message !== 'string' || !message.trim()) {
      sendSse(res, 'error', { message: 'Request body must include a non-empty message string' });
      return res.end();
    }
    
    console.log('Request message:', message);

    const USER_ID = 1;
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

    const MAX_HISTORY_MESSAGES = parseInt(process.env.MAX_HISTORY_MESSAGES || '10', 10);
    const recentHistory = history.slice(-MAX_HISTORY_MESSAGES);
    const historyText = recentHistory.map(m => `${m.role}: ${m.content}`).join('\n');
    
    console.log('Formatted conversation history with', recentHistory.length, 'messages');

    let agentInput = message;
    if (historyText) {
      agentInput = `Previous conversation:\n${historyText}\n\nUser: ${message}`;
    }
    
    // Add conversation ID context for the agent
    agentInput += `\n\n[SYSTEM: Current conversation_id is ${conversationId}. MANDATORY: When calling create_task, you MUST include conversation_id=${conversationId} as a parameter to link tasks to this conversation. Example: create_task(title="My Task", description="Details", conversation_id=${conversationId})]`;
    
    console.log('Agent input prepared');
    
    // Notify client with conversation ID
    sendSse(res, 'conv_id', { conversationId });
    
    // Send initial status
    sendSse(res, 'agent_status', { status: 'analyzing' });

    // Run unified agent with event tracking
    console.log('Running unified agent...');
    
    // Start polling for tasks while agent runs
    let isAgentRunning = true;
    let lastTaskCount = 0;
    
    const pollTasks = async () => {
      if (!isAgentRunning) return;
      
      try {
        const { spawn } = await import('child_process');
        const mcpProcess = spawn('npx', ['-y', '@pranavchavda/todo-mcp-server'], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        const request = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "list_tasks",
            arguments: {
              conversation_id: conversationId.toString(),
              limit: 10
            }
          }
        });
        
        mcpProcess.stdin.write(request + '\n');
        mcpProcess.stdin.end();
        
        let responseData = '';
        mcpProcess.stdout.on('data', (data) => {
          responseData += data.toString();
        });
        
        mcpProcess.on('close', () => {
          try {
            const lines = responseData.split('\n').filter(line => line.trim());
            const jsonLine = lines.find(line => line.startsWith('{"result"'));
            
            if (jsonLine) {
              const parsed = JSON.parse(jsonLine);
              const text = parsed.result?.content?.[0]?.text;
              
              if (text) {
                const match = text.match(/(\[[\s\S]*\])/);
                if (match) {
                  const tasksArray = JSON.parse(match[1]);
                  
                  if (tasksArray.length > lastTaskCount) {
                    console.log(`POLLING: Found ${tasksArray.length} tasks (was ${lastTaskCount}) - sending update!`);
                    lastTaskCount = tasksArray.length;
                    
                    const taskProgressItems = tasksArray.map(task => ({
                      id: `task-${task.id}`,
                      content: task.title || task.description || '',
                      status: task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending',
                      conversation_id: conversationId,
                      toolName: 'todo_task',
                      action: task.description,
                      result: task.status === 'completed' ? 'Task completed' : undefined
                    }));
                    
                    sendSse(res, 'task_summary', { 
                      tasks: taskProgressItems,
                      total: tasksArray.length,
                      completed: tasksArray.filter(t => t.status === 'completed').length
                    });
                    
                    console.log('Sent REAL-TIME POLLING task_summary with', taskProgressItems.length, 'tasks');
                  }
                }
              }
            }
          } catch (err) {
            console.error('Error in task polling:', err);
          }
          
          // Continue polling every 500ms while agent runs
          if (isAgentRunning) {
            setTimeout(pollTasks, 500);
          }
        });
      } catch (err) {
        console.error('Error with task polling:', err);
        if (isAgentRunning) {
          setTimeout(pollTasks, 500);
        }
      }
    };
    
    // Start polling immediately
    setTimeout(pollTasks, 100);
    
    const result = await run(unifiedAgent, agentInput, {
      onStepStart: (step) => {
        console.log('*** onStepStart triggered ***');
        console.log('Step type:', step.type);
        console.log('Step:', JSON.stringify(step, null, 2).substring(0, 300));
        
        if (step.type === 'tool_call' && step.tool_name === 'create_task') {
          console.log('Task creation tool started!');
          sendSse(res, 'agent_status', { status: 'creating_task' });
        }
      },
      onStepFinish: (step) => {
        console.log('*** onStepFinish triggered ***');
        console.log('Step type:', step.type);
        console.log('Step result:', JSON.stringify(step, null, 2).substring(0, 500));
        
        if (step.type === 'tool_call' && step.tool_name === 'create_task' && step.result) {
          console.log('Task creation completed! Result:', step.result);
          
          // Immediately fetch tasks when create_task completes
          (async () => {
            try {
              const { spawn } = await import('child_process');
              const mcpProcess = spawn('npx', ['-y', '@pranavchavda/todo-mcp-server'], {
                stdio: ['pipe', 'pipe', 'pipe']
              });
              
              const request = JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "tools/call",
                params: {
                  name: "list_tasks",
                  arguments: {
                    conversation_id: conversationId.toString(),
                    limit: 10
                  }
                }
              });
              
              mcpProcess.stdin.write(request + '\n');
              mcpProcess.stdin.end();
              
              let responseData = '';
              mcpProcess.stdout.on('data', (data) => {
                responseData += data.toString();
              });
              
              mcpProcess.on('close', () => {
                try {
                  const lines = responseData.split('\n').filter(line => line.trim());
                  const jsonLine = lines.find(line => line.startsWith('{"result"'));
                  
                  if (jsonLine) {
                    const parsed = JSON.parse(jsonLine);
                    const text = parsed.result?.content?.[0]?.text;
                    
                    if (text) {
                      const match = text.match(/(\[[\s\S]*\])/);
                      if (match) {
                        const tasksArray = JSON.parse(match[1]);
                        console.log('Real-time task fetch via onStepFinish found', tasksArray.length, 'tasks');
                        
                        const taskProgressItems = tasksArray.map(task => ({
                          id: `task-${task.id}`,
                          content: task.title || task.description || '',
                          status: task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending',
                          conversation_id: conversationId,
                          toolName: 'todo_task',
                          action: task.description,
                          result: task.status === 'completed' ? 'Task completed' : undefined
                        }));
                        
                        sendSse(res, 'task_summary', { 
                          tasks: taskProgressItems,
                          total: tasksArray.length,
                          completed: tasksArray.filter(t => t.status === 'completed').length
                        });
                        
                        console.log('Sent REAL-TIME task_summary via onStepFinish with', taskProgressItems.length, 'tasks');
                      }
                    }
                  }
                } catch (err) {
                  console.error('Error in onStepFinish task fetch:', err);
                }
              });
            } catch (err) {
              console.error('Error with onStepFinish immediate task fetch:', err);
            }
          })();
        }
      },
      onMessage: (message) => {
        console.log('*** onMessage triggered ***');
        console.log('Agent message type:', typeof message);
        console.log('Agent message keys:', Object.keys(message || {}));
        console.log('Agent message:', JSON.stringify(message, null, 2).substring(0, 500));
        
        if (message.tool_calls) {
          for (const toolCall of message.tool_calls) {
            const toolName = toolCall.name;
            console.log('Tool call:', toolName, 'status:', toolCall.status);
            
            if (toolCall.status === 'running') {
              // Handle different tool types
              if (toolName === 'create_task') {
                sendSse(res, 'agent_status', { status: 'creating_task' });
              } else if (toolName === 'update_task' || toolName === 'complete_task') {
                sendSse(res, 'agent_status', { status: 'updating_task' });
              } else if (toolName.includes('search') || toolName.includes('get')) {
                sendSse(res, 'agent_status', { status: 'searching' });
              } else {
                sendSse(res, 'agent_status', { status: 'processing', tool: toolName });
              }
            }
            
            if (toolCall.status === 'complete' && toolCall.output) {
              // Track created tasks and fetch them immediately
              if (toolName === 'create_task') {
                try {
                  let taskData = toolCall.output;
                  console.log('Task created! Raw output:', taskData);
                  
                  // Extract task ID from response
                  let taskId = null;
                  if (typeof taskData === 'string') {
                    const idMatch = taskData.match(/task (\d+)/i) || taskData.match(/"id":\s*(\d+)/) || taskData.match(/ID (\d+)/i);
                    if (idMatch) {
                      taskId = parseInt(idMatch[1]);
                    }
                  }
                  
                  if (taskId) {
                    sessionTaskIds.add(taskId);
                    console.log('Created task ID:', taskId, '- fetching details immediately...');
                    
                    // Immediately fetch the created task details using direct MCP call
                    (async () => {
                      try {
                        const { spawn } = await import('child_process');
                        const mcpProcess = spawn('npx', ['-y', '@pranavchavda/todo-mcp-server'], {
                          stdio: ['pipe', 'pipe', 'pipe']
                        });
                        
                        const request = JSON.stringify({
                          jsonrpc: "2.0",
                          id: 1,
                          method: "tools/call",
                          params: {
                            name: "list_tasks",
                            arguments: {
                              conversation_id: conversationId.toString(),
                              limit: 10
                            }
                          }
                        });
                        
                        mcpProcess.stdin.write(request + '\n');
                        mcpProcess.stdin.end();
                        
                        let responseData = '';
                        mcpProcess.stdout.on('data', (data) => {
                          responseData += data.toString();
                        });
                        
                        mcpProcess.on('close', () => {
                          try {
                            const lines = responseData.split('\n').filter(line => line.trim());
                            const jsonLine = lines.find(line => line.startsWith('{"result"'));
                            
                            if (jsonLine) {
                              const parsed = JSON.parse(jsonLine);
                              const text = parsed.result?.content?.[0]?.text;
                              
                              if (text) {
                                const match = text.match(/(\[[\s\S]*\])/);
                                if (match) {
                                  const tasksArray = JSON.parse(match[1]);
                                  console.log('Real-time task fetch found', tasksArray.length, 'tasks');
                                  
                                  // Send updated task_summary with all current tasks
                                  const taskProgressItems = tasksArray.map(task => ({
                                    id: `task-${task.id}`,
                                    content: task.title || task.description || '',
                                    status: task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending',
                                    conversation_id: conversationId,
                                    toolName: 'todo_task',
                                    action: task.description,
                                    result: task.status === 'completed' ? 'Task completed' : undefined
                                  }));
                                  
                                  sendSse(res, 'task_summary', { 
                                    tasks: taskProgressItems,
                                    total: tasksArray.length,
                                    completed: tasksArray.filter(t => t.status === 'completed').length
                                  });
                                  
                                  console.log('Sent real-time task_summary with', taskProgressItems.length, 'tasks');
                                }
                              }
                            }
                          } catch (err) {
                            console.error('Error parsing immediate task fetch:', err);
                          }
                        });
                      } catch (err) {
                        console.error('Error with immediate task fetch:', err);
                      }
                    })();
                  }
                } catch (e) {
                  console.error('Error parsing create_task output:', e);
                }
              }
              
              // Track task updates
              else if ((toolName === 'update_task' || toolName === 'complete_task') && toolCall.input) {
                const taskId = toolCall.input.id || toolCall.input.task_id;
                if (taskId) {
                  const newStatus = toolName === 'complete_task' ? 'completed' : (toolCall.input.status || 'in_progress');
                  sendSse(res, 'task_updated', {
                    taskId: taskId,
                    status: newStatus,
                    conversation_id: conversationId
                  });
                }
              }
            }
          }
        }
        
        // Stream text content
        if (message.content && typeof message.content === 'string') {
          if (!isStreaming) {
            isStreaming = true;
            sendSse(res, 'agent_status', { status: 'responding' });
          }
          sendSse(res, 'assistant_delta', { delta: message.content });
        }
      }
    });
    
    // Stop polling when agent completes
    isAgentRunning = false;
    console.log('Agent run completed - stopped task polling');
    
    // After completion, fetch tasks directly using spawn instead of agent's MCP connection
    console.log('Starting direct task fetching...');
    try {
      console.log(`Fetching tasks directly for conversation_id=${conversationId}`);
      
      // Use spawn to call the MCP server directly
      const { spawn } = await import('child_process');
      const { promisify } = await import('util');
      
      const mcpProcess = spawn('npx', ['-y', '@pranavchavda/todo-mcp-server'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      const request = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "list_tasks",
          arguments: {
            conversation_id: conversationId.toString(),
            limit: 20,
            order: "created_at",
            direction: "desc"
          }
        }
      });
      
      mcpProcess.stdin.write(request + '\n');
      mcpProcess.stdin.end();
      
      let responseData = '';
      mcpProcess.stdout.on('data', (data) => {
        responseData += data.toString();
      });
      
      await new Promise((resolve, reject) => {
        mcpProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`MCP process exited with code ${code}`));
        });
        mcpProcess.on('error', reject);
      });
      
      console.log('Direct MCP response:', responseData.substring(0, 500));
      
      // Parse the response
      let tasksArray = [];
      try {
        console.log('Raw MCP response lines:', responseData.split('\n').map((line, i) => `${i}: ${line.substring(0, 100)}`));
        
        const lines = responseData.split('\n').filter(line => line.trim());
        const jsonLine = lines.find(line => line.startsWith('{"result"'));
        
        if (jsonLine) {
          const parsed = JSON.parse(jsonLine);
          const text = parsed.result?.content?.[0]?.text;
          console.log('Extracted text from MCP response:', text?.substring(0, 200));
          
          if (text) {
            const match = text.match(/(\[[\s\S]*\])/);
            if (match) {
              tasksArray = JSON.parse(match[1]);
              console.log('Successfully parsed tasks from direct MCP call:', tasksArray.length, 'tasks');
              console.log('First task details:', tasksArray[0]);
            } else {
              console.log('No JSON array found in text');
            }
          } else {
            console.log('No text content found in MCP response');
          }
        } else {
          console.log('No JSON result line found in MCP response');
        }
      } catch (err) {
        console.error('Error parsing direct MCP response:', err);
        console.error('Response data:', responseData);
      }
      
      // Create task progress items
      const taskProgressItems = tasksArray.map(task => ({
        id: `task-${task.id}`,
        content: task.title || task.description || '',
        status: task.status === 'completed' ? 'completed' : task.status === 'in_progress' ? 'in_progress' : 'pending',
        conversation_id: conversationId,
        toolName: 'todo_task',
        action: task.description,
        result: task.status === 'completed' ? 'Task completed' : undefined
      }));
      
      sendSse(res, 'task_summary', { 
        tasks: taskProgressItems,
        total: tasksArray.length,
        completed: tasksArray.filter(t => t.status === 'completed').length
      });
      
      console.log('Sent task_summary with', taskProgressItems.length, 'tasks via direct MCP fetch');
      
    } catch (err) {
      console.error('Error with direct task fetching:', err);
      // Send empty task summary as fallback
      sendSse(res, 'task_summary', { tasks: [], total: 0, completed: 0 });
    }
    
    // Extract the final output
    const assistantResponse = result.finalOutput || '';
    console.log('Final response length:', assistantResponse.length);
    
    // If no streaming happened, send the final response
    if (!isStreaming && assistantResponse) {
      sendSse(res, 'assistant_delta', { delta: assistantResponse });
    }
    
    // Send completion
    sendSse(res, 'conversation_id', { conv_id: conversationId });
    sendSse(res, 'done', {});
    
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
    console.error('\n====== UNIFIED ORCHESTRATOR ERROR ======');
    console.error('Error:', error);
    
    if (!res.writableEnded) {
      sendSse(res, 'error', { 
        message: 'An error occurred', 
        details: error.message
      });
    }
  } finally {
    if (!res.writableEnded) {
      sendSse(res, 'done', {});
      res.end();
      console.log('Stream ended');
    }
    
    console.log('========= UNIFIED ORCHESTRATOR REQUEST COMPLETED =========');
  }
});

export default router;