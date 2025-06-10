import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import tailwindTypography from "@tailwindcss/typography";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load environment variables from .env file
import { config } from 'dotenv';
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export default defineConfig({
  plugins: [
    react(),
    tailwindcss({
      config: {
        darkMode: "class",
        content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
        theme: {
          extend: {
            colors: {
              shopifyPurple: "#5c6ac4",
            },
          },
        },
        plugins: [tailwindTypography],
      },
    }),
    {
      name: 'server-middleware',
      async configureServer(server) {
        // Check if environment variables are available in server middleware
        console.log('SERVER MIDDLEWARE ENV CHECK:');
        console.log('OPENAI_API_KEY available:', !!process.env.OPENAI_API_KEY);
        console.log('OPENAI_MODEL:', process.env.OPENAI_MODEL);
        console.log('DATABASE_URL:', process.env.DATABASE_URL);
        if (!process.env.SKIP_MEMORY_SERVER) {
          const { spawn } = await import('child_process');
          console.log('Starting local memory server for agent context...');
          const memoryProc = spawn(
            'npx', ['-y', '@modelcontextprotocol/server-memory'],
            {
              env: {
                ...process.env,
                MEMORY_FILE_PATH: process.env.MEMORY_FILE_PATH,
              },
              stdio: 'inherit',
              detached: true,
            }
          );
          memoryProc.unref();
          const cleanup = () => {
            try {
              process.kill(-memoryProc.pid);
            } catch {}
          };
          process.on('SIGINT', () => {
            cleanup();
            process.exit();
          });
          process.on('exit', cleanup);
        }
        const express = (await import('express')).default;
        const bodyParser = (await import('body-parser')).default;
        const chatHandler = (await import('./server/chat')).default;
        const convHandler = (await import('./server/conversations')).default;
        const streamChatHandler = (await import('./server/stream_chat')).default;
        // Agent orchestrator v2 removed - using basic orchestrator for all agent modes
        const basicOrchestratorRouter = (await import('./server/basic_orchestrator_simple')).default;
        const superSimpleOrchestratorRouter = (await import('./server/super-simple-orchestrator')).default;
        const testSseRouter = (await import('./server/test-sse')).default; // Import the test SSE router

        const apiApp = express();
        apiApp.use(bodyParser.json({ limit: '50mb' }));
        apiApp.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
        apiApp.use('/api/conversations', convHandler);
        apiApp.use('/api/chat', chatHandler);
        apiApp.use('/stream_chat', streamChatHandler);
        // V2 agent orchestrator route removed - all agent modes use basic orchestrator
        apiApp.use('/api/agent/basic', basicOrchestratorRouter); // Add the simple basic agent route
        apiApp.use('/api/agent/super-simple', superSimpleOrchestratorRouter); // Add the super simple agent WITHOUT MCP
        apiApp.use('/api/sse', testSseRouter); // Add the SSE test endpoint for debugging
        server.middlewares.use(apiApp);
      },
    },
  ],
  server: {
    watch: {
      ignored: ['**/dev.db', '**/prisma/migrations/**'],
    },
    port: 5173,
    open: true,
    host: "0.0.0.0",
  },
  resolve: {
    alias: {
      "@components": path.resolve(__dirname, "src/components"),
      "@common": path.resolve(__dirname, "src/components/common"),
      "@features": path.resolve(__dirname, "src/features"),
      "@routes": path.resolve(__dirname, "src/routes"),
      "@lib": path.resolve(__dirname, "src/lib"),
    },
  },
});