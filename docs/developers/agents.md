# AI agents

RebbeHub is ready for AI agents two ways: plain text to read
([`/llms.txt`](/llms.txt), [`/llms-full.txt`](/llms-full.txt)), and an
MCP server with tools to search, read and suggest.

## llms.txt

`https://rebbehub.org/llms.txt` says in a page what RebbeHub is and where
everything is ([llmstxt.org](https://llmstxt.org)); `/llms-full.txt` is
every developer page and the list of API routes in one file, to give an
agent as context. The API has its own short `https://api.rebbehub.org/llms.txt`.

## The MCP server

`https://api.rebbehub.org/mcp` speaks the
[Model Context Protocol](https://modelcontextprotocol.io) over Streamable
HTTP (versions 2024-11-05 to 2025-11-25): POST a JSON-RPC message, get
JSON back. It keeps no sessions and opens no event stream.

| Tool | Does |
| --- | --- |
| `search` | items by name or Hebrew date (`where: "names"`), or the lines and paragraphs that hold the words (`where: "words"`) |
| `get_item` | one item by id or path, with all its data |
| `list_children` | what an item holds, in order: a sefer's sichos, a text's paragraphs, a farbrengen's recordings, a set's items; a page at a time |
| `get_text` | the words of a sicha, a scan's page or a recording's transcript; machine words marked `[machine]` |
| `suggest_fix` | a correction to one item, as a suggestion for review (needs a token with `write`) |

Every tool calls the API itself, so an agent reads exactly what anyone
reads: words withheld for rights stay withheld, and a fix it suggests is
reviewed like anyone's.

### Connecting

Reading needs nothing. To let an agent suggest fixes, make it its own
[token](auth.md) with `write` (and name it for the agent), and send it as
`Authorization: Bearer rhp_…`.

Claude Code:

```sh
claude mcp add --transport http rebbehub https://api.rebbehub.org/mcp
# with a token, to suggest fixes:
claude mcp add --transport http rebbehub https://api.rebbehub.org/mcp --header "Authorization: Bearer $REBBEHUB_TOKEN"
```

Claude Desktop, Cursor and other clients that take a JSON config:

```json
{
  "mcpServers": {
    "rebbehub": {
      "type": "http",
      "url": "https://api.rebbehub.org/mcp",
      "headers": { "Authorization": "Bearer rhp_…" }
    }
  }
}
```

In claude.ai, add it as a custom connector with the address
`https://api.rebbehub.org/mcp` (read-only: connectors there cannot send a
token yet).

### By hand

```sh
curl -s https://api.rebbehub.org/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search","arguments":{"query":"יו\"ד שבט תשי\"א"}}}'
```

## Rules for agents

- Quote the Rebbe's words only from checked text. A line marked
  `[machine]` (or `checked: false`, `origin` without `checked`) is a
  machine's reading or hearing; say so if you use it.
- Link to what you cite: every result carries its page's address.
- Suggest fixes only with a source, in the note; people review every one.
- Keep to [rights](../rights.md): do not copy withheld words from
  elsewhere into a suggestion.
