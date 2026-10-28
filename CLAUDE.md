# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Built (see `docs/superpowers/plans/2026-10-28-engine-match-server.md`, tasks 1-10). Node.js >= 20, CommonJS, no bundler;
runtime deps are `ws` and `better-sqlite3` only.

Conversation language with the user: **Vietnamese**.

## Commands

| Command | What it does |
| :--- | :--- |
| `npm test` | All unit tests (`node:test`: `server/test`, `agent/test`, `test` e2e). The Rapfi oracle is skipped unless `RAPFI_ENGINE` is set. |
| `RAPFI_ENGINE=/path/to/pbrain-rapfi npm test` | Same plus `server/test/oracle.test.js` (cross-checks `checkWin` against a real Rapfi; needs the net files next to the binary). |
| `node --test server/test/match.test.js` | One test file. |
| `PORT=8080 npm start` | Server (`server/bin/server.js`); env vars in `docs/deploy.md`. |
| `node agent/bin/engine-agent.js --engine <path> --token <token> --server ws://host:8080/ws/agent` | Player's local agent. |

## Layout

- `server/src`: `board`/`rules` (win detection for freestyle, standard, caro), `openings`/`schedule`, `clock`/`game` (one game),
  `match` (lifecycle, reconnect windows; I/O injected), `protocol` (wire messages), `rooms`/`db` (tokens, limits, SQLite), `server` (HTTP + WS).
- `agent/src`: `engine-process`, `adapters/{rapfi,gomocup}`, `search` (strict STOP state machine), `detect` (ABOUT + config probe), `agent`.
- `web/`: classic scripts on `window.TestSite` (`i18n`, `board`, `live`, `create`, page scripts); pages `index`, `room`, `watch`.
- Tests: `agent/test/fake-engine.js` is a scriptable engine (env `FAKE_*`, documented at its top). Always kill spawned engines in an `after` hook
  or a failing assertion leaves the runner hanging.
- Decisions: `docs/adr/`; the approved design is in `docs/superpowers/specs/`.

## What this is

A client-server website for **engine-vs-engine testing** (Gomoku/Caro, Gomocup-style engines):

- Exactly **2 players**. Player A connects their *local* engine to the server; Player B does the same.
- The **server hosts and organizes the tournament** (pairing, games, results). It does not run the engines.
- The web UI shows the board and the live game. The board UI is inherited from `GomokuBoardSite`.

## Reference projects (read before designing; do not edit them)

| Path (under `/run/media/ngmint/Data/Programming/Programming/`) | Take from it |
| :--- | :--- |
| `HTML/GomokuBoardSite/` | Board UI. Classic `<script>` IIFEs on a `window.Gomoku` namespace, no build step. `js/game.js` owns game state (variation tree, walls/portals/torus); `js/board.js` renders the SVG; `js/engine.js` holds the Rapfi/Gomocup client (`YXBOARD` block + `YXNBEST`). Its own `CLAUDE.md` lists product decisions (vi default + en, all strings via `i18n.js`, spiral cell numbering, no win detection). |
| `HTML/extension_vncaro/server/` | Engine/protocol interface. Ports-and-adapters Python bridge: `bridge/ports.py` defines `EngineAdapter` (`start`, `begin_search`, `parse_line`, `stop_command`, `shutdown_commands`) and the `Info`/`Move`/`Log` events; `bridge/adapters/gomocup.py` + `rapfi.py` implement it; `bridge/session.py` is the per-client search state machine; `bridge/process.py` wraps the subprocess. Rationale: its `docs/adr/0001-*.md`. |
| `C++/Project/Lab/Rapfi_V3_PTR/dev/rapfi/Rapfi/docs/protocol.md` | Authoritative engine text protocol (Piskvork base + Yixin extension + Rapfi `INFO ...` extension). Also `protocol-wall.md`, `protocol-style.md`. |

Facts from those references that will bite a server implementer:

- Engine protocol is whitespace-tokenised text on stdin/stdout. **While an engine is thinking it ignores every command except `END`/`STOP`/`YXSTOP`**, so a new job must `STOP`, wait for the move line, then send the next command. Rapfi answers *every* search with one move line, stopped or not.
- Coordinates are 0-based `x,y`; `-1,-1` is pass. Board size is `5..22` for Rapfi (`START <n>`; `RECTSTART w,h` for rectangles).
- The existing bridge sends **whole positions, not incremental moves** (`{"type":"search", "size", "toMove", "stones":[{x,y,c}], "last"}`) so one side stays the source of truth; replies are `info` / exactly one `move` per accepted search id / `log` / `error`. Reuse that shape where it fits.
- Rules/variants beyond freestyle (walls, portals, torus, rect boards, Renju, Caro) are Rapfi-specific `INFO ...` extensions, not part of plain Gomocup. Decide explicitly which rule set the tournament supports; plain Gomocup engines will not understand the extensions.

## Architecture (as built)

The key constraint that spans several files: **a web server cannot launch or reach an engine on a player's machine, and browsers cannot spawn processes.** Each player therefore runs a small *local agent* that spawns their engine and dials **out** to the server over WebSocket (the inverse of `extension_vncaro`, where the bridge is the local *server*). Reuse its `EngineAdapter`/`Session` design for the agent side.

```
Player A: engine <-stdio-> local agent --ws--\
                                              server (lobby, tournament, game referee, history) <--ws/http--> browser UI (board)
Player B: engine <-stdio-> local agent --ws--/
```

- The server is the referee: it owns the authoritative board, move clock and result, relays positions to each agent, and validates the returned move (empty cell, in range, turn order). It must detect five-in-a-row itself, because `GomokuBoardSite` deliberately has no win detection and cannot be reused for that.
- Agents are untrusted: never rely on an engine's claimed result or time.

## Conventions to follow

- **Docs layout** follows `HTML/extension_vncaro/docs/` (chosen from the three offered models; it is the smallest and matches the ports/adapters design): `docs/adr/`, `docs/todo/` (+ `DONE.md`), `docs/fix-log.md`, `docs/knowledge/INDEX.md`, `docs/notes/`, `docs/templates/`. Copy templates from there rather than inventing formats. Change the model only if the user says so.
- **SKILLS_TREE** (`/run/media/ngmint/Data/Programming/Programming/SKILLS/SKILLS_TREE`) is the shared skill/rule library. Query it with `tools/find "<need>"` (never `python3`, never browse or grep it), and copy chosen items into this repo's `.claude/` as `GomokuBoardSite` did (`.claude/skills/`, `.claude/knowledge/`). Delegate multi-query searches or copies to an Agent.
- Match the stack of the reference you are extending: the board front end stays dependency-free classic scripts like `GomokuBoardSite` unless the user chooses otherwise; the Python bridge code uses `websockets` as its only dependency. Confirm the server language with the user before scaffolding.
- User-visible strings: Vietnamese default, English second, as in `GomokuBoardSite`.
