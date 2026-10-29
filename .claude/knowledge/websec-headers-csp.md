---
name: websec-headers-csp
description: The HTTP response headers and cookie attributes that harden a web app (HSTS, CSP, nosniff, framing, referrer, permissions, cross-origin isolation, cookies) with recommended values and a safe CSP rollout
domain: web-development
tags: security-headers,csp,hsts,cookies,samesite,httponly,clickjacking,nosniff
apply_when: "configuring a server, CDN or framework for security headers; writing or tightening a Content Security Policy; reviewing cookie settings; a scanner flags missing headers"
sources: "OWASP HTTP Headers Cheat Sheet (read; re-verified 2026-09-26: baseline header values, obsolete headers); OWASP Content Security Policy Cheat Sheet (read); MDN - Strict-Transport-Security (read); MDN - Using HTTP cookies (read)"
last_reviewed: 2026-09-26
confidence: medium
---

# Security headers, CSP and cookies

Headers are a cheap **second layer**; they do not replace secure coding such as output encoding and input validation (`appsec-xss-csrf`, `appsec-input-validation-injection`). Verify values against the current OWASP and MDN pages; recommendations change.

## Recommended baseline (OWASP HTTP Headers)

| Header | Value | Purpose |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` (start smaller, see `webops-domains-dns-tls`) | force HTTPS |
| `X-Content-Type-Options` | `nosniff` | stop MIME sniffing |
| `Content-Security-Policy` | see below | limit script and resource sources, framing |
| `X-Frame-Options` | `DENY` (or CSP `frame-ancestors`) | clickjacking |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | limit referrer leakage |
| `Permissions-Policy` | disable unused features, e.g. `geolocation=(), camera=(), microphone=()` | restrict browser features |
| `Cross-Origin-Opener-Policy` | `same-origin` | isolate browsing context |
| `Cross-Origin-Resource-Policy` | `same-site` or `same-origin` | limit who may load your resources |
| `Cache-Control` | `no-store` on sensitive responses | avoid caching private data (`perf-http-caching-cdn`) |

`Cross-Origin-Embedder-Policy: require-corp` is listed too, but it breaks embeds that do not opt in; enable it only if you need cross-origin isolation. **Remove** `Server` and `X-Powered-By` version detail. `X-XSS-Protection` is obsolete (CSP replaces it), as are `Expect-CT` and HPKP.

## Content Security Policy

- Prefer a **strict CSP** using per-response random **nonces** or hashes (plus `'strict-dynamic'`) over domain allowlists. Allowlists are easy to bypass through compromised subdomains, JSONP endpoints or shared hosts.
- Never ship `'unsafe-inline'` for scripts in production; it defeats XSS protection.
- Add `object-src 'none'`, `base-uri 'none'` (or `'self'`), and `frame-ancestors` to control who may embed you.
- **Roll out with `Content-Security-Policy-Report-Only`** first, collect reports (`report-to`, with `report-uri` as fallback for older browsers), fix violations, then enforce.
- Third-party tags (analytics, chat, ads) are the usual cause of breakage; each one extends your trust boundary (`supply-dependencies-sbom`).
- Nonces must be generated per response, so fully static, cached HTML needs hashes instead.

## Cookies (MDN)

- `Secure`: HTTPS only. `HttpOnly`: not readable by JavaScript; use for session cookies.
- `SameSite`: `Strict` (same-site requests only), `Lax` (default in modern browsers; sent on top-level navigations), `None` (cross-site; requires `Secure`).
- Prefer the `__Host-` prefix for session cookies: requires `Secure`, `Path=/` and no `Domain`, so subdomains cannot overwrite it.
- Keep lifetimes short (`Max-Age`); `Path` is not a security boundary.
- Cookie details for sessions: `authn-sessions-cookies`. CSRF interplay: `appsec-xss-csrf`.
- Third-party cookies are blocked or restricted in modern browsers; do not build features that depend on them.

## Use when

- Any site with logins, forms or third-party scripts; part of the security check in `lifecycle-launch-readiness`.

## Do not use when

- Do not copy a header block without understanding each line; `COEP`, `preload` and a strict CSP can break sites.
- Headers do not fix an application that reflects unescaped input.

## Trade-offs

- Strict CSP with nonces needs server-side templating support and a build discipline; it gives real XSS protection.
- `SameSite=Strict` is safest and breaks inbound-link login continuity; `Lax` is the usual compromise.

## Common mistakes

- CSP with `unsafe-inline` and a wildcard, giving a false sense of security.
- Setting headers only on HTML and not on API or static responses.
- Different headers on staging and production, so problems appear after launch.
- Sending HSTS over HTTP (ignored).
- Session cookie without `HttpOnly` or `Secure`.

## Related

- Notes: `websec-cors`, `websec-map`, `webops-domains-dns-tls`, `appsec-xss-csrf`, `authn-sessions-cookies`, `be-auth-integration`, `appsec-secure-by-default`
