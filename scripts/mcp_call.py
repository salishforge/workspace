#!/usr/bin/env python3
"""
MCP call helper for Salish Forge inter-agent communication.
Usage: python3 mcp_call.py <tool_name> [json_args]

Examples:
  python3 mcp_call.py check_messages '{"agent_name":"flint"}'
  python3 mcp_call.py get_system_status
  python3 mcp_call.py query_memory '{"query":"wonders architecture","tier":"warm"}'
"""

import sys, json, urllib.request

MCP_URL = "http://100.97.161.7:8484/mcp"
MCP_TOKEN = "sf-mcp-collab-2026"

def mcp_call(tool_name, arguments=None):
    payload = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {
            "name": tool_name,
            "arguments": arguments or {}
        }
    }
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {MCP_TOKEN}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        }
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        for line in r:
            line = line.decode().strip()
            if line.startswith("data:"):
                data = json.loads(line[5:].strip())
                if "result" in data:
                    content = data["result"].get("content", [])
                    for item in content:
                        print(item.get("text", ""))
                elif "error" in data:
                    print(f"ERROR: {data['error']}", file=sys.stderr)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    tool = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    mcp_call(tool, args)
