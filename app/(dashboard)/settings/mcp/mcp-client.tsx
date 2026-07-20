"use client";
import { useEffect, useState } from "react";
import {
  Button,
  TextField,
  Input,
  Label,
  Chip,
  Card,
  CardHeader,
  CardContent,
  Alert,
  AlertIndicator,
  AlertContent,
  AlertTitle,
  CloseButton,
  Table,
} from "@heroui/react";
import { Copy, Check, KeyRound } from "lucide-react";

type McpTokenSummary = {
  id: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildConfigSnippet(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        "triolla-sales": {
          type: "http",
          url: "https://sales.triolla.io/api/mcp",
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    },
    null,
    2,
  );
}

/** A copyable, monospace code block with a single copy button. */
function CodeBlock({
  code,
  copied,
  onCopy,
  copyLabel,
}: {
  code: string;
  copied: boolean;
  onCopy: () => void;
  copyLabel: string;
}) {
  return (
    <div className="relative rounded-lg border border-[#e5e3df] bg-[#f8f7f5]">
      <button
        type="button"
        onClick={onCopy}
        aria-label={copyLabel}
        className="absolute top-2 right-2 p-1.5 rounded-md text-[#6b6866] hover:text-[#111110] hover:bg-white transition-colors"
      >
        {copied ? (
          <Check className="size-4 text-[#059669]" />
        ) : (
          <Copy className="size-4" />
        )}
      </button>
      <pre className="p-4 pe-10 text-xs font-mono text-[#111110] overflow-x-auto whitespace-pre">
        {code}
      </pre>
    </div>
  );
}

export function McpClient() {
  const [tokens, setTokens] = useState<McpTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [rawToken, setRawToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "config" | null>(null);

  async function loadTokens() {
    const res = await fetch("/api/mcp/tokens");
    const body = await res.json().catch(() => ({ tokens: [] }));
    setTokens((res.ok && Array.isArray(body.tokens)) ? body.tokens : []);
    setLoading(false);
  }

  useEffect(() => {
    loadTokens();
  }, []);

  async function generateToken() {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/mcp/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.error ?? "Failed to generate token");
        return;
      }
      setRawToken(body.token);
      setLabel(() => "");
      await loadTokens();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this token? Anything using it will lose access immediately.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/mcp/tokens/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        alert("Failed to revoke token");
        return;
      }
      await loadTokens();
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string, which: "token" | "config") {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 2000);
  }

  const configSnippet = buildConfigSnippet(rawToken ?? "<YOUR_TOKEN>");

  return (
    <div className="p-6 max-w-3xl space-y-8" dir="ltr">
      <div>
        <h1 className="text-xl font-semibold text-[#111110]">Claude / MCP Access</h1>
        <p className="text-sm text-[#6b6866] mt-1">
          Mint a personal access token to connect Claude Code or Claude Desktop to your Triolla
          sales data over MCP.
        </p>
      </div>

      {/* Generate */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#111110]">Generate a new token</p>
        <div className="flex items-end gap-2">
          <TextField
            value={label}
            onChange={(v: string) => setLabel(() => v)}
            className="flex-1 max-w-xs"
          >
            <Label className="block text-xs text-[#6b6866] mb-1">Label</Label>
            <Input
              placeholder="e.g. Ariel's laptop"
              className="w-full px-3 py-2 bg-[#f8f7f5] border border-[#e5e3df] rounded-md text-sm text-[#111110] placeholder-[#c8c5c2] focus:outline-none focus:border-[#1585ff]/40 focus:ring-1 focus:ring-[#1585ff]/20 transition-colors"
            />
          </TextField>
          <Button
            variant="primary"
            onPress={generateToken}
            isDisabled={busy || !label.trim()}
          >
            {busy ? "Generating…" : "Generate token"}
          </Button>
        </div>
      </div>

      {/* Raw token reveal — shown once */}
      {rawToken && (
        <Card variant="default" className="border-[#fcd34d]">
          <CardHeader className="flex items-center justify-between">
            <Alert status="warning" className="flex-1 border-0 bg-transparent p-0">
              <AlertIndicator>
                <KeyRound className="size-4" />
              </AlertIndicator>
              <AlertContent>
                <AlertTitle>Copy it now — it won&apos;t be shown again.</AlertTitle>
              </AlertContent>
            </Alert>
            <CloseButton
              aria-label="Dismiss"
              onPress={() => setRawToken(null)}
            />
          </CardHeader>
          <CardContent>
            <CodeBlock
              code={rawToken}
              copied={copied === "token"}
              onCopy={() => copy(rawToken, "token")}
              copyLabel="Copy token"
            />
          </CardContent>
        </Card>
      )}

      {/* Token table */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#111110]">Your tokens</p>
        <div className="rounded-lg border border-[#e5e3df] overflow-hidden">
          <Table>
            <Table.Content aria-label="MCP access tokens" className="w-full text-sm">
              <Table.Header>
                <Table.Column isRowHeader className="px-4 py-2 text-left text-xs font-medium text-[#9b9895] bg-[#f8f7f5]">
                  Label
                </Table.Column>
                <Table.Column className="px-4 py-2 text-left text-xs font-medium text-[#9b9895] bg-[#f8f7f5]">
                  Created
                </Table.Column>
                <Table.Column className="px-4 py-2 text-left text-xs font-medium text-[#9b9895] bg-[#f8f7f5]">
                  Last used
                </Table.Column>
                <Table.Column className="px-4 py-2 text-left text-xs font-medium text-[#9b9895] bg-[#f8f7f5]">
                  Status
                </Table.Column>
                <Table.Column className="px-4 py-2 bg-[#f8f7f5]" />
              </Table.Header>
              <Table.Body
                items={tokens}
                renderEmptyState={() => (
                  <div className="px-4 py-6 text-center text-sm text-[#9b9895]">
                    {loading ? "Loading…" : "No tokens yet."}
                  </div>
                )}
              >
                {(token) => (
                  <Table.Row id={token.id} className="border-t border-[#f3f2ef]">
                    <Table.Cell className="px-4 py-2.5 text-[#111110]">{token.label}</Table.Cell>
                    <Table.Cell className="px-4 py-2.5 text-[#6b6866] tabular-nums">
                      {formatDate(token.createdAt)}
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2.5 text-[#6b6866] tabular-nums">
                      {formatDate(token.lastUsedAt)}
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2.5">
                      <Chip color={token.revokedAt ? "danger" : "success"} variant="soft" size="sm">
                        {token.revokedAt ? "Revoked" : "Active"}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell className="px-4 py-2.5 text-right">
                      {!token.revokedAt && (
                        <Button
                          variant="danger-soft"
                          size="sm"
                          isDisabled={busy}
                          onPress={() => revoke(token.id)}
                        >
                          Revoke
                        </Button>
                      )}
                    </Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table>
        </div>
      </div>

      {/* Static connect snippet */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-[#111110]">Connect from Claude Code / Desktop</p>
        <p className="text-xs text-[#6b6866]">
          {rawToken
            ? "Add this to your MCP config — your new token is already filled in."
            : "Add this to your MCP config, replacing <YOUR_TOKEN> with a token generated above."}
        </p>
        <CodeBlock
          code={configSnippet}
          copied={copied === "config"}
          onCopy={() => copy(configSnippet, "config")}
          copyLabel="Copy config"
        />
      </div>
    </div>
  );
}
