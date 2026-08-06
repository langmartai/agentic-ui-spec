# AUIS — Reference Architecture (langmart.ai)

How the abstract roles in [SPEC.md](SPEC.md) map onto the langmart.ai deployment. The spec
is normative and technology-free; this document is one conforming realization, described
at the architecture level.

## Role → component mapping

| AUIS role (SPEC.md §1) | Realized by |
|---|---|
| **Identity Provider** (SSO / OAuth) | **langmart.ai** — the platform's OIDC/SSO service |
| **Hub** (internet-facing relay + routing) | **langmart.ai** — the platform's hub/relay layer |
| **Hub web tier** (internet-facing UI edge) | **langmart.ai** — the platform's assist web tier |
| **Serving Gateway + Registry** | **langmart.ai** — the platform's UI gateway |
| **Data Source** (platform) | **langmart.ai** — the platform API |
| **Web-app implementation** (routed to the internet *through* the Hub) | **[lm-assist](https://github.com/langmartai/lm-assist)** — its web app |
| **Local Authentication** (LAN OIDC public client) | **lm-assist** — its LAN login |
| **Data Source** (node) | **lm-assist** — its node's local API |

**The division of responsibility:** SSO/OAuth and the hub internet-routing both reside on
the **langmart.ai platform** (Identity Provider, Hub, hub web tier, UI gateway).
**lm-assist is a web-app implementation** that is routed to the public internet *through*
that hub — a consumer of the Hub and Identity Provider, not the hub itself. lm-assist
additionally implements Local Authentication and hosts a node Data Source.

## Who lives where

```mermaid
flowchart TB
  subgraph LM["langmart.ai platform (public-internet side)"]
    direction TB
    IDP["OIDC / SSO service<br/><b>role: Identity Provider</b>"]
    UIGW["UI gateway<br/><b>role: Serving Gateway</b> + Registry"]
    HUB["Hub / relay layer<br/><b>role: Hub</b> (internet routing)"]
    AWEB["Assist web tier<br/><b>role: Hub web tier</b>"]
    PAPI["Platform API<br/><b>role: Data Source</b> (platform)"]
  end

  subgraph LA["lm-assist (worker / local side)"]
    direction TB
    LWEB["lm-assist web app<br/><b>impl: web app routed via the Hub</b>"]
    LLOGIN["LAN OIDC public client<br/><b>role: Local Authentication</b>"]
    NODE["Node local API<br/><b>role: Data Source</b> (node)"]
  end

  BROW["Public browser"]

  BROW --> AWEB
  BROW --> UIGW
  AWEB -->|"OIDC login"| IDP
  UIGW -->|"OIDC login (+ optional credential elevation)"| IDP
  AWEB -->|"relay"| HUB
  UIGW -->|"relay"| HUB
  HUB -->|"reverse-dial channel (worker dials out)"| NODE
  UIGW -->|"per-user credential (optional)"| PAPI
  LWEB -.->|"served to the internet THROUGH"| HUB
  LWEB --> LLOGIN
  LLOGIN -->|"public PKCE client"| IDP
```

## Login + data flow (platform scope, credential provisioning ON)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (UI page)
  participant SG as UI gateway (Serving Gateway)
  participant IDP as langmart.ai OIDC (Identity Provider)
  participant P as Platform API (Data Source)

  B->>SG: load UI (no session)
  SG->>IDP: 302 authorize (code + PKCE)
  IDP-->>SG: id_token (confidential RP)
  Note over SG,IDP: OPTIONAL: elevate id_token → per-user,<br/>session-scoped API credential (trusted client;<br/>server-side only; off by default — SPEC §3.4)
  SG-->>B: serve UI + inject short-lived, grant-bearing view token
  B->>SG: data call (Bearer view token, service + path)
  SG->>SG: verify token + aud → scope ∋ service → grant allows
  SG->>P: forward with the viewer's credential
  P-->>SG: 200 — authorized AS THE VIEWER
  SG-->>B: 200 passthrough
```

## Hub-relayed flow (node scope: internet edge → worker node)

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser (UI page)
  participant SG as UI gateway (Serving Gateway)
  participant HUB as langmart.ai Hub
  participant N as lm-assist node (Data Source)

  B->>SG: data call (Bearer view token, service + path)
  SG->>SG: verify token + aud → scope ∋ service → grant allows
  SG->>HUB: relay request (authenticated intake, fail-closed — SPEC §7.1)
  Note over HUB: routes on the asserted subject only (SPEC §7.2)
  HUB->>N: forward over the worker's reverse-dial channel,<br/>carrying the viewer's identity (SPEC §7.3)
  N-->>HUB: response
  HUB-->>SG: response
  SG-->>B: passthrough
```

## Notes

- **Internet exposure of lm-assist:** the lm-assist web app and node live on a worker/LAN;
  they reach the public internet **only through the langmart.ai hub** (SPEC §7.4 — the Hub
  is the scope's internet-facing part, not a separate scope).
- **Two authentication surfaces, one IdP:** the platform's internet-facing web tiers are
  confidential OIDC relying parties; lm-assist's LAN login is a public PKCE client. Both
  authenticate against the same langmart.ai identity (SPEC §3.2).
- **Access tiers:** pure OIDC identity is the baseline; per-user backend credential
  provisioning is opt-in and off by default (SPEC §3.4, §6.0).
