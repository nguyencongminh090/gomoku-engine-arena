---
name: be-realtime
description: Choosing how a web app gets live updates - polling, server-sent events, WebSockets or WebTransport - with their limits, reconnection behavior and page-lifecycle effects
domain: web-development
tags: realtime,websocket,sse,polling,eventsource,push,notifications
apply_when: "a page must show live data (notifications, progress, chat, dashboards, collaboration); deciding between SSE and WebSockets; connections drop or pile up; back-forward cache does not work"
sources: "MDN - Using server-sent events (read); MDN - WebSockets API (read); GraphQL.org - subscriptions mentioned (read)"
last_reviewed: 2026-09-25
confidence: medium
---

# Real-time updates for web apps

## Options

| Option | Direction | Notes |
|---|---|---|
| Polling | client asks on a timer | simplest, works everywhere and over plain HTTP caching rules; wasteful when nothing changed |
| Server-sent events (SSE) | server to client only | `EventSource` API, `text/event-stream`, automatic reconnection, event `id` for resume, `retry` field, comment lines for keep-alive |
| WebSocket | two-way | for chat, games, collaborative editing; works in browsers broadly |
| WebTransport | streams and datagrams | MDN recommends it for new sophisticated needs (native backpressure); limited browser support at the time of MDN's page |

## SSE (MDN)

Use for one-way streams such as notifications, live scores, logs and job progress. The response must have
MIME type `text/event-stream` and each event ends with a blank line. `EventSource` reconnects
automatically unless you call `close()`. Over HTTP/1.1, browsers allow about 6 simultaneous connections per
domain (so many tabs can exhaust them); over HTTP/2 the negotiated stream limit defaults to about 100.
Cross-origin use needs the `withCredentials` option and CORS support on the server.

## WebSocket (MDN)

Two-way channel after an HTTP upgrade handshake. The classic `WebSocket` interface has **no backpressure**:
if messages arrive faster than the page processes them, memory or CPU can blow up. It has **no automatic
reconnect**, so you implement reconnection (with backoff), heartbeats, and message resume yourself. Open
sockets also prevent the browser's back-forward cache, so close them when the user leaves the page.

## Choosing

1. Is data only server to client? SSE is usually simpler (built-in reconnect, plain HTTP, works with existing auth).
2. Do you need low-latency two-way messages? WebSocket.
3. Updates are rare or a delay of tens of seconds is fine? Polling, possibly with conditional requests.
4. Is a managed service acceptable (a push or pub/sub provider)? It can take over connection scaling.

## Server-side considerations

These are common engineering practice rather than statements from the MDN pages read; confirm against your stack.

- Persistent connections use server resources (file descriptors, memory): capacity plan and load-balance with sticky or stateless design (`deploy-scaling-strategies`).
- Authenticate at connection time and re-check permissions per message or channel (`authz-broken-access-control`); validate every inbound message like any other input (`appsec-input-validation-injection`); check the `Origin` header on the handshake.
- Fan out through a shared broker when several server instances exist (`dist-messaging-patterns`).
- Handle reconnect storms after a deploy: jittered backoff on the client.
- Provide a fallback (polling) and show connection state in the UI.
- GraphQL subscriptions are one transport for pushes; the same considerations apply.

## Use when

- The user experience truly depends on data changing without a reload.

## Do not use when

- Do not use WebSockets where a periodic refresh is fine or where SSE covers a one-way stream.
- Do not rely on a persistent connection for delivery guarantees; keep the source of truth in the database and let clients re-sync on reconnect.

## Trade-offs

- Push gives freshness and adds connection state to scale, secure and monitor.
- SSE is simple and one-way; WebSocket is flexible and you own reconnection, framing and backpressure.

## Common mistakes

- Unbounded message queues on the client.
- No reconnect logic, or reconnect without backoff.
- Missing authorization checks after the initial handshake.
- Six tabs exhausting SSE connections on HTTP/1.1.

## Related

- Notes: `be-background-jobs`, `be-api-style-for-web`, `dist-communication-styles`,
  `dist-messaging-patterns`, `deploy-scaling-strategies`, `appsec-api-security`
