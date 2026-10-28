# ADR 0001 — Server-side referee and outbound local agent

Status: accepted (2026-10-28)

## Context
Two people on different machines each want to run their own Gomoku/Caro engine against the other's, with a public
website organising the match. A browser cannot spawn processes and a public server cannot reach an engine on a
player's machine. `GomokuBoardSite` (the board UI) deliberately has no win detection, and `extension_vncaro`'s bridge is a
localhost *server* for one user, so neither can be reused as the referee or the connection model.

## Options
- A. Players run a local HTTP/WS server (like `extension_vncaro`) and the site calls it from the browser: needs open
  ports or tunnels on every player's machine, and the browser would be the trusted party.
- B. A small local agent per player dials **out** to the site over WebSocket; the site is the referee. (chosen)
- C. Upload engines to the server: untrusted native code on the host, rejected.

## Decision
- `server/` (Node.js, `ws`, `better-sqlite3`) owns the authoritative board, clocks, schedule and results. Its modules are pure
  where possible (`rules`, `game`, `clock`, `schedule`, `match`) and driven by an injected clock, so they are tested with a fake clock.
- `agent/` (`engine-agent` CLI) spawns the engine over stdio, classifies it (`ABOUT`), applies the room's configuration command
  by command, and answers each `go` with exactly one move. It speaks to the engine through an adapter (`rapfi`, `gomocup`)
  and a strict one-search-at-a-time state machine (`SearchSession`): after `STOP` it waits for the single move line the engine owes
  before issuing the next command, and restarts a hung engine after a grace period.
- The server trusts nothing from an agent: it validates every move against its own board, measures time itself (latency is the
  player's cost), caps message size and rate, and refuses engines it cannot classify.
- Win detection is re-implemented in `server/src/rules.js` for Freestyle (5+), Standard (exactly 5) and Free Caro (6+, or exactly 5
  unless both neighbours are opponent stones; the board edge does not block), and cross-checked against a real Rapfi by
  `server/test/oracle.test.js` (`RAPFI_ENGINE=… npm test`).
- Tokens are `<roomId>.<secret>` (192-bit secret, stored hashed), so the agent needs only the token and a URL.

## Consequences
- Players install and run a Node CLI; in return no inbound ports are needed on their side.
- The server must be reachable over WSS when public (see `docs/deploy.md`).
- A search answer that arrives *after* the next search began cannot be told apart from its answer; real engines do not do this and
  the strict state machine removes the legitimate cases (stopped searches).
- Rule variants beyond the three supported (walls, portals, Renju, swap openings) are out of scope; adding one means a new
  `rules.js` branch, a `RULES` id and an oracle case.
