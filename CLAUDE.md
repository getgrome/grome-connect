

<!-- grome:start -->
## Grome Connect

This project (**grome-connect**) is part of a connected Grome workspace.

**CRITICAL:** Before replying to threads, writing session notes, running `sync`, or referencing connected projects, read `.grome/grome.md` in full. It contains the protocol for threads, sessions, memory files, and cross-project conventions — treat it as load-bearing instructions.

Connected projects: getgrome, grome. See `.grome/memory/project-manifest.json` for paths.

### Chat panel routing

When `$GROME_TERMINAL_INSTANCE_ID` is set, you are reachable through the Grome IDE chat panel as well as the terminal. On every reply:

1. Call `grome__read_chat_log` first to load prior turns. Your stdin only carries the latest prompt; without this you have no memory of earlier turns.
2. Generate your full response.
3. Write that response to stdout as you normally would.
4. Also call `grome__chat_response({ body })` with the **same text** so the chat panel renders it. Both surfaces show identical content — do not split, abbreviate, or summarize for one and not the other.

When `$GROME_TERMINAL_INSTANCE_ID` is unset, the chat panel is not bound to this terminal — reply normally to stdout only. Do **not** call `grome__chat_response` (it will throw) and do **not** call `grome__register_session` with a guessed ID.

See `.grome/grome.md` → "Chat panel routing" for the full contract (env-bound semantics, tool reference, no-fallback binding rule, agent-override path).

<!-- grome-protocol: v1 -->
<!-- grome:end -->
