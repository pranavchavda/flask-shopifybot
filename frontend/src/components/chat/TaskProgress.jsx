import React from "react";
import { CheckCircle, Clock, AlertTriangle, X } from "lucide-react";
import { Button } from "@common/button";
import { Text, Code } from "@common/text";
import { Badge } from "@common/badge";

export function TaskProgress({ tasks, onInterrupt, isStreaming, conversationId, plannerStatus, dispatcherStatus, synthesizerStatus }) {
  // Filter tasks by conversation_id if both are provided
  const filteredTasks = conversationId && tasks ? 
    tasks.filter(task => !task.conversation_id || task.conversation_id === conversationId) : 
    tasks;
  
  const showStatus = Boolean(plannerStatus || dispatcherStatus || synthesizerStatus);
  if ((!filteredTasks || filteredTasks.length === 0) && !showStatus) {
    return null;
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "in_progress":
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
      case "pending":
        return <div className="h-4 w-4 border-2 border-gray-300 rounded-full" />;
      case "error":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <div className="h-4 w-4 border-2 border-gray-300 rounded-full" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "completed":
        return "green";
      case "in_progress":
        return "blue";
      case "pending":
        return "gray";
      case "error":
        return "red";
      default:
        return "gray";
    }
  };

  const completedTasks = filteredTasks.filter(task => task.status === "completed").length;
  const totalTasks = filteredTasks.length;
  const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Text className="font-medium text-blue-900 dark:text-blue-100">
            Agent Task Progress
          </Text>
          <Badge color="blue">
            {completedTasks}/{totalTasks}
          </Badge>
          
          {/* Show current execution phase */}
          {(plannerStatus || dispatcherStatus || synthesizerStatus) && (
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 bg-blue-500 rounded-full animate-pulse"></div>
              <Text className="text-xs text-blue-700 dark:text-blue-300">
                {plannerStatus || dispatcherStatus || synthesizerStatus}
              </Text>
            </div>
          )}
        </div>
        {isStreaming && onInterrupt && (
          <Button 
            size="sm" 
            variant="outline" 
            color="red"
            onClick={onInterrupt}
            className="flex items-center gap-1"
          >
            <X className="h-3 w-3" />
            Stop
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-3">
        <div 
          className="bg-blue-500 h-2 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${progressPercentage}%` }}
        /> 
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {filteredTasks.slice().reverse().map((task, index) => (
          <div key={task.id || index} className="flex items-start gap-2">
            {getStatusIcon(task.status)}
            <div className="flex-1 min-w-0">
              <div className="flex-1">
                <Text 
                  className={`text-sm font-medium ${
                    task.status === "completed" 
                      ? "line-through text-gray-600 dark:text-gray-400" 
                      : "text-gray-900 dark:text-gray-100"
                  }`}
                >
                  {task.content}
                </Text>
                
                {/* Show tool and action details */}
                {(task.toolName || task.action) && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    {task.toolName && (
                      <Badge size="sm" color="gray" className="text-xs">
                        {task.toolName}
                      </Badge>
                    )}
                    {task.action && (
                      <Code className="text-xs">
                        {task.action}
                      </Code>
                    )}
                  </div>
                )}
                
                {/* Show task arguments in collapsible format */}
                {task.args && Object.keys(task.args).length > 0 && (
                  <details className="mt-1 group">
                    <summary className="text-xs text-gray-500 dark:text-gray-400 cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-300">
                      View parameters
                    </summary>
                    <div className="mt-1 bg-gray-50 dark:bg-gray-800 rounded p-2">
                      <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {JSON.stringify(task.args, null, 2)}
                      </pre>
                    </div>
                  </details>
                )}
                
                {/* Show task result if available */}
                {task.result && (
                  <details className="mt-1 group">
                    <summary className="text-xs text-green-600 dark:text-green-400 cursor-pointer select-none hover:text-green-700 dark:hover:text-green-300">
                      View result
                    </summary>
                    <div className="mt-1 bg-green-50 dark:bg-green-900/20 rounded p-2">
                      <pre className="text-xs text-green-700 dark:text-green-300 whitespace-pre-wrap">
                        {typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}
                      </pre>
                    </div>
                  </details>
                )}
                
                {/* Show error if available */}
                {task.error && (
                  <div className="mt-1 bg-red-50 dark:bg-red-900/20 rounded p-2">
                    <Text className="text-xs text-red-700 dark:text-red-300">
                      Error: {task.error}
                    </Text>
                  </div>
                )}
              </div>
              {task.subtasks && task.subtasks.length > 0 && (
                <div className="ml-4 mt-1 space-y-1">
                  {task.subtasks.map((subtask, subIndex) => (
                    <div key={subIndex} className="flex items-start gap-2">
                      {getStatusIcon(subtask.status || "pending")}
                      <details className="w-full group" open={false}>
                        <summary className="text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none flex items-center">
                          <span className="flex-1 truncate">
                            {subtask.content != null
                              ? typeof subtask.content === "object"
                                ? "See details"
                                : subtask.content
                              : ""}
                          </span>
                        </summary>
                        {subtask.content != null && typeof subtask.content === "object" && (
                          <pre className="bg-zinc-100 dark:bg-zinc-800 rounded p-2 mt-1 text-xs overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(subtask.content, null, 2)}
                          </pre>
                        )}
                      </details>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {task.status && (
              <Badge 
                size="sm" 
                color={getStatusColor(task.status)}
                className="ml-2"
              >
                {task.status}
              </Badge>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}