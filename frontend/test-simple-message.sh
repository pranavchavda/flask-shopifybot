#!/bin/bash

# Simple test to check if the agent responds at all
echo "Testing simple message..."
curl -X POST http://localhost:5174/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, just testing the UI"}' \
  -N | head -20