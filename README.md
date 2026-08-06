# Agentic UI Specification (AUIS)

**A vendor-neutral specification for serving agent-generatable web UIs that are
authenticated against a SaaS identity and given narrow, per-viewer access to backend
APIs — without ever handing the browser a durable credential.**

Modern applications increasingly want to *generate* a UI on demand (often with an LLM/
agent) and serve it to a user. The moment a UI is generated rather than hand-reviewed, it
is untrusted code — and serving untrusted code with ambient access to a user's backend is
a security problem, not a feature. AUIS defines the roles and contracts that make it safe:
one identity layer, scoped registries, short-lived capability tokens, and a data plane
where a page can act only within its declared grant and only as the viewer.

📄 **[Read the specification → SPEC.md](SPEC.md)** (AUIS v0.1, RFC 2119 language)

## What it covers

- **Authentication** — OIDC + PKCE, in **two exposure classes**: internet-facing
  (confidential relying party) and local/LAN (public, secret-less client). Identity is
  global; authority is scoped. An OIDC token can prove who you are but is structurally
  incapable of *being* a backend API credential.
- **Registry** — each scope catalogs its UIs with an owner, an access mode, and a
  capability **grant**. The scope→services binding is a structural wall enforced at
  registration.
- **Credentials & backend/data access** — three credentials with one direction of trust:
  the browser holds only a short-lived, grant-bearing **view token**; the per-user backend
  credential stays server-side; data is authorized *as the viewer*, and the grant is a
  ceiling over the backend's own authorization, never a bypass.
- **Hub routing** — how an internet-facing relay carries requests to backends that dial
  out to it, fail-closed, subject-routed, forwarding the viewer's identity.
- **Authoring contract** — the minimal, safe surface a UI (or a UI generator) may target.

## Design stance

- **Roles, not technologies.** Any stack that meets the MUSTs conforms. Conformance is
  claimed per role (Identity Provider, Serving Gateway, Registry, Data Source, Hub).
- **Honest degradation over silent gaps.** Where a backend cannot yet authorize per-viewer,
  the spec requires the implementation to treat those UIs as owner-scoped and record the
  gap in a conformance ledger — never to present unenforced per-viewer access as if
  enforced.

## Implementations

AUIS is extracted from a working system. See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the
reference deployment, with diagrams.

- **[langmart.ai](https://langmart.ai)** — implements the **Identity Provider** (SSO/OAuth),
  the **Hub** (internet-facing relay and routing) and its web tier, and the **Serving
  Gateway + Registry**; its platform API is a Data Source.
- **[lm-assist](https://github.com/langmartai/lm-assist)** — a **web-app implementation**
  that is routed to the public internet *through* the langmart.ai hub. It implements
  **Local Authentication** (LAN public-client login), and its node is a Data Source.
  lm-assist follows this specification; it is not the specification.

If you implement AUIS, open a PR adding your project here.

## Status

v0.1 draft — open to issues and proposals. Versioned by the `AUIS vX.Y` line at the top
of `SPEC.md`.

## License

Specification text licensed under [Apache License 2.0](LICENSE) — implement freely, with a
patent grant to implementers.
