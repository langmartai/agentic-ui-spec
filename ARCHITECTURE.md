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
  Note over SG,IDP: OPTIONAL — elevate id_token into a per-user,<br/>session-scoped API credential. Trusted client only,<br/>server-side only, off by default (SPEC 3.4)
  SG-->>B: serve UI + inject short-lived, grant-bearing view token
  B->>SG: data call (Bearer view token, service + path)
  SG->>SG: verify token + aud → scope ∋ service → grant allows
  SG->>P: forward with the viewer's credential
  P-->>SG: 200 — authorized AS THE VIEWER
  SG-->>B: 200 passthrough
```

## The two access tiers (what "optional" means in practice)

Baseline is **pure OIDC identity**. API-key-based backend access is an **opt-in add-on**
(SPEC §3.4, §6.0) — enable it only for scopes whose Data Source requires an API credential.

```mermaid
flowchart TB
  L["Viewer completes OIDC login"]
  Q{"Backend credential<br/>provisioning enabled?"}

  subgraph T1["Tier 1 — identity-only (DEFAULT)"]
    direction TB
    A1["No API key is ever minted"]
    A2["UI is served, viewer identity known"]
    A3["Data Sources reachable via<br/>hub-relayed identity"]
    A4["Calls needing an API credential<br/>are refused, with a reason"]
  end

  subgraph T2["Tier 2 — API-key backend access (OPT-IN)"]
    direction TB
    B1["Trusted client exchanges id_token<br/>for a per-user, session-scoped API key"]
    B2["Key stored server-side only —<br/>never in the browser, page, or logs"]
    B3["Data calls forwarded with the<br/>viewer's own API key"]
    B4["Data Source re-authorizes per user.<br/>The grant is a ceiling, not a bypass"]
  end

  L --> Q
  Q -->|"no (default)"| T1
  Q -->|"yes"| T2
  A1 --> A2 --> A3 --> A4
  B1 --> B2 --> B3 --> B4
```

Both tiers keep the same invariant: the browser holds only the short-lived, grant-bearing
view token. Tier 2 adds a server-side credential, never a browser-side one.

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

## Worker-hosted UI serving — who holds the WebSocket (SPEC §7.5)

The flow above is the *data plane*. A worker-hosted UI's **page files** travel the same
channel: they live on the author's machine and are relayed per-request — the gateway
stores nothing. The key structural fact is *who owns the hub connection*:

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant SG as UI gateway (Serving Gateway)
  participant HUB as langmart.ai Hub
  participant AG as Host agent (lm-assist Core)
  participant LS as UI server (lmui, loopback)

  Note over AG: ONE authenticated reverse WebSocket per HOST,<br/>held by the agent — never by the UI server
  B->>SG: GET / (session cookie)
  SG->>SG: owner check → this UI's registry entry names its host (workerId)
  SG->>HUB: fetch /ui-<uiId>/index.html for that host
  HUB->>AG: forward over the host's reverse-dial channel
  AG->>LS: HTTP to 127.0.0.1:<port> (declared /ui-* service route)
  LS-->>AG: file from the author's disk
  AG-->>HUB: response (inner status preserved)
  HUB-->>SG: response
  SG->>SG: inject view token (document requests only)
  SG-->>B: the page — served from the author's machine
```

Properties this topology fixes (SPEC §7.5):

- **Credentials scale with hosts, not UIs.** The agent authenticated once; every UI on
  that host rides the same channel. No per-UI secret exists to provision, rotate, or leak.
- **The UI server is credential-free.** `lmui` is a plain loopback HTTP server anyone can
  run or copy — consistent with §8's rule that the authoring side never holds a secret.
- **Honest failure.** The relay wraps the host's real status; the gateway must check it —
  a host-side 404 must surface as an unreachable-host error, never be rendered *as* the
  page.
- **Host off ⇒ UI off.** Availability belongs to the author. The gateway keeps no copy to
  fall back to, by design.

## Origins and the trust boundary (SPEC §5.3)

Three classes of served content sit on deliberately different origins:

```mermaid
flowchart TB
  subgraph O1["Platform origin — credential-bearing"]
    DASH["Dashboard + platform UIs<br/>holds session cookie + API keys"]
    WRK["Trusted worker apps (/w/*)<br/>the user's OWN code — same-origin ACCEPTED"]
  end
  subgraph O2["Dedicated UI origin — NO ambient credential"]
    GEN["Generic / pluggable / generated UIs<br/>only credential reachable = short-lived view token"]
  end
  DASH -.->|"embeds"| GEN
  note["Untrusted or generated UIs live ONLY on O2.\nThey can never reach O1's cookie or localStorage."]
```

- **Platform origin** carries the viewer's session cookie and saved API keys. The dashboard
  and **trusted worker apps** (`/w/*`, the user's own code) live here; same-origin is an
  accepted trust decision, not a defect (SPEC §5.3, first bullet).
- **Dedicated UI origin** (a distinct subdomain, e.g. a `ui.`-prefixed host) serves the
  **generic / pluggable / generated** UIs and holds *no* ambient platform credential. On
  this origin the only credential a page can reach is its short-lived, grant-bearing view
  token, so even fully untrusted (agent-generated) UIs cannot exfiltrate account
  credentials. This is where the pluggable-UI framework's generated UIs are served.

## Notes

- **Internet exposure of lm-assist:** the lm-assist web app and node live on a worker/LAN;
  they reach the public internet **only through the langmart.ai hub** (SPEC §7.4 — the Hub
  is the scope's internet-facing part, not a separate scope).
- **Two authentication surfaces, one IdP:** the platform's internet-facing web tiers are
  confidential OIDC relying parties; lm-assist's LAN login is a public PKCE client. Both
  authenticate against the same langmart.ai identity (SPEC §3.2).
- **Access tiers:** pure OIDC identity is the baseline; per-user backend credential
  provisioning is opt-in and off by default (SPEC §3.4, §6.0).
