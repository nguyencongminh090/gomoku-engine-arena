# Deploy (public internet)

Agents send their token over the WebSocket, so a public server must be served over TLS (WSS). Two options:

1. **Reverse proxy (recommended).** Run `PORT=8080 TRUST_PROXY=1 npm start` bound to localhost and let nginx/Caddy terminate TLS.
   The proxy must forward WebSocket upgrades (`Upgrade`/`Connection` headers) for `/ws/` and set `X-Forwarded-For`
   (the per-IP room limit uses it only when `TRUST_PROXY=1`; never set it when the server is directly reachable).
   Caddy: `example.com { reverse_proxy 127.0.0.1:8080 }` handles both.
2. **Built-in TLS.** `TLS_KEY=/path/key.pem TLS_CERT=/path/cert.pem HOST=0.0.0.0 PORT=443 npm start`.

Agents then connect with `--server wss://example.com/ws/agent`.

Environment: `PORT` (8080), `HOST` (127.0.0.1), `DB_PATH` (testsite.sqlite), `TRUST_PROXY`, `TLS_KEY`, `TLS_CERT`.
