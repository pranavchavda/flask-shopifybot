import { Router } from 'express';
import * as prismaClient from '@prisma/client';
import { run } from '@openai/agents';
import { basicChatAgent, todoMCPServer } from './basic-agent.js';

const PrismaClient = prismaClient.PrismaClient;
const prisma = new PrismaClient();
const router = Router();

// Helper to send SSE messages
function sendSse(res, eventName, data) {
  if (res.writableEnded) {
    console.warn(`BACKEND Orchestrator: Attempted to send SSE event '${eventName}' after stream ended.`);
    return;
  }
  try {
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

async function fetchTodoTasks() {
  try {
    const tasksResult = await todoMCPServer.callTool('list_tasks', {
      limit: 20,
      order: 'created_at',
      direction: 'desc',
    });
    return tasksResult;
  } catch (error) {
    console.error('Error fetching tasks from todo MCP:', error);
    return null;
  }
}

router.post('/run', async (req, res) => {
  console.log('\n========= BASIC ORCHESTRATOR REQUEST RECEIVED asdasd =========');
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
    
    console.log('Agent input prepared');
    
    // Notify client with conversation ID
    sendSse(res, 'conv_id', { conversationId });
    
    // Send planner status to indicate planning phase has started
    sendSse(res, 'planner_status', { state: 'planning', plan: null });

    // Run agent
    console.log('Running basic agent...');
    let createdTasks = [];
    let dispatcherResults = [];
    
    const result = await run(basicChatAgent, agentInput, {
      onStepFinish: (step) => {
        console.log('Step finished:', step);
      }
    });
    console.log('Agent run completed');
    console.log('Agent result:', result);
    
    // After agent completes, fetch the created tasks
    try {
      const tasksResult = await todoMCPServer.callTool('list_tasks', {
        limit: 20,
        order: 'created_at',
        direction: 'desc',
      });
      
      console.log('Fetched tasks from todo MCP:', tasksResult);
      
      let tasksArray = [];
      if (Array.isArray(tasksResult)) {
        if (tasksResult.length === 1 && typeof tasksResult[0]?.text === 'string') {
          const text = tasksResult[0].text;
          const match = text.match(/(\[.*\])/s);
          if (match) {
            try {
              tasksArray = JSON.parse(match[1]);
            } catch (err) {
              console.error('Error parsing tasks JSON:', err);
            }
          }
        } else {
          tasksArray = tasksResult;
        }
      } else if (tasksResult?.tasks && Array.isArray(tasksResult.tasks)) {
        tasksArray = tasksResult.tasks;
      }
      
      // Filter to only show recently created tasks (within last few minutes)
      const recentCutoff = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago
      const recentTasks = tasksArray.filter(task => {
        const createdAt = new Date(task.created_at);
        return createdAt > recentCutoff;
      });
      
      if (recentTasks.length > 0) {
        const taskProgressItems = recentTasks.map((task, index) => ({
          id: `task-${task.id}`,
          content: task.title || task.description || '',
          status: task.status === 'completed' ? 'completed' : 'pending',
          conversation_id: conversationId,
          toolName: 'todo_task',
          action: task.description,
          args: task
        }));
        sendSse(res, 'planner_status', { state: 'completed', plan: taskProgressItems });
        
        // Send individual task progress events
        taskProgressItems.forEach(task => {
          sendSse(res, 'task_progress', {
            taskId: task.id,
            status: task.status,
            description: task.content,
            toolName: task.toolName,
            action: task.action
          });
        });
      } else {
        sendSse(res, 'planner_status', { state: 'completed', plan: [] });
      }
    } catch (err) {
      console.error('Error fetching tasks:', err);
      sendSse(res, 'planner_status', { state: 'completed', plan: [] });
    }
    
    // Extract the final output from the result
    const assistantResponse = result.finalOutput || '';
    console.log('Response received, length:', assistantResponse.length);
    
    // Send conversation ID and response
    sendSse(res, 'conversation_id', { conv_id: conversationId });
    sendSse(res, 'assistant_delta', { delta: assistantResponse });
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
    console.error('\n====== BASIC ORCHESTRATOR ERROR ======');
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
      console.log('Stream ended with done event');
    }
    
    console.log('========= BASIC ORCHESTRATOR REQUEST COMPLETED =========');
  }
});

export default router;