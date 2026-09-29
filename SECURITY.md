# Security

Please report security problems privately through
[GitHub's private vulnerability reporting](https://github.com/shmuky/RebbeHub/security/advisories/new),
not in a public issue. Say what you found and how to reproduce it; a
steward will answer and keep you informed until it is fixed, and credit
you if you wish.

In scope: this repository's code (the API, the catalog engine, the
importers and tools) and the services that run it, including the site,
API tokens, the MCP server and webhooks. Especially welcome: ways to merge
without approval, to serve a file whose rights forbid it, to read or
change what an account should not (or what a token's scopes should not
allow), to get around the rate limits, or to learn a reporter's address.

API tokens are stored only as a hash and shown once; if one leaks, revoke
it on your account page. If you find someone else's token, please report
it here rather than use it.

Signing keys for catalog dumps are never kept in this repository. The
public keys that dumps are verified with are published by the API
(`keys` in [`/v1/mirrors`](https://api.rebbehub.org/v1/mirrors)); see
[docs/mirrors.md](docs/mirrors.md).
