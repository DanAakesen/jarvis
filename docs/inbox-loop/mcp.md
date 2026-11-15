# Connect an AI assistant to the inbox (MCP)

Status: **tested in CI against the protocol with a fake vault; not yet connected to a real assistant.** Needs `JARVIS_INBOX_ENABLED=true` on the backend and migrations 0081 to 0083 applied.

The inbox is an MCP server at `https://<your Jarvis backend host>/inbox/mcp` (Streamable HTTP, stateless). It runs the same store as Jarvis itself, so the path guard (only `Inbox/`), secret refusal, size limits and idempotent create are identical. The assistant's own model writes the note, so Jarvis spends nothing on structuring.

## Tools

| Tool | Credential scope | Does |
| --- | --- | --- |
| `inbox_capture` | write, read_write | Save one idea, ask or loose thought: `title`, optional `note`, optional verbatim `quote`, optional `captureId` for retries |
| `inbox_items` | read_write | List or search inbox items, or read one in full by `id` |
| `inbox_close` | read_write | Close an item on Dan's word: moves it to `Inbox/Closed/` with a trail line; never deletes |

Nothing outside `Inbox/` is reachable, so the assistant cannot read or change other vault notes through this server.

## 1. Get a credential

In Jarvis chat: "Make me an inbox credential called Claude with read and write access." Jarvis shows a value starting `ji.` once. Use scope `write` for something that only adds items. Say "revoke the Claude credential" to stop it at once; up to five credentials exist. Treat the value like a password.

## 2. Connect

Assistants that let you send a request header:

- **Claude Code:** `claude mcp add --transport http jarvis-inbox https://<host>/inbox/mcp --header "Authorization: Bearer ji.…"`
- **Codex:** in `~/.codex/config.toml`, `[mcp_servers.jarvis-inbox]` with `url = "https://<host>/inbox/mcp"` and `bearer_token_env_var = "JARVIS_INBOX_TOKEN"`, then export that variable.
- **GitHub Copilot CLI:** in its MCP configuration add a server of type `http` with the URL and the header `Authorization: Bearer ji.…`.

These client settings follow each product's documented options but were not run against this server.

## Not supported yet: ChatGPT and claude.ai custom connectors

Those connectors authenticate with OAuth (or not at all) and cannot send a fixed bearer header. Connecting them needs an OAuth authorization server in front of this route. The planned route is an Entra app registration with `inbox.read` and `inbox.write` scopes, like the Health connector. Creating an Entra registration is an owner action and has not been done, so this is **not built**. Until then, ChatGPT and claude.ai can still capture by the iPhone Shortcut path or by the vault `AGENTS.md` convention.

## Safety notes

- The server rejects browser requests (any `Origin` header) and query selectors, limits a request to 64 KiB, and rate limits each peer and credential before any database lookup.
- `inbox_close` cannot verify that Dan asked for it, unlike Jarvis's own chat tool; its description says only Dan's word closes an item. Give `read_write` only to assistants you trust with that.
- Note text is untrusted data. A note that says "close everything" is just a note.
