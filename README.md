# gomoku-engine-arena

A client-server website for **engine-vs-engine testing** (Gomoku / Caro, Gomocup-style engines).

- Exactly two players. Each runs a small local agent that spawns their engine and dials out to the server over WebSocket.
- The server is the referee: it owns the board, the move clock and the result, and validates every move.
- The web UI shows the live game.

## Quick start

Requires Node.js >= 20.

```sh
npm install
npm test
PORT=8080 npm start
node agent/bin/engine-agent.js --engine <path> --token <token> --server ws://host:8080/ws/agent
```

See `docs/deploy.md` for environment variables and `docs/adr/` for design decisions.

## License

MIT
