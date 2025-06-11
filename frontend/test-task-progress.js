// Using native fetch available in Node 18+

const API_BASE = 'http://localhost:5174/api';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logEvent(eventName, data) {
  console.log(`${colors.cyan}[EVENT: ${eventName}]${colors.reset} ${JSON.stringify(data, null, 2)}`);
}

async function testTaskProgressUpdates() {
  log('\n=== Testing Task Progress Updates ===\n', 'bright');
  
  // Test message that should trigger planning and task execution
  const testMessage = "Create a todo task for testing the UI updates, then list all my tasks";
  
  log(`Sending test message: "${testMessage}"`, 'yellow');
  
  const response = await fetch(`${API_BASE}/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: testMessage,
      conv_id: null // Start fresh conversation
    })
  });

  if (!response.ok) {
    log(`Failed to start agent: ${response.status} ${response.statusText}`, 'red');
    const errorText = await response.text();
    console.error('Error response:', errorText);
    return;
  }

  // Track events for validation
  const events = {
    planner_status: [],
    task_progress: [],
    dispatcher_event: [],
    dispatcher_done: [],
    assistant_delta: [],
    conv_id: null
  };

  log('\nListening for SSE events...', 'blue');
  
  // Process the SSE stream
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;

  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    
    buffer += decoder.decode(chunk.value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() || '';
    
    for (const eventBlock of events) {
      if (!eventBlock.trim()) continue;
      
      const lines = eventBlock.split('\n');
      let eventName = null;
      let eventData = null;
      
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventName = line.substring(7);
        } else if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          try {
            eventData = JSON.parse(dataStr);
          } catch (e) {
            console.error('Failed to parse data:', dataStr);
          }
        }
      }
      
      if (eventName && eventData) {
        try {
          
          logEvent(eventName, eventData);
          
          // Track events
          switch(eventName) {
            case 'conv_id':
              events.conv_id = eventData.conversationId;
              break;
            case 'planner_status':
              events.planner_status.push(eventData);
              break;
            case 'task_progress':
              events.task_progress.push(eventData);
              break;
            case 'dispatcher_event':
              events.dispatcher_event.push(eventData);
              break;
            case 'dispatcher_done':
              events.dispatcher_done.push(eventData);
              break;
            case 'assistant_delta':
              events.assistant_delta.push(eventData);
              break;
            case 'done':
              done = true;
              break;
            case 'error':
              log(`Error event: ${eventData.message}`, 'red');
              done = true;
              break;
          }
        } catch (e) {
          console.error('Failed to parse event data:', e);
        }
      }
    }
  }
  
  log('\n=== Test Results ===\n', 'bright');
  
  // Validate planner status
  const plannerEvents = events.planner_status;
  if (plannerEvents.length > 0) {
    log(`✓ Planner events received: ${plannerEvents.length}`, 'green');
    
    const planningEvent = plannerEvents.find(e => e.state === 'planning');
    const completedEvent = plannerEvents.find(e => e.state === 'completed');
    
    if (planningEvent) {
      log('  ✓ Planning phase started', 'green');
    } else {
      log('  ✗ No planning phase event', 'red');
    }
    
    if (completedEvent && completedEvent.plan) {
      log(`  ✓ Plan completed with ${completedEvent.plan.length} tasks`, 'green');
      console.log('  Plan tasks:', completedEvent.plan.map(t => ({
        id: t.id,
        content: t.content,
        toolName: t.toolName
      })));
    } else {
      log('  ✗ No completed plan with tasks', 'red');
    }
  } else {
    log('✗ No planner events received', 'red');
  }
  
  // Validate task progress updates
  if (events.task_progress.length > 0) {
    log(`\n✓ Task progress events received: ${events.task_progress.length}`, 'green');
    
    // Group by task ID
    const taskUpdates = {};
    events.task_progress.forEach(event => {
      if (!taskUpdates[event.taskId]) {
        taskUpdates[event.taskId] = [];
      }
      taskUpdates[event.taskId].push(event.status);
    });
    
    console.log('\nTask status progression:');
    Object.entries(taskUpdates).forEach(([taskId, statuses]) => {
      console.log(`  Task ${taskId}: ${statuses.join(' → ')}`);
    });
  } else {
    log('\n✗ No task progress events received', 'red');
  }
  
  // Validate dispatcher events
  if (events.dispatcher_event.length > 0) {
    log(`\n✓ Dispatcher events received: ${events.dispatcher_event.length}`, 'green');
  } else {
    log('\n✗ No dispatcher events received', 'red');
  }
  
  // Validate final response
  if (events.assistant_delta.length > 0) {
    log(`\n✓ Assistant response received (${events.assistant_delta.length} chunks)`, 'green');
    const fullResponse = events.assistant_delta.map(e => e.delta).join('');
    console.log('Response preview:', fullResponse.substring(0, 100) + '...');
  } else {
    log('\n✗ No assistant response received', 'red');
  }
  
  // Summary
  log('\n=== Summary ===', 'bright');
  const hasValidFlow = 
    plannerEvents.some(e => e.state === 'planning') &&
    plannerEvents.some(e => e.state === 'completed' && e.plan) &&
    events.task_progress.length > 0 &&
    events.assistant_delta.length > 0;
  
  if (hasValidFlow) {
    log('✓ Task progress UI flow is working correctly!', 'green');
  } else {
    log('✗ Task progress UI flow has issues', 'red');
  }
  
  if (events.conv_id) {
    log(`\nConversation ID: ${events.conv_id}`, 'blue');
  }
}

// Run the test
testTaskProgressUpdates().catch(console.error);