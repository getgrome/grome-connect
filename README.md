# grome-connect

CLI that bidirectionally links projects so AI agents can share context across repos.

When you link two projects, `grome` scans each for routes, types, and schemas, and writes a shared-context snapshot into every linked project's `.grome/memory/` directory. Agents running in any linked project see the shape of the others — endpoints, types, schemas — without you pasting context between chats.

## Install

```bash
npm i -g grome-connect
```

> **Package vs command name.** The npm package is `grome-connect`, but the binary installed on your `PATH` is called `grome`. So you install `grome-connect` once and then run `grome init`, `grome link`, `grome sync`, etc. The package name was rejected as `grome` on npm (too similar to existing packages), so we kept the command short and scoped the package.

## Quickstart

```bash
# In project A
grome init
grome link ../project-b

# Scan + propagate context to all linked projects
grome sync

# See current connections and memory freshness
grome status
```

After `sync`, each linked project gets:

- `.grome/memory/route-map.json` — cross-project API endpoints
- `.grome/memory/shared-types.json` — shared TypeScript types
- `.grome/memory/api-schemas.json` — validation schemas
- `.grome/memory/project-manifest.json` — who's linked, when last synced
- A "Connected Workspaces" block injected into `CLAUDE.md`, `.cursorrules`, `AGENTS.md`, and other agent config files

## Commands

| Command | Purpose |
|---|---|
| `grome init` | Create `.grome/` in the current project. |
| `grome link <path>` | Bidirectionally link two projects. |
| `grome unlink <path>` | Remove a link. |
| `grome sync` | Scan all linked projects and propagate shared memory. |
| `grome status` | Show current connections and memory staleness. |
| `grome watch` | Auto-sync on file changes. |
| `grome handoff ...` | Create/list cross-project handoff docs. |

## What gets synced vs. kept local

Anything under `.grome/memory/` is shared to linked peers. Anything under `.grome/sessions/` or `.grome/hook-events.jsonl` stays project-local. Secrets are scrubbed by `SecretScanner` before any write.

## Development

```bash
npm install
npm run build      # tsup → dist/
npm run typecheck
npm test
```

## License

MIT © Ronald Lee
