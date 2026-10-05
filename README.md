# Grateful Solutions — Logistics Command Center

Production version of the "GS Dashboard" prototype: React + TypeScript web app, Node.js + TypeScript API, PostgreSQL.
Every number, table row and chart is read from PostgreSQL through the API — nothing is hard-coded in the browser.

```
apps/web         React 18 · Vite · React Router · TanStack Query · React Hook Form + Zod
apps/api         Node 20 · Express 5 · Drizzle ORM · Zod · JWT (access + httpOnly refresh cookie) · pino
packages/shared  Zod schemas, enums, permissions and the accounting / cut-stock formulas used by both
```

**Status: Phase 2 (foundation) complete.** Database, seed, auth, roles, layout and routing are real.
Pages show a "Built in Phase N" card until their phase lands — see [Roadmap](#roadmap).

---

## Requirements

| Tool | Version | Windows install |
|---|---|---|
| Node.js | 20.12 or newer (22 LTS recommended) | https://nodejs.org |
| pnpm | 9 | `corepack enable` then `corepack prepare pnpm@9.12.0 --activate` |
| Docker Desktop | any recent | https://www.docker.com/products/docker-desktop |

All commands below work the same in **PowerShell**, Command Prompt, macOS and Linux unless marked.

---

## Option A — run everything in Docker (closest to production)

```powershell
Copy-Item .env.example .env          # macOS/Linux: cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JWT_ACCESS_SECRET and SEED_DEFAULT_PASSWORD
docker compose up -d --build         # postgres + api + web; the API applies migrations on start
pnpm docker:seed                     # load the demo dataset (or: docker compose exec api node dist/db/seed/index.js --force)
```

Open **http://localhost:8080** and sign in (see [Demo accounts](#demo-accounts)).
API docs: http://localhost:8080/api/docs

Useful:
```powershell
docker compose logs -f api           # API logs
docker compose down                  # stop (data is kept in the pgdata volume)
docker compose down -v               # stop AND delete the database + uploaded files
```

## Option B — develop locally (hot reload)

```powershell
Copy-Item .env.example .env          # then edit the secrets as above
pnpm install
docker compose up -d postgres        # only the database runs in Docker
pnpm db:migrate
pnpm db:seed
pnpm dev                             # API on :4000, web on :5173
```

Open **http://localhost:5173**. Vite forwards `/api` to the API, so the browser sees one origin (no CORS, cookies just work).

> Port 5432 already used by a local PostgreSQL? Set `POSTGRES_PORT=5433` in `.env` and change the port in `DATABASE_URL` / `DATABASE_URL_TEST` to match.

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | API (watch mode) + web (Vite) together |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | **Wipe** and reload the demo dataset |
| `pnpm db:reset` | Drop everything, migrate, seed |
| `pnpm db:generate` | After editing `apps/api/src/db/schema/*`, create a new SQL migration |
| `pnpm db:studio` | Browse the database in Drizzle Studio |
| `pnpm test` | All unit + integration tests (needs the Docker postgres running) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Quality checks |
| `pnpm build` | Production builds of every package |

---

## Demo accounts

`pnpm db:seed` creates one user per role. The password for all of them is the `SEED_DEFAULT_PASSWORD` value in your `.env`.

| Email | Role | Can |
|---|---|---|
| admin@gs.local | Admin | everything, incl. staff, roles and settings |
| aden.whitfield@gs.local | Manager | everything except staff/role and settings changes; can approve cut-stock overrides |
| marcus.ellery@gs.local | Accountant | accounting and quotations; read operations |
| sokha.chan@gs.local | Operator | shipments, clients, cut stock, documents, follow-ups; no accounting |
| dara.kim@gs.local | Viewer | read-only |

The full permission matrix is in `packages/shared/src/permissions.ts`.

## What the seed loads

Deterministic (same result every run), dated around the real current date so statuses look live:

- 4 clients (JR Apparel Corp, Jin Yuan Xi Ltd, Sportline Garments, VFL APPAREL) with codes JR / JYX / SAK / VFL and commission settings (JR $0, others $50)
- 10 customs ports from the accounting engine's directory (SHV11, PNH01 KTI, PNH21 O'Lair…), 7 forwarders (Maersk, FWF, Hippo, …), 25 countries
- **262 shipments** across 2026 (peak in June), 195 containers, 386 cargo invoices with 1,392 lines
- 225 customs declarations, each with a monthly-ledger row computed by the shared accounting formulas (≈ 5 % are loss-making)
- **195 cut-stock items read directly from `JR CDC MASTER LIST.xlsx`** (`apps/api/src/db/seed/data/`), including the 10 items that are already over-imported in the spreadsheet; a few 2026 declarations draw them down further
- 8 quotation templates extracted from `quotation-system.html`, 10 follow-ups, monthly USD→KHR rates

---

## How it is built

### Data model
37 tables (`apps/api/src/db/schema/`), migrations in `apps/api/drizzle/`. Highlights:

- **Shipments** split freight into `transport_mode` (SEA/AIR/ROAD/RAIL) and `load_type` (FCL = CY/CY, LCL, NONE). The Key Accounts CY/CY · LCL · AIR columns are derived from these.
- **Customs declarations** are their own table (a shipment can have several). Each declaration has at most one **accounting record** (the Chea payment / monthly ledger row) and any number of **CDC lines**.
- **Cut-stock balance** is never stored: the `cut_stock_balances` view computes imported qty, balance, balance % and OK/CHECK (CHECK below 50 %) exactly like the spreadsheet.
- **Over-import rule** is enforced twice: by the API (Phase 3) and by a database trigger that locks the item row and rejects any CDC line that would push the balance below zero unless it carries an override reason + approving user.
- Money is `NUMERIC(14,2)`, unit prices `NUMERIC(14,4)`, quantities/weights/CBM `NUMERIC(14,3)`, KHR `NUMERIC(16,0)`. Calendar dates are `date`; event times are `timestamptz`.
- `fob_amount` on cargo invoice lines is a PostgreSQL generated column (`round(pcs × fob_unit_price, 2)`).
- `audit_log` records who changed what (before/after JSON), logins, failed logins and token reuse.

### Accounting formulas (`packages/shared/src/accounting.ts`)
Ported from `accounting-engine.html` and unit-tested against the two real declarations in the prototype:

```
VAT          = 10 % × INV revenue                      (pass-through, NOT in profit)
Net profit   = (INV revenue + DIS + DN total) − (clear fee + THC + CM + other pay)
CM           = client's commission setting             (prototype rule: JR $0, others $50)
Invoice date = next business day after the declaration date (Sat/Sun → Mon)
KHR          = USD × exchange rate stored on the document, rounded to whole riel
```

All arithmetic is done in integer cents / BigInt fixed point — no floating-point drift in stored totals.

### Auth & security
- Login returns a 15-minute access token (kept in memory in the browser, never in localStorage) and sets a 14-day refresh token as an **httpOnly, SameSite=Strict cookie scoped to `/api/v1/auth`**.
- Refresh tokens are stored hashed and rotate on every use. Re-using an old one revokes the whole session family (theft detection).
- Role permissions are checked by API middleware on every protected route; the web app uses the same list to hide what a role can't use.
- helmet headers, rate limits (600 req/min per IP; 10 failed logins per 15 min per IP+email), request IDs, redacted pino logs, strict CSP from nginx.

### Look and feel
The prototype's stylesheet is ported unchanged (`apps/web/src/styles/prototype.css`), with tokens in `tokens.css` and the bundled Helvetica faces in `fonts.css`. Components reuse the prototype's class names (`.sidebar`, `.menu-item`, `.card`, `.status-tag`, …), so screens match pixel-for-pixel. New, page-specific styles go in CSS Modules.

Changes from the prototype shell: Cut Stock and Quotations were added to the sidebar; "Ask AI" and "Help" were removed from the top bar (no feature behind them); the bell shows **overdue follow-ups** from the database; the clock always shows Phnom Penh time.

---

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `POSTGRES_*` | Database credentials used by Docker Compose |
| `DATABASE_URL` / `DATABASE_URL_TEST` | Connection strings for local dev and the integration tests |
| `JWT_ACCESS_SECRET` | ≥ 32 random characters. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `COOKIE_SECURE` | `true` once the site is served over HTTPS |
| `TRUST_PROXY` | Number of reverse proxies in front of the API (Compose sets 1 for nginx) |
| `PUBLIC_URL`, `WEB_PORT`, `POSTGRES_PORT` | Docker host ports / address |
| `SEED_DEFAULT_PASSWORD` | Password given to the demo users |

`.env` is git-ignored. Never commit real secrets.

## Deploying on a server

1. Install Docker on the server (VPS or office machine), copy the repo, create `.env` with strong secrets.
2. `docker compose up -d --build`
3. Put HTTPS in front (Caddy, Traefik or nginx with Let's Encrypt) forwarding to port 8080, then set `COOKIE_SECURE=true` and `PUBLIC_URL=https://your-domain` and run `docker compose up -d` again.
4. **Do not run the seed in production** — it wipes the database. Create real users via the Staff page (Phase 5); until then, run the seed once and change the passwords.
5. Back up the `pgdata` volume (e.g. a nightly `docker compose exec postgres pg_dump …`) and the `uploads` volume.

---

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Analysis, ERD, plan | ✅ |
| 2 | Monorepo, Docker, schema + migrations, seed, auth, RBAC, layout, routing | ✅ |
| 3 | Clients, Shipping Plans (+ create wizard, Excel import), Cut Stock | next |
| 4 | Overview and Analytics with all charts on live API data | |
| 5 | Accounting (all sub-pages, PDF/Excel), Quotations, Documents, Follow-ups, Staff, Settings, Operations | |
| 6 | Hardening: more tests, RBAC review, query/index review, deploy guide | |

## Verified in Phase 2

- Shared formulas: 21 unit tests (incl. declarations I 122050 → $202.80 and I 95925 → $352.11)
- API: 20 integration tests against PostgreSQL (login, validation, refresh rotation + reuse detection, logout, RBAC per role, error format, OpenAPI)
- Web: 24 tests (token refresh logic, sidebar permissions, login form, Phnom Penh clock)
- Seed: cut-stock view matches every spreadsheet balance; over-import trigger rejects I-10
- Production builds run: migrations + server from the built bundle, nginx config serving the SPA and forwarding `/api` (deep links, CSP, caching, login + refresh through the proxy)
- The Docker images themselves could not be built in the development sandbox; their build steps were replayed outside Docker.
