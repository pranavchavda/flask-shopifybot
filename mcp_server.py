"""
Module for handling MCP server connections for Shopify Dev MCP and Perplexity Ask
"""
import os
import asyncio
import json
import logging
import tempfile
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import timedelta

# Import agents package for MCP server communication
from agents.mcp.server import MCPServerStdio
from mcp.client.session import ClientSession as MCPClientSession

# Setup logging
logger = logging.getLogger(__name__)

# Get project root directory
PROJECT_ROOT = Path(__file__).parent.absolute()

# ---------------------------------------------------------------------------
# Monkeypatch: Increase default read_timeout_seconds for all MCP tool calls.
# ---------------------------------------------------------------------------

def _patch_mcp_client_timeout(default_seconds: int = 30) -> None:
    """Monkey-patch ``ClientSession.call_tool`` to use a longer default timeout.

    The upstream ``pydantic-ai`` library does not expose an easy way to change
    the 5-second timeout that bubbles up from ``modelcontextprotocol``'s
    ``BaseSession``.  To avoid forking the library, we patch the method at
    runtime so **every** tool invocation will wait *at least* ``default_seconds``
    seconds before failing with a timeout – unless the caller explicitly
    overrides ``read_timeout_seconds``.
    """

    # Prevent double-patching in case this module is imported multiple times.
    if getattr(MCPClientSession, "_timeout_patched", False):
        return

    original_call_tool = MCPClientSession.call_tool

    async def call_tool_with_timeout(
        self,  # type: ignore[override]
        name: str,
        arguments: Dict[str, Any] | None = None,
        read_timeout_seconds: timedelta | None = None,
    ):
        if read_timeout_seconds is None:
            read_timeout_seconds = timedelta(seconds=default_seconds)
        return await original_call_tool(
            self,
            name=name,
            arguments=arguments,
            read_timeout_seconds=read_timeout_seconds,
        )

    MCPClientSession.call_tool = call_tool_with_timeout  # type: ignore[assignment]
    MCPClientSession._timeout_patched = True  # type: ignore[attr-defined]

# Apply the patch as soon as the module is imported.
_patch_mcp_client_timeout()

class ShopifyMCPServer:
    """
    A class to handle communication with a local Shopify Dev MCP server instance.
    This spawns an npx process running @shopify/dev-mcp to provide schema information
    and documentation search capabilities.
    """
    def __init__(self):
        # Params for local Shopify Dev MCP server
        self.params = {"command": "npx", "args": ["-y", "@shopify/dev-mcp@latest"]}
        self.cache = True
    
    async def introspect_admin_schema(self, query, filter_types=None):
        """Query the Shopify Admin API schema using the MCP server"""
        if filter_types is None:
            filter_types = ["all"]
        try:
            async with MCPServerStdio(params=self.params, cache_tools_list=self.cache) as server:
                return await server.call_tool(
                    "introspect_admin_schema", {"query": query, "filter": filter_types}
                )
        except Exception as e:
            print(f"Error in introspect_admin_schema: {e}")
            # Fallback response
            return {
                "meta": None,
                "content": [{
                    "type": "text",
                    "text": f"## Matching GraphQL Types for '{query}':\nError connecting to Shopify MCP server: {str(e)}\n\nPlease check the Shopify Admin API documentation for accurate schema information.",
                    "annotations": None
                }],
                "isError": False
            }
    
    async def search_dev_docs(self, prompt):
        """Search Shopify developer documentation using the MCP server"""
        try:
            async with MCPServerStdio(params=self.params, cache_tools_list=self.cache) as server:
                return await server.call_tool(
                    "search_dev_docs", {"prompt": prompt}
                )
        except Exception as e:
            print(f"Error in search_dev_docs: {e}")
            # Fallback response
            return {
                "meta": None,
                "content": [{
                    "type": "text",
                    "text": f"## Search Results for '{prompt}':\nError connecting to Shopify MCP server: {str(e)}\n\nPlease check the Shopify developer documentation for accurate information.",
                    "annotations": None
                }],
                "isError": False
            }
    
    def stop(self):
        """Stop the MCP server process (no-op; context manager handles teardown)"""
        pass
    
    async def search_dev_docs(self, prompt):
        """Search Shopify developer documentation using the MCP server"""
        try:
            result = await self._run_mcp_command("search_dev_docs", {
                "prompt": prompt
            })
            
            # Check if we got an error response
            if isinstance(result, dict) and result.get("isError", False):
                logger.warning(f"Error from MCP server, using fallback response for search_dev_docs")
                return self._get_mock_docs_response(prompt)
            
            return result
        except Exception as e:
            logger.error(f"Exception in search_dev_docs: {e}")
            return self._get_mock_docs_response(prompt)
    
    def _get_mock_docs_response(self, prompt):
        """Get a mock documentation response when the MCP server fails"""
        
        # Basic mock response with common Shopify documentation
        mock_content = f"""## Search Results for '{prompt}':

### Shopify Admin API

The Shopify Admin API lets you build apps that extend Shopify's admin functionality. You can use the Admin API to create apps that integrate with merchants' stores and help them run their businesses.

**Key Resources:**
- [Admin API Overview](https://shopify.dev/api/admin) - Learn about the Admin API and how to use it
- [GraphQL Admin API](https://shopify.dev/api/admin-graphql) - Use GraphQL to query and modify data in a Shopify store
- [REST Admin API](https://shopify.dev/api/admin-rest) - Use REST to interact with Shopify resources

### Common GraphQL Patterns

**Querying Products:**
```graphql
query {{
  products(first: 10) {{
    edges {{
      node {{
        id
        title
        handle
        variants(first: 5) {{
          edges {{
            node {{
              id
              title
              sku
              price
            }}
          }}
        }}
      }}
    }}
  }}
}}
```

**Creating a Product:**
```graphql
mutation {{
  productCreate(input: {{
    title: "New Product",
    productType: "Accessories",
    vendor: "My Store",
    status: DRAFT
  }}) {{
    product {{
      id
      title
    }}
    userErrors {{
      field
      message
    }}
  }}
}}
```

For more specific information, please refer to the [official Shopify documentation](https://shopify.dev/docs).
"""
        
        return {
            "meta": None,
            "content": [{
                "type": "text",
                "text": mock_content,
                "annotations": None
            }],
            "isError": False
        }
    
    def stop(self):
        """Stop the MCP server process (no-op)"""
        pass

# Create a singleton instance
mcp_server = ShopifyMCPServer()

class PerplexityMCPServer:
    """
    A class to handle communication with a local Perplexity MCP server instance.
    This spawns an npx process running server-perplexity-ask.
    """
    def __init__(self):
        self.params = {
            "command": "npx",
            "args": ["-y", "server-perplexity-ask"],
            "env": {
                "PERPLEXITY_API_KEY": os.environ.get("PERPLEXITY_API_KEY", "")
            }
        }
        self.cache = True

    async def perplexity_ask(self, messages):
        """Ask Perplexity a question using the MCP server."""
        print("[MCP_SERVER_DEBUG] Attempting to start Perplexity MCP server...")
        try:
            async with MCPServerStdio(params=self.params, cache_tools_list=self.cache) as server:
                print("[MCP_SERVER_DEBUG] Perplexity MCP server context entered. Calling tool...")
                try:
                    tool_response = await server.call_tool(
                        "perplexity_ask", {"messages": messages}
                    )
                    print(f"[MCP_SERVER_DEBUG] Perplexity MCP tool_response: {str(tool_response)[:200]}...") # Log snippet
                    return tool_response
                except asyncio.TimeoutError as e:
                    print(f"[MCP_SERVER_DEBUG] asyncio.TimeoutError during Perplexity call_tool: {e}")
                    # Fallback response
                    return {
                        "meta": None,
                        "content": [{
                            "type": "text",
                            "text": f"Timeout error connecting to Perplexity API: {str(e)}\n\nPlease try again later.",
                            "annotations": None
                        }],
                        "isError": False
                    }
                except Exception as e:
                    print(f"[MCP_SERVER_DEBUG] Exception during Perplexity call_tool: {e}")
                    return {
                        "meta": None,
                        "content": [{
                            "type": "text",
                            "text": f"Error connecting to Perplexity API: {str(e)}\n\nPlease try again later.",
                            "annotations": None
                        }],
                        "isError": False
                    }
        except Exception as e:
            print(f"[MCP_SERVER_DEBUG] Exception during Perplexity MCPServerStdio setup: {e}")
            return {
                "meta": None,
                "content": [{
                    "type": "text",
                    "text": f"Error setting up Perplexity MCP server: {str(e)}\n\nPlease try again later.",
                    "annotations": None
                }],
                "isError": False
            }

perplexity_mcp_server = PerplexityMCPServer()
