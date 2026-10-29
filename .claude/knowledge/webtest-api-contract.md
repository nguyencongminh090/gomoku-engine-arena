---
name: webtest-api-contract
description: Keeping a web frontend and its backend API in agreement - schema-first descriptions (OpenAPI), API integration tests, and consumer-driven contract tests - and when each is worth the cost
domain: web-development
tags: api-testing,contract-testing,openapi,pact,integration-tests,schema
apply_when: "frontend and backend are built by different people or teams; an API change broke the client in production; choosing between an OpenAPI schema check and consumer-driven contracts; testing an API without a browser"
sources: "Pact documentation - contract testing (read); OpenAPI Specification (read, intro only); Ham Vocke - The Practical Test Pyramid (read)"
last_reviewed: 2026-09-26
confidence: medium
---

# API and contract tests

## Three tools, different jobs

| Tool | What it proves | Cost |
|---|---|---|
| **API integration test** | the API, with its real database and framework, returns the right status, body and side effects for a request | one service; no browser; fast enough for every commit |
| **Schema-first description** (OpenAPI) | a machine-readable description of **all possible** requests and responses; can generate docs, clients, mocks and validators | keep the description and the code in sync |
| **Consumer-driven contract** (for example Pact) | the provider still satisfies what each consumer **actually uses**, checked with concrete examples | tooling plus process across teams |

OpenAPI describes all possible states; Pact tests concrete examples a consumer relies on. They complement each other: the schema states the intended interface, the contract detects breakage that matters to a real client.

## Consumer-driven flow (Pact docs)

1. The consumer's tests run against a mock provider and record the requests and responses they need: the **contract**.
2. The provider replays the contract against its real implementation in its own pipeline.
3. A broker stores contracts and verification results, so a team can check whether a version is safe to deploy.

Because only used behavior is pinned, the provider may change unused parts freely. This suits many independently deployed consumers; it prevents "version hell" without a full integrated environment.

## Web-specific guidance

- **Same team, one repo, one deploy**: API integration tests plus a few E2E journeys are usually enough; contract tools may be overkill (common practice, not in the sources).
- **Generate types or validators from the schema** (OpenAPI to client types) so drift becomes a compile or CI error.
- **Test error paths and the error format** (`be-http-semantics`), auth failures, pagination edges and validation, not only the happy path.
- **Run a compatibility check in CI** that flags breaking schema changes (removed field, changed type, new required input); follow additive-only evolution (`be-api-style-for-web`, `dist-api-design`).
- Mobile apps and old cached frontends mean several client versions exist at once; contract or compatibility tests protect them.

## Use when

- Several clients or teams depend on one API, or the frontend is deployed independently.

## Do not use when

- A single small app with one deployable unit: an integration suite is cheaper than a broker.
- Do not use contract tests to check business logic; they check the interface only.

## Trade-offs

- Consumer contracts catch real breakage but need discipline and a broker; schemas are lighter but can describe more than clients use, or be out of date.
- Provider-only checks do not confirm that consumers call the API correctly.

## Common mistakes

- Handwritten API docs that drift from behavior.
- Mocks in frontend tests invented by hand rather than derived from the schema or contract.
- Testing only 200 responses.
- Treating a new required request field as a non-breaking change.

## Related

- Notes: `webtest-strategy`, `webtest-e2e-browser`, `be-http-semantics`, `be-api-style-for-web`, `dist-api-design`, `appsec-api-security`
