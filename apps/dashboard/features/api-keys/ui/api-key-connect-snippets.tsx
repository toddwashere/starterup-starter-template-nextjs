"use client";

import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { getPublicMcpEndpoint } from "@workspace/common/env/public-mcp";

import { keys } from "../../../keys";

type Props = {
  keyPrefix: string;
};

const PUBLIC_API_URL = keys().NEXT_PUBLIC_API_URL;
const MCP_ENDPOINT = getPublicMcpEndpoint();

export function ApiKeyConnectSnippets({ keyPrefix }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  }

  const snippets = {
    "claude-desktop": JSON.stringify(
      {
        mcpServers: {
          "my-mcp": {
            url: MCP_ENDPOINT,
            headers: { "x-api-key": `${keyPrefix}...` },
          },
        },
      },
      null,
      2,
    ),
    cursor: JSON.stringify(
      {
        mcpServers: {
          "my-mcp": {
            url: MCP_ENDPOINT,
            headers: { "x-api-key": `${keyPrefix}...` },
          },
        },
      },
      null,
      2,
    ),
    curl: `curl -H "x-api-key: ${keyPrefix}..." ${PUBLIC_API_URL}/v1/account`,
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Connect with this key</p>
      <Tabs defaultValue="claude-desktop">
        <TabsList>
          <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
          <TabsTrigger value="cursor">Cursor</TabsTrigger>
          <TabsTrigger value="curl">cURL</TabsTrigger>
        </TabsList>
        {(["claude-desktop", "cursor", "curl"] as const).map((id) => (
          <TabsContent key={id} value={id}>
            <div className="relative">
              <pre className="bg-muted rounded p-3 text-xs overflow-x-auto">
                {snippets[id]}
              </pre>
              <Button
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2"
                onClick={() => copy(id, snippets[id]!)}
              >
                {copied === id ? "Copied!" : "Copy"}
              </Button>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
