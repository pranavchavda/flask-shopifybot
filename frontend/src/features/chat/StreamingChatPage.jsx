import React, { useEffect, useRef, useState } from "react";
import { Textarea } from "@common/textarea";
import { Button } from "@common/button";
import { format } from "date-fns";
import { Loader2, Send, ImageIcon, X } from "lucide-react";
import { MarkdownRenderer } from "@components/chat/MarkdownRenderer";
import { TaskProgress } from "@components/chat/TaskProgress";
import { Text, TextLink } from "@common/text";
import { Avatar } from "@common/avatar";
import logo from "../../../static/EspressoBotLogo.png";
import { Label } from '@common/fieldset'
import { Switch, SwitchField } from '@common/switch'


function StreamingChatPage({ convId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [activeConv, setActiveConv] = useState(convId);
  const [suggestions, setSuggestions] = useState([]);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [toolCallStatus, setToolCallStatus] = useState(""); // Can be repurposed or used for general status
  const [currentTasks, setCurrentTasks] = useState([]);
  const [imageAttachment, setImageAttachment] = useState(null);
  const [plannerStatus, setPlannerStatus] = useState("");
  const [dispatcherStatus, setDispatcherStatus] = useState("");
  const [synthesizerStatus, setSynthesizerStatus] = useState("");
  const [currentPlan, setCurrentPlan] = useState(null);
  const [imageUrl, setImageUrl] = useState("");
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const [useBasicAgent, setUseBasicAgent] = useState(true);
  const [useNonAgentic, setUseNonAgentic] = useState(false);
  const messagesEndRef = useRef(null);
  const eventSourceRef = useRef(null);
  const readerRef = useRef(null);
  const inputRef = useRef(null);
  const imageInputRef = useRef(null);

  // Fetch messages for selected conversation
  useEffect(() => {
    if (!convId) {
      setMessages([]);
      setSuggestions([]);
      console.warn('FRONTEND: convId is null in useEffect[convId]. Clearing messages/suggestions. convId:', convId);
      setMessages([]);
      setSuggestions([]);
      setActiveConv(null);
      return;
    }
    setLoading(true);
    fetch(`/api/conversations/${convId}`)
      .then((res) => res.json())
      .then(({ messages: fetchedMessages, tasks: persistedTasks }) => {
        setMessages(fetchedMessages);
        setCurrentTasks(persistedTasks);
        setActiveConv(convId);
        const lastMessage = fetchedMessages[fetchedMessages.length - 1];
        if (
          lastMessage &&
          lastMessage.role === "assistant" &&
          lastMessage.suggestions
        ) {
          setSuggestions(lastMessage.suggestions);
        } else {
          setSuggestions([]);
        }
      })
      .catch(() => {
        setMessages([]);
        setSuggestions([]);
        console.error('FRONTEND: Error fetching conversation in useEffect[convId]. Clearing messages/suggestions. convId:', convId);
      })
      .finally(() => setLoading(false));
  }, [convId]);

  //console.log("FRONTEND RENDER: useAgent:", useAgent, "currentPlan:", currentPlan, "currentTasks:", currentTasks, "streamingMessage:", streamingMessage); // DEBUG

    console.log("FRONTEND RENDER: useBasicAgent:", useBasicAgent, "currentPlan:", currentPlan, "currentTasks:", currentTasks,
    "streamingMessage:", streamingMessage); // DEBUG
    
          // Fallback: if the LLM spits back a pure plan JSON instead of using tool events,
          // detect it on stream completion and seed currentPlan.
          useEffect(() => {
            if (useBasicAgent && streamingMessage?.isComplete && !currentPlan && streamingMessage.content) {
              try {
                const pkg = JSON.parse(streamingMessage.content);
                if (pkg.response && Array.isArray(pkg.response.tasks)) {
                  console.log("FRONTEND: parsed direct plan JSON, setting currentPlan:", pkg.response.tasks);
                  setCurrentPlan(pkg.response.tasks);
                }
              } catch (_e) {
                // not JSON or not a plan, ignore
              }
            }
          }, [useBasicAgent, streamingMessage, currentPlan]);


  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage]);

  // Format timestamp to readable format
  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "";
    try {
      return format(new Date(timestamp), "h:mm a");
    } catch (e) {
      return "";
    }
  };

  // Interrupt function to stop ongoing agent tasks
  const handleInterrupt = async () => {
    if (readerRef.current) {
      try {
        await readerRef.current.cancel();
        readerRef.current = null;
      } catch (error) {
        console.log("Reader already closed");
      }
    }
    
    setIsSending(false);
    setStreamingMessage(null);
    console.error('FRONTEND: Clearing tasks inside handleInterrupt. Conversation ID:', activeConv);
    setCurrentTasks([]);
    setToolCallStatus("");
    
    // Optionally send an interrupt signal to the backend
    try {
      await fetch('/api/interrupt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conv_id: activeConv })
      });
    } catch (error) {
      console.log("Failed to send interrupt signal:", error);
    }
  };

  // Clean up event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
      if (readerRef.current) {
        readerRef.current.cancel();
      }
    };
  }, []);

  // When a streaming agent message completes, append it to messages and clear the stream buffer
  useEffect(() => {
    if (streamingMessage?.isComplete) {
      const { content, timestamp } = streamingMessage;
      if (content) {
        setMessages(prev => [
          ...prev,
          { id: `msg-${Date.now()}`, role: "assistant", content, timestamp }
        ]);
      }
      setStreamingMessage(null);
    }
  }, [streamingMessage?.isComplete]);

  // Handle image paste from clipboard
  useEffect(() => {
    const handlePaste = (e) => {
      if (e.clipboardData && e.clipboardData.items) {
        const items = e.clipboardData.items;
        
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            const blob = items[i].getAsFile();
            handleImageAttachment(blob);
            e.preventDefault();
            break;
          }
        }
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, []);

  // Function to handle image attachments
  const handleImageAttachment = (file) => {
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setImageAttachment({
          dataUrl: e.target.result,
          file: file
        });
        setShowImageUrlInput(false);
        setImageUrl("");
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle image upload button click
  const handleImageUploadClick = () => {
    imageInputRef.current?.click();
  };

  // Remove image attachment
  const removeImageAttachment = () => {
    setImageAttachment(null);
  };

  // Toggle URL input visibility
  const toggleImageUrlInput = () => {
    setShowImageUrlInput(!showImageUrlInput);
    if (imageAttachment) {
      setImageAttachment(null);
    }
  };

  // Handle URL input change
  const handleImageUrlChange = (e) => {
    setImageUrl(e.target.value);
  };

  // Add URL as attachment
  const addImageUrl = () => {
    if (imageUrl.trim()) {
      setImageAttachment({
        url: imageUrl.trim()
      });
      setShowImageUrlInput(false);
    }
  };

  // const fetchSuggestions = async (currentInput) => {
  //   if (!currentInput.trim()) {
  //     setSuggestions([]);
  //     return;
  //   }

  //   const lastAgentMessageContent = messages
  //     .filter(msg => msg.role === 'assistant' && msg.content)
  //     .pop()?.content || "";

  //   // setSuggestionsLoading(true);
  //   try {
  //     const response = await fetch('/api/typeahead_suggestions', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //       },
  //       body: JSON.stringify({
  //         agent_previous_message: lastAgentMessageContent,
  //         user_current_input: currentInput,
  //       }),
  //     });
  //     if (!response.ok) {
  //       throw new Error(`HTTP error! status: ${response.status}`);
  //     }
  //     const data = await response.json();
  //     setSuggestions(data.suggestions || []);
  //   } catch (error) {
  //     console.error("Failed to fetch typeahead suggestions:", error);
  //     setSuggestions([]);
  //   } finally {
  //     // setSuggestionsLoading(false);
  //   }
  // };

  // const debouncedInput = useDebounce(input, 400);

  // useEffect(() => {
  //   if (debouncedInput.trim()) {
  //     fetchSuggestions(debouncedInput);
  //   } else {
  //     setSuggestions([]);
  //   }
  // }, [debouncedInput]);


  // Handle sending a message with streaming response
  const handleSend = async (messageContent = input) => {
    const textToSend =
      typeof messageContent === "string" ? messageContent.trim() : input.trim();

    if ((!textToSend && !imageAttachment) || isSending) return;

    if (streamingMessage?.isComplete) {
      setMessages(prev => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: streamingMessage.content,
          timestamp: streamingMessage.timestamp,
        }
      ]);
    }

    const userMessage = {
      role: "user",
      content: textToSend,
      timestamp: new Date().toISOString(),
      imageAttachment: imageAttachment,
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsSending(true);
    setInput('');
    setSuggestions([]);
    setCurrentTasks([]);
    setImageAttachment(null); // Clear attachment after sending
    setImageUrl("");
    setShowImageUrlInput(false);

    setStreamingMessage({
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
      isStreaming: true,
      isComplete: false,
    });

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      // Determine which endpoint to use based on agent mode
      let fetchUrl = "/api/agent/basic/run"; // Default to basic agent
      if (useNonAgentic) {
        fetchUrl = "/stream_chat"; // Use non-agentic mode
        console.log("Using non-agentic endpoint");
      } else {
        console.log("Using unified basic agent endpoint with agentic architecture");
      }

      if (useBasicAgent) {
        setPlannerStatus("Initializing...");
        setDispatcherStatus("");
        setSynthesizerStatus("Initializing...");
        setCurrentPlan(null);
        setCurrentTasks([]); // Reset tasks for new agent run
        setToolCallStatus("");
      }

      const requestData = {
        conv_id: activeConv || undefined,
        message: textToSend,
      };

      if (imageAttachment) {
        if (imageAttachment.dataUrl) {
          requestData.image = {
            type: "data_url",
            data: imageAttachment.dataUrl
          };
        } else if (imageAttachment.url) {
          requestData.image = {
            type: "url",
            url: imageAttachment.url
          };
        }
      }

      const response = await fetch(fetchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
      }

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let eventDataBuffer = "";
      let shouldStop = false;

      while (!shouldStop) {
        try {
          const { done, value } = await reader.read();
          
          // Breaking condition - either explicit shouldStop flag or reader signals done
          if (done || shouldStop) {
            console.log("FRONTEND: Stream reader loop breaking, done=", done, "shouldStop=", shouldStop);
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          eventDataBuffer += chunk;

          const eventMessages = eventDataBuffer.split(/\n\n/);
          eventDataBuffer = eventMessages.pop() || ""; 
          
          // Process all complete event messages in this chunk
          for (const singleEventString of eventMessages) {
            if (!singleEventString.trim()) continue;

            let eventName = null;
            let rawJsonDataString = "";
            const sseLines = singleEventString.split('\n');

            for (const line of sseLines) {
              // Prioritize explicit event: line if present
              if (line.startsWith('event:')) {
                eventName = line.substring(6).trim();
              } 
              // Always accumulate data: lines
              if (line.startsWith('data:')) { 
                rawJsonDataString += line.substring(5).trim();
              }
            }

            try {
              let parsedData = rawJsonDataString ? JSON.parse(rawJsonDataString) : {};
              let actualEventPayload = parsedData;

              // If eventName wasn't set by an 'event:' line, 
              // and we are using the agent, try to get it from the parsed data structure.
              if (!eventName && useBasicAgent && parsedData.type) {
                eventName = parsedData.type;
                actualEventPayload = parsedData.data !== undefined ? parsedData.data : {}; // Use .data if it exists, otherwise empty obj
              } else if (!eventName && useNonAgentic && singleEventString.startsWith('data:')) {
                // Legacy /stream_chat handling (eventName remains null, payload is parsedData)
                actualEventPayload = parsedData;
              }
              
              console.log("Processed SSE Event -- Name:", eventName, "Payload:", actualEventPayload);

              // Handle 'done' event regardless of agent mode
              if (eventName === 'done') {
                console.log("FRONTEND: Received explicit 'done' event");
                setStreamingMessage(prev => ({ ...prev, isStreaming: false, isComplete: true, timestamp: new Date().toISOString() }));
                setIsSending(false);
                shouldStop = true;
                
                // If there's an active reader, attempt to release/cancel it
                if (readerRef.current) {
                  try {
                    console.log("FRONTEND: Attempting to cancel reader");
                    readerRef.current.cancel("Stream completed");
                  } catch (e) {
                    console.error("Error cancelling reader:", e);
                  }
                }
                break;
              }
            
              if (useBasicAgent) {
                switch (eventName) {
                case 'conversation_id':
                  if (actualEventPayload.conv_id && (!activeConv || activeConv !== actualEventPayload.conv_id)) {
                    console.log("FRONTEND: Received 'conversation_id' event. Updating activeConv from", activeConv, "to", actualEventPayload.conv_id); // DEBUG
                    setActiveConv(actualEventPayload.conv_id);
                    // TODO: If the URL needs to be updated to reflect the new conv_id (e.g., for bookmarking or sharing),
                    // a callback prop from the parent component (e.g., App.js or the router component)
                    // that can trigger a URL change should be invoked here.
                  }
                  break;
                case 'planner_status':
                  console.log("FRONTEND: Received planner_status event:", JSON.stringify(actualEventPayload, null, 2));
                  setPlannerStatus(actualEventPayload.state === 'completed' ? `Plan: ${actualEventPayload.state}` : `Planner: ${actualEventPayload.state}`);
                  if (actualEventPayload.state === 'completed' && actualEventPayload.plan) {
                    console.log("FRONTEND: Plan completed with plan:", actualEventPayload.plan);
                    if (Array.isArray(actualEventPayload.plan)) {
                      console.log("FRONTEND: Setting currentPlan from planner_status:", actualEventPayload.plan); // DEBUG
                      setCurrentPlan(actualEventPayload.plan);
                      
                      // Convert plan tasks to task progress items
                      const taskProgressItems = actualEventPayload.plan.map(task => ({
                        id: task.id,
                        content: task.description,
                        status: 'pending',
                        conversation_id: activeConv || convId,
                        toolName: task.agent_tool_name,
                        action: task.args?.action,
                        args: task.args?.args || task.args
                      }));
                      
                      console.log("FRONTEND: Creating task progress items:", taskProgressItems);
                      setCurrentTasks(taskProgressItems);
                    } else {
                      console.warn("FRONTEND: Received plan is not an array:", actualEventPayload.plan);
                      setCurrentPlan([]); // Set to empty array to avoid errors
                    }
                  } else {
                    console.log("FRONTEND: Plan not completed or no plan in payload");
                  }
                  break;
                case 'task_progress':
                  if (actualEventPayload.taskId && actualEventPayload.status) {
                    setCurrentTasks(prevTasks => {
                      const existingTaskIndex = prevTasks.findIndex(t => t.id === actualEventPayload.taskId);
                      
                      if (existingTaskIndex !== -1) {
                        // Update existing task
                        const updatedTasks = [...prevTasks];
                        updatedTasks[existingTaskIndex] = {
                          ...prevTasks[existingTaskIndex],
                          status: actualEventPayload.status,
                          content: actualEventPayload.description || updatedTasks[existingTaskIndex].content,
                          result: actualEventPayload.result,
                          conversation_id: activeConv || convId
                        };
                        return updatedTasks;
                      } else if (actualEventPayload.status === 'pending') {
                        // Add new pending task
                        const newTask = {
                          id: actualEventPayload.taskId,
                          status: actualEventPayload.status,
                          content: actualEventPayload.description || `Task ${actualEventPayload.taskId}`,
                          conversation_id: activeConv || convId
                        };
                        return [...prevTasks, newTask];
                      }
                      return prevTasks;
                    });
                  } else if (actualEventPayload.status === 'executing_tasks') {
                    setDispatcherStatus("Dispatcher: executing tasks...");
                  }
                  break;
                case 'dispatcher_done':
                  if (actualEventPayload.results && Array.isArray(actualEventPayload.results)) {
                    // Update tasks with final results
                    setCurrentTasks(prevTasks => {
                      const updatedTasks = [...prevTasks];
                      actualEventPayload.results.forEach(result => {
                        const taskIndex = updatedTasks.findIndex(t => t.id === result.taskId);
                        if (taskIndex !== -1) {
                          updatedTasks[taskIndex] = {
                            ...updatedTasks[taskIndex],
                            status: result.error ? 'error' : 'completed',
                            result: result.output || result.error,
                            error: result.error
                          };
                        }
                      });
                      return updatedTasks;
                    });
                  }
                  setDispatcherStatus("Dispatcher: completed");
                  break;
                case 'dispatcher_event':
                  setDispatcherStatus("Dispatcher: running task...");
                  console.log("FRONTEND: Received dispatcher_event, payload:", actualEventPayload); // DEBUG
                  setCurrentTasks(prevTasks => {
                    console.log("FRONTEND: setCurrentTasks - START - prevTasks:", JSON.parse(JSON.stringify(prevTasks)), "Incoming event payload:", actualEventPayload); // Deep copy for logging
                    
                    // Defensive check
                    if (!actualEventPayload || typeof actualEventPayload.status === 'undefined') {
                      console.error('FRONTEND: setCurrentTasks updater. Critical: actualEventPayload or its status is undefined for dispatcher_event. Payload:', JSON.stringify(actualEventPayload), '. Returning prevTasks.');
                      return prevTasks;
                    }

                    const existingTaskIndex = prevTasks.findIndex(t => t.id === actualEventPayload.tool_call_id);
                    
                    if (actualEventPayload.status === 'started') {
                      const newTask = { 
                        id: actualEventPayload.tool_call_id || `${actualEventPayload.tool_name}-${Date.now()}`, 
                        name: actualEventPayload.tool_name, 
                        content: actualEventPayload.tool_name, // For TaskProgress display
                        input: typeof actualEventPayload.tool_input === 'string' ? actualEventPayload.tool_input : JSON.stringify(actualEventPayload.tool_input, null, 2),
                        status: 'in_progress', // Mapped 'started' to 'in_progress' for TaskProgress component 
                        conversation_id: activeConv || convId // For TaskProgress filtering
                      };
                      if (existingTaskIndex !== -1) {
                         const newTasks = [...prevTasks];
                         newTasks[existingTaskIndex] = newTask;
                         console.log("FRONTEND: setCurrentTasks - returning updated newTasks (existing task modified)", JSON.parse(JSON.stringify(newTasks)));
                         return newTasks;
                      } else {
                         const updatedList = [...prevTasks, newTask];
                         console.log("FRONTEND: setCurrentTasks - returning new task added to list", JSON.parse(JSON.stringify(updatedList)));
                         return updatedList;
                      }
                    } else if (actualEventPayload.status === 'completed' || actualEventPayload.status === 'error') {
                      if (existingTaskIndex !== -1) {
                        const updatedTasks = [...prevTasks];
                        updatedTasks[existingTaskIndex] = {
                          ...prevTasks[existingTaskIndex],
                          status: actualEventPayload.status,
                          output: typeof actualEventPayload.output === 'string' ? actualEventPayload.output : JSON.stringify(actualEventPayload.output, null, 2),
                          error: actualEventPayload.error ? (typeof actualEventPayload.error === 'string' ? actualEventPayload.error : JSON.stringify(actualEventPayload.error, null, 2)) : undefined,
                          // Ensure conversation_id is preserved if it was set
                          conversation_id: prevTasks[existingTaskIndex].conversation_id || activeConv || convId 
                        };
                        console.log("FRONTEND: setCurrentTasks - returning updatedTasks (task status change)", JSON.parse(JSON.stringify(updatedTasks)));
                        return updatedTasks;
                      }
                    }
                    console.log("FRONTEND: setCurrentTasks - returning prevTasks (no change or unmatched condition)", JSON.parse(JSON.stringify(prevTasks)));
                    return prevTasks;
                  });
                  break;
                case 'synthesizer_status':
                  console.log("FRONTEND: Received 'synthesizer_status' event", JSON.stringify(actualEventPayload)); // DEBUG
                  setSynthesizerStatus(`Synthesizer: ${actualEventPayload.status}`);
                  if(actualEventPayload.status === 'started') setDispatcherStatus("Dispatcher: completed, awaiting synthesis.");
                  break;
                case 'assistant_delta':
                  if (plannerStatus) setPlannerStatus(""); 
                  if (dispatcherStatus) setDispatcherStatus("");
                  setSynthesizerStatus("Synthesizer: streaming...");
                  setToolCallStatus("");
                  setCurrentTasks(prev => prev.map(t => (t.status === 'running' ? {...t, status:'completed_implicit'} : t) ));
                  console.log("FRONTEND: Received 'assistant_delta' event payload:", JSON.stringify(actualEventPayload)); // DEBUG
                  setStreamingMessage(prev => ({ ...prev, content: (prev?.content || "") + actualEventPayload.delta, isStreaming: true, isComplete: false }));
                  break;
                case 'error':
                  setToolCallStatus(`Error: ${actualEventPayload.message}`);
                  console.error("SSE Orchestrator Error:", actualEventPayload);
                  setStreamingMessage(prev => ({ ...prev, content: (prev?.content || "") + `\n\n**Error:** ${actualEventPayload.message}`, isStreaming: false, isComplete: true }));
                  setIsSending(false); shouldStop = true; break;
                case 'done':
                  console.log("FRONTEND: Received 'done' event", JSON.stringify(actualEventPayload)); // DEBUG
                  
                  // Force immediate state updates for UI
                  setStreamingMessage(prev => {
                    console.log("Setting message to complete, prev state:", prev);
                    return { ...prev, isStreaming: false, isComplete: true, timestamp: new Date().toISOString() };
                  });
                  
                  setIsSending(false);
                  
                  // CRITICAL: Force shouldStop to true to end the reader loop
                  shouldStop = true;
                  console.log("FRONTEND: Force setting shouldStop=true to terminate stream reader loop");
                  
                  // If there's an active reader, attempt to release/cancel it
                  if (readerRef.current) {
                    try {
                      console.log("FRONTEND: Attempting to cancel reader");
                      readerRef.current.cancel("Stream completed");
                    } catch (e) {
                      console.error("Error cancelling reader:", e);
                    }
                  }
                  
                  setSynthesizerStatus("Synthesizer: completed.");
                  console.log("FRONTEND: 'done' event fully processed");
                  break;
                default:
                  console.log("Unknown agent SSE event type:", eventName, "Payload:", actualEventPayload);
              }
            } else { // Legacy /stream_chat handling
              const data = actualEventPayload; // Use actualEventPayload for legacy too
              if (data.tool_call) {
                const { name, status } = data.tool_call;
                let statusMessage = `Tool ${name}: ${status}`;
                if (status === "started") statusMessage = `Running tool: ${name}...`;
                else if (status === "finished" || status === "ended") statusMessage = `Tool ${name} finished.`;
                else if (status === "error") statusMessage = `Error with tool: ${name}.`;
                setToolCallStatus(statusMessage);
              } else if (data.content || data.delta) {
                setToolCallStatus("");
              }
              if (data.delta) {
                setStreamingMessage(prev => ({ ...prev, content: (prev?.content || "") + data.delta, isStreaming: true, isComplete: false }));
              } else if (data.content) {
                setStreamingMessage(prev => ({ ...prev, content: (prev?.content || "") + data.content, isStreaming: true, isComplete: false }));
              }
              if (data.suggestions) setSuggestions(data.suggestions);
              if (data.tasks) {
                setCurrentTasks(prevTasks => {
                  const newTasks = data.tasks.filter(task => !prevTasks.some(pt => pt.id === task.id || pt.name === task.name));
                  const updatedTasks = prevTasks.map(pt => {
                    const updatedTask = data.tasks.find(t => t.id === pt.id || t.name === pt.name);
                    return updatedTask ? { ...pt, ...updatedTask } : pt;
                  });
                  return [...updatedTasks, ...newTasks];
                });
              }
              // Also check for data.done = true pattern (older style)
              if (data.done === true) {
                console.log("FRONTEND: Received data.done=true");
                setStreamingMessage(prev => ({ ...prev, isStreaming: false, isComplete: true, timestamp: new Date().toISOString() }));
                setIsSending(false); 
                shouldStop = true;
                break;
              }
            }
            } catch (e) {
              console.error("Failed to parse SSE JSON or handle event:", e, "Event Name:", eventName, "JSON String:", rawJsonDataString);
            }
          }
        } catch (e) {
          console.error("Failed to read stream chunk:", e);
          shouldStop = true;
        }
      }
    } catch (e) {
      console.error("Failed to send message or process stream:", e);
      setStreamingMessage(prev => 
        prev ? { ...prev, content: (prev?.content || "") + `\n\n**Error:** ${e.message}`, isError: true, isStreaming: false, isComplete: true } : null
      );
    } finally {
      setIsSending(false);
      // setToolCallStatus(""); // Keep agent specific statuses for review
      readerRef.current = null;
    }
  }
  const handleSuggestionClick = (suggestionText) => {
    handleSend(suggestionText);
  };

  return (
    <div className="flex flex-col h-[90vh] w-full max-w-full overflow-x-hidden bg-zinc-50 dark:bg-zinc-900">

      {/* Chat messages area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-4 sm:px-6 py-4 max-w-3xl w-full mx-auto">
        <div className="flex flex-col gap-3">
          {loading ? (
            <div className="flex justify-center items-center h-32">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-zinc-500"></div>
            </div>
          ) : messages.length === 0 && !streamingMessage ? (
            <div className="flex flex-col items-center justify-center text-center text-zinc-500 mt-12">
              <img
                src={logo}
                alt="Espresso Bot Logo"
                className="mx-auto mt-6 mb-2 h-96 w-96 object-contain drop-shadow-lg"
                draggable="false"
              />
              <Text>Start a new conversation by sending a message.
                 Visit the <TextLink href="/about">About</TextLink> page for more information and to learn how to use the bot.
              </Text>
            </div>
          ) : (
            <>
              {/* Render all messages */}
              {messages.map((msg, i) => {
                return (
                  <React.Fragment key={msg.id || i}>
                    <div
                      className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}
                    >
                      <div className="flex-shrink-0">
                        {msg.role === "user" ? (
                          <Avatar
                            className="size-8 bg-gray-100 dark:bg-zinc-700"
                            initials="Me"
                            alt="User"
                          />
                        ) : (
                          <Avatar
                            className="size-8 bg-blue-100 dark:bg-blue-900/30"
                            alt="ShopifyBot"
                            initials="🤖"
                          />
                        )}
                      </div>

                      <div
                        className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm ${
                          msg.role === "user"
                            ? "bg-gray-200 text-black dark:bg-gray-700 dark:text-white rounded-tr-none"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-tl-none"
                        }`}
                      >
                        <div className="w-full break-words prose dark:prose-invert prose-sm max-w-none">
                          {msg.imageAttachment && (
                            <div className="mb-3">
                              {msg.imageAttachment.dataUrl && (
                                <img
                                  src={msg.imageAttachment.dataUrl}
                                  alt="User uploaded"
                                  className="max-h-64 rounded-lg object-contain"
                                />
                              )}
                              {msg.imageAttachment.url && (
                                <img
                                  src={msg.imageAttachment.url}
                                  alt="From URL"
                                  className="max-h-64 rounded-lg object-contain"
                                  onError={(e) => {
                                    e.target.onerror = null;
                                    e.target.src =
                                      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjEwMCIgdmlld0JveD0iMCAwIDEwMCAxMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjEwMCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNFRUVFRUUiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9InNhbnMtc2VyaWYiIGZvbnQtc2l6ZT0iMTYiIGZpbGw9IiM5OTk5OTkiPkltYWdlIGVycm9yPC90ZXh0Pjwvc3ZnPg==';
                                  }}
                                />
                              )}
                            </div>
                          )}
                          <MarkdownRenderer isAgent={msg.role === "assistant"}>
                            {String(msg.content || "")}
                          </MarkdownRenderer>
                        </div>
                        <div
                          className={`text-xs mt-2 flex items-center justify-end gap-2 ${
                            msg.role === "user"
                              ? "text-gray-400 dark:text-gray-500"
                              : "text-zinc-500 dark:text-zinc-400"
                          }`}
                        >
                          {msg.status === "sending" && (
                            <span className="flex items-center">
                              <Loader2 className="h-3 w-3 animate-spin mr-1" />
                              Processing
                            </span>
                          )}
                          {msg.timestamp && !msg.status && (
                            <span className="whitespace-nowrap">
                              {formatTimestamp(msg.timestamp)}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}


              {/* Render streaming message if present */}
              {streamingMessage && (
                <div className="flex items-start gap-2">
                  <div className="flex-shrink-0">
                    <Avatar
                      className="size-8 bg-blue-100 dark:bg-blue-900/30"
                      alt="ShopifyBot"
                      initials="🤖"
                    />
                  </div>

                  <div 
                    className="max-w-[85%] sm:max-w-[75%] rounded-2xl px-4 py-3 shadow-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-tl-none"
                    data-state={streamingMessage.isComplete ? "complete" : "streaming"}
                  >
                    <div className="w-full break-words prose dark:prose-invert prose-sm max-w-none">
                    {/* Display Plan Steps if in Agent Mode and plan exists */}
                    {useBasicAgent && currentPlan && currentPlan.length > 0 && (
                      <div className="mb-2 p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
                        <h4 className="font-semibold text-xs mb-1 text-blue-700 dark:text-blue-300">Execution Plan:</h4>
                        <ol className="list-decimal list-inside text-xs text-blue-600 dark:text-blue-400 space-y-0.5">
                          {currentPlan.map((step, index) => {
                          // Determine if this step is completed, errored, or in progress
                          const isCompleted = currentTasks.some(
                            task => task.name === step.tool_name && task.status === 'completed'
                          );
                          const isErrored = currentTasks.some(
                            task => task.name === step.tool_name && task.status === 'error'
                          );
                          const isInProgress = currentTasks.some(
                            task => task.name === step.tool_name && task.status === 'in_progress'
                          );

                          let stepStyle = {};
                          let statusIndicator = "";

                          if (isCompleted) {
                            stepStyle = { textDecoration: 'line-through', color: 'rgb(107 114 128)' }; // gray-500
                            statusIndicator = "✅";
                          } else if (isErrored) {
                            stepStyle = { color: 'rgb(239 68 68)' }; // red-500
                            statusIndicator = "❌";
                          } else if (isInProgress) {
                            // No specific style for in-progress, just the indicator
                            statusIndicator = "⏳";
                          } else {
                            // Default, not yet started or status unknown
                            statusIndicator = "▫️"; // or some other placeholder
                          }

                          return (
                            <li key={index} style={stepStyle} className="mb-0.5">
                              <span className="mr-1">{statusIndicator}</span>
                              <span><strong>{step.tool_name}:</strong> {step.description}</span>
                            </li>
                          );
                        })}
                        </ol>
                      </div>
                    )}

                    {/* Task Progress - only if useBasicAgent is true */}
                    {useBasicAgent && (currentTasks.length > 0 || plannerStatus || dispatcherStatus || synthesizerStatus) && (
                      <div className="mb-2">
                        <TaskProgress
                          tasks={currentTasks}
                          onInterrupt={handleInterrupt}
                          isStreaming={isSending}
                          conversationId={activeConv || convId}
                          plannerStatus={plannerStatus}
                          dispatcherStatus={dispatcherStatus}
                          synthesizerStatus={synthesizerStatus}
                        />
                      </div>
                    )}
                      <MarkdownRenderer isAgent={true}>
                        {streamingMessage.content || ""}
                      </MarkdownRenderer>
                      {streamingMessage.isStreaming && !streamingMessage.isError && (
                        <span className="inline-block ml-1 w-2 h-4 bg-current animate-pulse" />
                      )}
                    </div>
                    <div className="text-xs mt-2 flex items-center justify-end gap-2 text-zinc-500 dark:text-zinc-400">
                      {streamingMessage.isStreaming && !streamingMessage.isError && (
                        <span className="flex items-center">
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                          {toolCallStatus ? toolCallStatus : "Generating..."}
                        </span>
                      )}
                      {streamingMessage.timestamp && (
                        <span className="whitespace-nowrap">
                          {formatTimestamp(streamingMessage.timestamp)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {messages.length > 0 && <div ref={messagesEndRef} className="h-4" />}
        </div>
      </div>

      {/* Input area + Suggestions, fixed at the bottom */}
      <div className="sticky bottom-0 w-full bg-zinc-50 dark:bg-zinc-900 py-3 border-t border-zinc-200 dark:border-zinc-700 z-10">
        {/* Suggestions Area */}
        {suggestions && suggestions.length > 0 && !isSending && (
          <div className="max-w-3xl w-full mx-auto px-4 mb-2 flex flex-wrap gap-2 justify-center sm:justify-start">
            {suggestions.map((suggestion, index) => (
              <Button
                outline
                key={index}
                size="sm"
                className="py-1 px-2.5 h-auto dark:bg-zinc-700 dark:hover:bg-zinc-600 border-zinc-300 dark:border-zinc-600 hover:bg-zinc-100 text-zinc-100 dark:text-zinc-200 rounded-lg text-xs cursor-alias"
                onClick={() => handleSuggestionClick(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </div>
        )}

        {/* Agent Mode Toggle */}
        <div className="mt-2 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-6">
            <SwitchField>
              <Label htmlFor="non-agentic-mode">Non-Agentic Mode</Label>
              <Switch 
                checked={useNonAgentic} 
                onChange={(checked) => {
                  setUseNonAgentic(checked);
                  setUseBasicAgent(!checked);
                }} 
                name="non-agentic-mode" 
                defaultChecked={useNonAgentic} 
              />
            </SwitchField>
          </div>
        </div>
        {imageAttachment && (
          <div className="max-w-3xl w-full mx-auto px-4 mb-2">
            <div className="relative inline-block">
              {imageAttachment.dataUrl && (
                <img 
                  src={imageAttachment.dataUrl} 
                  alt="Upload preview" 
                  className="h-20 rounded border dark:border-zinc-700"
                />
              )}
              {imageAttachment.url && (
                <div className="inline-flex items-center gap-2 p-2 rounded bg-zinc-100 dark:bg-zinc-800 border dark:border-zinc-700">
                  <ImageIcon className="h-4 w-4" />
                  <span className="text-xs truncate max-w-[200px]">{imageAttachment.url}</span>
                </div>
              )}
              <button 
                onClick={removeImageAttachment}
                className="absolute -top-2 -right-2 bg-zinc-200 dark:bg-zinc-700 rounded-full p-1"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* URL Input Area */}
        {showImageUrlInput && (
          <div className="max-w-3xl w-full mx-auto px-4 mb-2 flex gap-2">
            <input
              type="text"
              value={imageUrl}
              onChange={handleImageUrlChange}
              placeholder="Enter image URL"
              className="flex-1 py-1 px-2 text-sm rounded border border-zinc-300 dark:border-zinc-700 dark:bg-zinc-800"
            />
            <Button 
              size="sm" 
              outline
              onClick={addImageUrl}
              disabled={!imageUrl.trim()}
              className="py-1 px-2 h-auto"
            >
              Add
            </Button>
          </div>
        )}

        {/* Input Form */}
        <form
          className="flex max-w-3xl w-full mx-auto gap-2 px-4 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <Button
        type="button"
        plain
        onClick={imageAttachment || showImageUrlInput ? toggleImageUrlInput : handleImageUploadClick}
        className="h-9 w-9 rounded-full"
        title={imageAttachment ? "Add from URL instead" : "Add image"}
      >
        <ImageIcon />
      </Button>
      <input
              type="file"
              ref={imageInputRef}
              accept="image/*"
              onChange={(e) => handleImageAttachment(e.target.files[0])}
              className="hidden"
            />
          <Textarea
            ref={inputRef}
            value={input}
            autoCorrect="off"
            autoComplete="new-password"
            spellCheck={true}
            onChange={(e) => {
              setInput(e.target.value);
              if (e.target.value.trim() !== "" && suggestions.length > 0) {
                setSuggestions([]);
              }
            }}
            placeholder="Type a message..."
            rows={3}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <div className="flex flex-col gap-2">


            <Button
              type="submit"
              className="h-[44px] px-3.5 py-2 min-w-[44px] sm:min-w-[80px] flex items-center justify-center self-center my-auto"
              disabled={isSending || (!input.trim() && !imageAttachment)}
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <Send className="h-5 w-5" />
              )}
              <span className="ml-2 hidden sm:inline">Send</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default StreamingChatPage;