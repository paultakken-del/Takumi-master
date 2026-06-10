# Fase 2 — Productie-schuld (richting webinar september)

## 1. Auth-split (OAuth 2.1) — ONTWERP, nog niet gebouwd

Principe blijft: het **publieke kompas blijft open** (noorden, pulse, reflectie, weging op
aangeleverde coördinaten — niets persoonlijks wordt opgeslagen). Auth wordt pas nodig zodra
er een *persoonlijk* pad komt (opgeslagen wegingen, historie, eigen corpus).

Eisen uit de huidige MCP-spec (juni 2025-revisie):
- MCP-server = OAuth **Resource Server**; autorisatie hoort bij een aparte Authorization Server
- Tokens die niet voor déze server zijn uitgegeven MOETEN worden geweigerd (geen token-passthrough)
- HTTPS overal, redirect-URI-validatie, PKCE

Beslispunten voor Paul (één sessie, daarna bouwen):
- **A. Authorization Server:** `cloudflare/workers-oauth-provider` (zelf hosten, past op de
  bestaande CF-stack en KV) vs. een gehoste IdP. Advies: workers-oauth-provider — geen extra
  leverancier, en de bestaande Google-login (functions/auth/*) kan als identiteitsbron dienen.
- **B. Scope-ontwerp:** één scope `takumi:persoonlijk` is genoeg om mee te starten.
- **C. Wat wordt persoonlijk:** weging-historie server-side? Of blijft historie in de app
  (localStorage, zoals nu) en komt er alleen een persoonlijke corpus-laag?

Definition of done: ChatGPT/Claude doorlopen de OAuth-dance tegen app.takumi-master.com,
het publieke pad werkt ongewijzigd zonder token.

## 2. Cross-client bewijs (ChatGPT & Copilot Studio) — VEREIST PAULS ACCOUNTS

- **ChatGPT:** Settings → Connectors → Add custom connector → `https://app.takumi-master.com/mcp`
  (remote MCP, geen auth nodig zolang het kompas publiek is). Test: "lees het Takumi-kompas,
  oriëntatie pulse/morning, coördinaten beweging=rust agenda=vol".
- **Copilot Studio:** Agent → Tools → Model Context Protocol → zelfde URL, streamable HTTP.
- Bewijsdoel: één screenshot per client met het `weging`-veld in het antwoord → demoslide
  "drie agents, één oordeel".

## 3. Registry-publicatie

`server.json` staat klaar in de repo (namespace `io.github.paultakken-del/...` — werkt met
GitHub-auth, geen DNS-verificatie nodig). Publiceren:

```bash
brew install mcp-publisher   # of: ga naar github.com/modelcontextprotocol/registry/releases
cd Takumi-master
mcp-publisher login github   # opent browser, GitHub-login
mcp-publisher publish
```

Daarna vindbaar via registry.modelcontextprotocol.io en sub-registries (o.a. Smithery
synct van de officiële registry).

## Status

- [x] server.json klaar
- [ ] OAuth-beslispunten A/B/C → aparte sessie
- [ ] ChatGPT-connector getest (Paul)
- [ ] Copilot Studio getest (Paul)
- [ ] mcp-publisher publish uitgevoerd (Paul, 5 min)
