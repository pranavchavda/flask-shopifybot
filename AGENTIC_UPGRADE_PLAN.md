Agentic-Upgrade Implementation Road-map
======================================

This document captures the concrete, file-level steps required to migrate the code-base to the “agents-as-tools” architecture described in `frontend/AGENTIC_UPGRADE.md`.

────────────────────────
0. Nomenclature
────────────────────────
• **Basic Agent** – single, top-level orchestrator invoked by the backend.
• **Planner Agent & Executor Agents** – specialised sub-agents exposed to the Basic Agent via `.asTool()`.
• **todo-mcp-server** – local MCP server that persists the plan (to-do list).
• **Shopify MCP server** – already integrated.

────────────────────────
1. Code Clean-up
────────────────────────
1. Remove legacy entry points: `frontend/server/{simple-agent.js, super-simple-agent.js, agent_orchestrator.js}`.
2. `basic_orchestrator.js` and `basic-agent.js` become the only backend agent path.
3. Delete `frontend/server/agents.js` after its logic is migrated.
4. Prune `package.json` scripts accordingly.

────────────────────────
2. Wire-in `todo-mcp-server`
────────────────────────
File: `frontend/server/basic-agent.js`

1. `import { MCPServerStdio } from '@openai/agents'`.
2. Create and `await connect()` a new `MCPServerStdio` instance:
   ```js
   const todoMCPServer = new MCPServerStdio({
     name: 'Todo MCP Server',
     command: 'npx',
     args: ['-y', '@pranavchavda/todo-mcp-server'],
     env: { ...process.env },
     shell: true,
   });
   await todoMCPServer.connect();
   ```
3. Add `todoMCPServer` to the `mcpServers` array (alongside `shopifyMCPServer`).
4. Document any extra env vars (e.g., `TODO_MCP_BEARER_TOKEN`).

────────────────────────
3. Planner Agent ➜ tool `plan`
────────────────────────
• New `frontend/server/planner-agent.js` containing the former PlannerAgent definition (moved from `agents.js`).
• Expose as tool:
  ```js
  export const plannerTool = plannerAgent.asTool('plan', 'Delegate…');
  ```

────────────────────────
4. Executor Agents ➜ tools
────────────────────────
A. WebSearchExecutorAgent ⇒ `frontend/server/executor-websearch.js` → `.asTool('WebSearchToolExecutor', …)`.

B. ShopifyExecutorAgent ⇒ `frontend/server/executor-shopify.js` → `.asTool('ShopifyToolExecutor', …)` (reuse existing `shopifyMCPServer`).

────────────────────────
5. Merge Synthesizer logic into Basic Agent
────────────────────────
• Move SynthesizerAgent from `agents.js` into `basic-agent.js`; it now uses `plannerTool` and `dispatcherTool`.
• JSON plan still passed in first milestone; later steps may read/write via `todo-mcp-server` directly.

────────────────────────
6. Dispatcher Agent
────────────────────────
• Move to `frontend/server/dispatcher-agent.js` and expose as `.asTool('dispatch', …)`.

────────────────────────
7. Streaming updates in `basic_orchestrator.js`
────────────────────────
• Continue sending `conv_id` & `assistant_delta`.
• Add new SSE events:
  – `planner_status` { state, plan }
  – `task_progress` { taskId, status }
  – `dispatcher_done` { results }

────────────────────────
8. Front-end adjustments
────────────────────────
• Update `ChatPage.jsx` / `TaskProgress.jsx` to consume new SSE events and render plan + task badges.
• Ensure “Agent Mode” toggle posts to `/api/agent/run` (basic orchestrator).

────────────────────────
9. Tests & CI
────────────────────────
• Adapt `test-runner-api.js` to the unified endpoint and new SSE events.
• Add unit test spinning up `todo-mcp-server` via `MCPServerStdio`.

────────────────────────
10. Deployment Sequence
────────────────────────
1. Ship steps 1–2 (todo server wired, legacy code intact) → verify boot.
2. Introduce planner/dispatcher/executor refactor (steps 3–4).
3. Replace basic-agent & orchestrator streaming (steps 5–7).
4. Delete legacy files, finish front-end tweaks.

────────────────────────
11. Out-of-scope for first pass
────────────────────────
• Parallel task execution.
• Advanced retry/error handling.
• Web-socket transport (keep SSE).
