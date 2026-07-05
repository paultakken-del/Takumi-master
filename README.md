# Takumi Master 匠 — Cloudflare Pages

Persoonlijk AI-adviesplatform op takumi-master.com

## Structuur

```
takumi-master/
├── index.html                        ← volledige app
├── functions/
│   └── api/
│       └── claude.js                 ← Anthropic Claude proxy (SSE)
├── _headers                          ← security headers
└── README.md
```

Cloudflare Pages serveert `index.html` automatisch als homepage.
De `functions/api/` map wordt automatisch omgezet naar Workers op `/api/*`.

---

## Deploy — stap voor stap

### 1. GitHub repo aanmaken

1. Ga naar github.com → **New repository**
2. Naam: `takumi-master` → **Create repository**
3. Upload alle bestanden (index.html, functions/, _headers, README.md)

### 2. Cloudflare Pages koppelen

1. Ga naar [dash.cloudflare.com](https://dash.cloudflare.com)
2. Links in het menu: **Workers & Pages**
3. Klik **Create application** → tabblad **Pages**
4. Klik **Connect to Git** → selecteer je GitHub repo `takumi-master`
5. Build settings:
   - **Framework preset**: `None`
   - **Build command**: *(leeg laten)*
   - **Build output directory**: `/` of leeg
6. Klik **Save and Deploy**

### 3. Environment Variables instellen

1. Ga naar je Pages project → **Settings** → **Environment variables**
2. Klik **Add variable**:

| Variable name | Value | Omgeving |
|---|---|---|
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Production + Preview |

3. Klik **Save**
4. Ga naar **Deployments** → klik **Retry deployment**

### 4. Eigen domein koppelen (takumi-master.com)

1. Ga naar je Pages project → **Custom domains**
2. Klik **Set up a custom domain**
3. Vul in: `takumi-master.com`
4. Klik **Continue** → Cloudflare configureert DNS automatisch
   (werkt direct omdat je domein al bij Cloudflare staat!)
5. Ook `www.takumi-master.com` toevoegen als alias

Na ~1 minuut is `https://takumi-master.com` live. ✓

---


## Lokaal testen

```bash
# Installeer Cloudflare's lokale dev tool
npm install -g wrangler

# Start lokale server
npx wrangler pages dev . --compatibility-date=2024-01-01

# → http://localhost:8788
```

Maak `.dev.vars` aan voor lokale environment variables:
```
ANTHROPIC_API_KEY=sk-ant-...
```

---
