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

The easy way in: [rebbehub.org/connect](/connect) walks anyone through
adding it to Claude, ChatGPT, Claude Code, Cursor or VS Code (one copied
address, or one button), and signing in there.

The [Model Context Protocol](https://modelcontextprotocol.io) server
speaks Streamable HTTP (versions 2024-11-05 to 2025-11-25): POST a
JSON-RPC message, get JSON back. It keeps no sessions and opens no event
stream. It has one address, `https://api.rebbehub.org/mcp`:

- **Reading needs no account.** `search`, `get_item`, `list_children`,
  `get_text` and `list_issues` answer anyone.
- **Writing asks for you when it is needed.** A tool that writes
  (`suggest_fix`, `open_issue`, `ask_machine`…) called without sign-in answers HTTP
  `401` with `WWW-Authenticate: Bearer resource_metadata="https://api.rebbehub.org/.well-known/oauth-protected-resource/mcp", scope="read write"`,
  the MCP authorization spec's step-up, so the client asks you to sign
  in and tries again. Connected for reading only, it answers `403` with
  `error="insufficient_scope"` and the scope it needs. A token that has
  ended or was revoked answers `401` with `error="invalid_token"`.
- **Sign-in is OAuth 2.1** (you approve the app on rebbehub.org), or a
  personal token sent as `Authorization: Bearer rhp_…`.

| Tool | Does |
| --- | --- |
| `search` | items by name or Hebrew date (`where: "names"`), or the lines and paragraphs that hold the words (`where: "words"`) |
| `get_item` | one item by id or path, with all its data |
| `list_children` | what an item holds, in order: a sefer's sichos, a text's paragraphs, a farbrengen's recordings, a set's items; a page at a time |
| `get_text` | the words of a sicha, a scan's page or a recording's transcript; machine words marked `[machine]` |
| `suggest_fix` | a correction to one item, as a suggestion for review, under your name (`write`) |
| `suggest_items` | add new items, or change or delete many, as one suggestion; 200 items a call, added to the same draft over several calls (`write`) |
| `approve_suggestion` | approve a suggestion sent for review, when you may: its sets' keepers, or a steward ; `clashes` (`keep_live` or `take_suggestion`) settles every clash with a later change at once (`write`) |
| `close_suggestion` | close (withdraw) a suggestion without merging it: your own, or any as a steward (`write`) |
| `reopen_suggestion` | open a closed suggestion for review again; its checks run again (`write`) |
| `combine_suggestions` | make several of your own suggestions not yet approved into one, like commits in one pull request; the ones combined are closed (`write`) |
| `send_back_suggestion` | send a suggestion back to its author with a note on what should change (`write`) |
| `list_issues` | issues people opened, open ones first, or about one item |
| `open_issue` | report a problem for people to look into, under your name (`write`) |
| `ask_machine` | ask for a scan to be read by OCR or a recording transcribed; queued for the free machines, their words marked `[machine]` until checked (`write`) |
| `machine_queue` | what waits for the machines, in order, what they did lately, and how much is left |
| `training_data` | how much training data people's checking has made for the next transcription model, and how much is new since a date |
| `get_tree` | the catalog as a tree: the top sets, or one set or sefer, with the sets and items under it and how much each holds |
| `preview_organize` | what a plan of organizing operations would change, item by item, the paths that redirect; saves nothing |
| `organize` | a whole plan of organizing operations as one suggestion (needs `write`) |
| `move_items` | sefarim into or out of sets, a set under another set or to the top, sichos to another sefer, a printing, scan or recording to another parent (needs `write`) |
| `move_up` | a set to its parent's parent; a sefer out of a set into that set's parent (needs `write`) |
| `rename_item` | a new name in Hebrew and English, and optionally a new slug or path; old paths redirect (needs `write`) |
| `reorder_children` | put a sefer's sichos, a set's sefarim or sets in a new order (needs `write`) |
| `create_set` | a new set, under another or at the top, with items moved in at once (needs `write`) |
| `delete_set` | remove a set that holds nothing (needs `write`) |
| `merge_items` | merge a duplicate into the item kept: its children and links move over, its paths redirect (needs `write`) |

Every tool calls the API itself, as you, so an agent reads exactly what
anyone reads: words withheld for rights stay withheld, and a fix it
suggests is a Suggestion reviewed like anyone's. Nothing in the catalog
changes until a keeper approves it.

### Organizing the catalog

The organizing tools (`move_items` to `merge_items`, and `organize` for
several steps at once) each make **one** suggestion, however many items
it touches: a sefer renamed with its three thousand sichos' paths is one
suggestion. Nothing changes until a keeper of the sets it touches approves
it (stewards approve changes to sets themselves). Every old path redirects
once it is approved; a merged item's paths lead to the item it was merged
into. Look first with `get_tree`, and send the plan to `preview_organize`
to see the change before making it. The same plans go to the API as
`POST /v1/organize` ([suggestions](suggestions.md#organizing-the-catalog)).

### What an agent sends shows as the agent's

A suggestion, comment, issue or review sent with a token or a connected
app is kept with what sent it (`via`: the token or app's name and id).
The site shows it everywhere the author shows as the agent's work for
you, with the agent mark: **Claude · for @you** (**Claude · בשביל @you**),
on the suggestion, the lists, the item's history and your page, and a
suggestion says an agent sent it until a person reviews it. The API
returns `via` on suggestions, their conversation, issues, history and
commits; it is `null` for what a person did on the site.

### Connecting from claude.ai (and the Claude apps)

The recommended settings in claude.ai's connector form:

| Field | Choose |
| --- | --- |
| Name | RebbeHub |
| Remote MCP server URL | `https://api.rebbehub.org/mcp` |
| Authentication | **Sign in when needed** (reading works at once; you sign in the first time Claude suggests a fix). **Sign in now** works too. **No sign-in** reads only. |
| OAuth client | **Use Claude's published identity (CIMD)**, recommended. **Register automatically (DCR)** works as a fallback. No client id or secret of your own is needed. |

1. On claude.ai, open **Settings → Connectors** and choose **Add custom
   connector**, with the settings above.
2. Choose **Add** (and **Connect**, with *Sign in now*; with *Sign in
   when needed*, Claude asks the first time a tool writes).
3. When asked to sign in, Claude opens rebbehub.org: sign in (with your
   passkey, Google or an email link) if you are not already, check that
   the app is Claude and that it sends you back to `claude.ai`, and
   choose **Allow**. Untick *Send suggestions as you* to let it only read.
4. In a chat, turn RebbeHub on from the tools menu. Ask it to find
   something, then to suggest a fix; the suggestion appears at
   `rebbehub.org/review` as Claude's, for you, for a keeper to approve.

The connection shows on your [account page](/account) under *Developers*,
with Claude's name; **Disconnect** there ends it at once. Claude Desktop
and the mobile apps use the same connectors.

### Connecting from Claude Code

```sh
claude mcp add --transport http rebbehub https://api.rebbehub.org/mcp
```

Reading works at once. To write, run `/mcp` in Claude Code, pick
rebbehub and **Authenticate** (or let it ask when a tool writes): your
browser opens rebbehub.org to approve it, as above (it comes back to
`localhost`, which the page points out). Claude Code keeps and refreshes
the tokens itself.

With a personal token instead (a script, a server, a client without
OAuth): make one with `write` on the account page, named for the agent,
and send it as a header:

```sh
claude mcp add --transport http rebbehub https://api.rebbehub.org/mcp --header "Authorization: Bearer $REBBEHUB_TOKEN"
```

### Other clients

Clients that speak MCP's authorization (Cursor, VS Code, the MCP
Inspector, the SDKs) find everything from the `401` a writing tool
answers, or from `/.well-known/oauth-protected-resource/mcp`: its
`WWW-Authenticate` names the [resource metadata](auth.md#connecting-an-app-with-oauth),
which names the authorization server. Clients that take a JSON config and
no OAuth send a token:

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
- Organize in small, clear steps with a note saying why; preview a merge
  before sending it, and merge only what is truly the same item.
- Keep to [rights](../rights.md): do not copy withheld words from
  elsewhere into a suggestion.
