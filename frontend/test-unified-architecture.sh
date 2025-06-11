#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${YELLOW}=== Testing Unified Agent Architecture ===${NC}\n"

# Test message that should trigger task creation and execution
MESSAGE="Create a todo task called 'Test task creation' and then list my tasks"
echo -e "${BLUE}Sending test message: \"$MESSAGE\"${NC}\n"

# Make the request and capture SSE stream
echo -e "${CYAN}Watching for Agent Events:${NC}"
curl -X POST http://localhost:5175/api/agent/run \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$MESSAGE\", \"conv_id\": null}" \
  -N 2>/dev/null | while IFS= read -r line
do
  # Parse SSE events
  if [[ $line == event:* ]]; then
    EVENT=$(echo "$line" | cut -d' ' -f2-)
    echo -e -n "${GREEN}[EVENT: $EVENT]${NC} "
  elif [[ $line == data:* ]]; then
    DATA=$(echo "$line" | cut -d' ' -f2-)
    
    # Pretty print specific events
    if [[ $EVENT == "agent_status" || $EVENT == "task_created" || $EVENT == "task_updated" || $EVENT == "task_summary" ]]; then
      echo -e "${CYAN}$DATA${NC}" | jq -C . 2>/dev/null || echo "$DATA"
    else
      echo "$DATA" | jq -C . 2>/dev/null || echo "$DATA"
    fi
  fi
done

echo -e "\n${YELLOW}Test completed!${NC}"