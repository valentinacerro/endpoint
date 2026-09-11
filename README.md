# endpoint

A personal travel organizer: itineraries, bookings and documents, **readable
without a network connection**. FastAPI backend, React frontend installable as
an app on the phone (PWA).

The full project plan lives in
`~/.claude/plans/ciao-sto-organizzando-un-whimsical-heron.md`.

> **Language convention.** Code, comments, documentation and backend messages
> are in English. The interface is Italian or English, chosen in Settings;
> `frontend/src/i18n/locales/it.ts` is the source dictionary and the one file
> whose *values* are deliberately not English. Backend `message` fields are
> developer-facing fallbacks; the UI picks its wording from the
> machine-readable `code`.

**Current state: all three phases are built.** Itinerary, stops, bookings,
documents, offline cache, Maps links and import, the day optimiser, expenses,
the packing list, the rain re-balancer, search, nearby, printing, the diary,
the memory map, and Italian/English.

**Not done, and worth knowing before a trip:**

- **The suite has never run against real Postgres.** SQLite does not exercise
  `JSONB`, `bytea`, `TIMESTAMPTZ` or `NUMERIC` the way Neon does. Make a Neon
  branch and run `make test-pg TEST_DATABASE_URL=...` against it — never
  against the branch holding real data, which the suite would wipe.
- **No end-to-end test.** The one that would earn its keep is the plan's:
  load a trip online, pin an attachment, go offline, reload, and check the
  timeline draws with the right times and the PDF still opens.
- **Keep-warm is off.** `.github/workflows/keepalive.yml` needs `HEALTH_URL`
  set and its `schedule` uncommented a few days before leaving — and
  commented back out on return. Read the arithmetic at the top of that file
  first.
- **Only some writes survive being offline.** Which ones, exactly, is the
  table below.

---

## What works with no network

| | Offline |
| --- | --- |
| Reading the trip — itinerary, bookings, places, stops, search, nearby, packing, diary, print, and any document you pinned | **Yes**, from the cached bundle |
| Expenses, packing list, diary, memory points | **Yes** — queued and replayed when there is a network again |
| Bookings, stops, places (applying a plan included), day notes, document uploads, creating or editing a trip | **No**, and they say so rather than failing quietly |
| Place search, resolving a Maps link, the forecast, exchange rates, the Takeout import, map tiles | **No** — each one is a call to somebody else's service |

Queued writes are addressed by an id the client chose and sent with `PUT`, so
a request whose response was lost in a tunnel leaves one coffee, not two.

---

## What you need

- **uv** — already installed. It manages Python too: the system's 3.9 is never
  touched.
- **Node 20+** — already installed.
- Nothing else. No local Postgres: development runs on SQLite.

## Getting started

```sh
make setup          # install everything
make password       # generate APP_PASSWORD_HASH and JWT_SECRET
```

Copy `backend/.env.example` to `backend/.env` and paste in the two lines
`make password` printed.

> A `backend/.env` already exists with the development password
> `viaggio-dev-locale`. **That is fine locally and nowhere else.** Generate
> your own with `make password` before putting the app online.

Then, in two terminals:

```sh
make api            # backend  -> http://localhost:8000
make web            # frontend -> http://localhost:5173
```

Work against **http://localhost:5173**: Vite forwards `/api` and `/health` to
the backend, reproducing the single origin you get in production.

## Commands

| Command | What it does |
| --- | --- |
| `make` | List every command |
| `make seed` | Fill the development database with a realistic sample trip |
| `make test` | Backend test suite (SQLite) |
| `make test-pg TEST_DATABASE_URL=...` | The same suite against real Postgres |
| `make test-web` | The frontend suite, under both timezones |
| `make lint` / `make fmt` | Check / fix style and formatting |
| `make types` | Regenerate the frontend's types from the backend's OpenAPI schema |
| `make build` | Compile the PWA into `backend/app/static` |
| `make preview` | Serve exactly like production, on one origin |
| `make tunnel` | Public HTTPS URL, so the phone can install the PWA |
| `make migrate` | Apply migrations |
| `make revision m="..."` | Create a migration from the models |

> **Never rewrite or delete a migration that has been deployed.** A live
> database records the revision it last applied; remove that file and it can
> no longer tell where it is, and the service refuses to start with
> `Can't locate revision`. This happened once, on 10 September: an "initial"
> migration was being regenerated on every model change, which is harmless
> locally — the dev database is deleted too — and fatal once production has
> applied one. Always add a new migration on top. `tests/test_migration_chain.py`
> checks the history stays walkable, but it cannot know what production has
> already run.

---

## Testing before deploying

Three layers, covering different risks.

**On this Mac.** `make preview` serves the compiled PWA from FastAPI on
http://localhost:8000 — one service, one origin, exactly the production
shape. Chrome will install it, and DevTools → Network → Offline exercises the
offline path. This covers all application logic.

**On the real phone, without deploying.** A PWA needs a secure context, so
opening `http://<mac-ip>:8000` from the Pixel loads the page but gives you no
service worker and no install prompt — that is, everything except the part
worth testing. Instead:

```sh
brew install cloudflared
make preview     # one terminal
make tunnel      # another; prints a https://….trycloudflare.com URL
```

Open that URL on the Pixel and it installs as a real app, service worker
included, so airplane mode tests something meaningful. The tunnel is free,
needs no account, and disappears when you stop it.

**What only a deploy can tell you.** Three things are out of reach locally:
the Docker build, Render's cold start, and Postgres-specific behaviour.

Two of the three can be removed early without deploying anything:

- **Postgres.** SQLite silently differs on `JSONB`, `bytea`, `TIMESTAMPTZ`
  and `NUMERIC`, so a green local suite is not proof. Run
  `make test-pg TEST_DATABASE_URL=postgresql+psycopg://…` against Postgres.

  > **This suite drops every table.** Point it at a Neon *branch*, never at
  > the database holding your trip — creating a branch is instant and free.
  > As a backstop it refuses to start if the target already contains trips,
  > but do not rely on that instead of reading the connection string.
- **Docker.** `brew install --cask docker`, then `docker build -t trips .`
  from the repository root.

---

## How it is put together

```
backend/     FastAPI + SQLAlchemy 2.0 + Alembic. Also serves the compiled PWA.
frontend/    React + Vite. Its build output lands in backend/app/static.
Dockerfile   Single image (PWA build + backend) used by Render.
```

Three decisions worth knowing before touching anything:

**One service, one origin.** FastAPI serves both the API and the PWA. With
separate domains the session cookie would become a third-party cookie, and
Chrome — the browser on the phone — keeps tightening the screws on those. Same
origin means first-party `httpOnly` cookies and no CORS at all.

**Only stable English keys reach the database** (`hotel`, `flight`, `train`),
never translated text. Translations live in `frontend/src/i18n/locales/`.
Adding a language must not cost a migration. See `backend/app/enums.py`.

**Routes are protected by default.** The `/api` router mounts
`Depends(current_session)` once, so an endpoint added tomorrow is covered
without anyone having to remember. The only exceptions are `/health`,
`/api/auth/login` and `/api/auth/logout`, and `backend/tests/test_auth.py`
enforces that they stay the only ones: that test enumerates the real routes and
asserts every other one answers 401.

---

## Putting it online (free)

A one-time setup. It needs your own accounts.

### 1. Database — Neon

1. Create a project on [neon.com](https://neon.com), **European region**.
2. Copy the connection string and change the prefix to
   `postgresql+psycopg://` so SQLAlchemy uses psycopg 3.

The free plan gives 0.5 GB and suspends compute after five minutes of
inactivity, but **wakes up on its own**. (Supabase instead pauses after seven
days and needs a manual restart from the dashboard, which is why it is not
used here.)

### 2. Service — Render

1. New **Web Service** from the repo, **Docker** runtime, **Frankfurt** region,
   **Free** plan. `render.yaml` already holds the configuration.

   > The `Dockerfile` **has not actually been built yet**: Docker is not
   > installed on this Mac, so Render's will be the first real build. To find
   > any snags locally first, install Docker Desktop and run
   > `docker build -t trips .` from the repository root.

2. Set the environment variables (secrets never live in the repo):
   - `ENV=prod`
   - `DATABASE_URL` — from Neon
   - `APP_PASSWORD_HASH` and `JWT_SECRET` — from `make password`

With `ENV=prod` the app **refuses to start** if those secrets are missing, and
switches `/docs` off. That is deliberate: an error visible in the deploy log
beats a live service that accepts any password.

### 3. Install the app on the phone

Open the `.onrender.com` address in Chrome on the Pixel → menu → **Install
app**. Android creates a real WebAPK: an icon on the home screen, no browser
chrome.

### 4. Keeping the service awake (during the trip only)

Render sleeps the service after 15 minutes and takes up to a minute to wake it.
`.github/workflows/keepalive.yml` keeps it up with a ping every 10 minutes, but
**it is switched off on purpose**: read the comment at the top of the file
before enabling it. The 750 free monthly hours are *per workspace, not per
service*, and running out suspends everything until the next month.

---

## Security

What is there:

- A single password, **Argon2id** hash in an environment variable. No users in
  the database, no email, no password recovery.
- Session in an `httpOnly` + `Secure` + `SameSite=Lax` cookie, 30 days, renewed
  each time the app launches.
- **Rate limiting** on login: without it the password is brute-forceable.
- No secrets in the JavaScript bundle. Vite inlines any `VITE_*` variable into
  public code, so nothing confidential ever goes there.
- In production: HSTS, `nosniff`, `/docs` off, `noindex`.

What is **not** there, and should be known:

- **Data at rest is not encrypted.** Anyone holding the `DATABASE_URL` can read
  everything. So: no passport number as a structured field. If a scan is
  needed, it goes in as an attachment and gets deleted after the trip.
- One password with no granular revocation: changing it means updating the
  variable on Render and signing in again on each device.

---

## Practical notes

**VS Code reporting packages as not installed?** It is looking at the wrong
Python. Run `Python: Select Interpreter` and pick
`backend/.venv/bin/python`.

**The icons** live in `frontend/public/icons/`. To regenerate them after
changing the artwork:
`uv run --with pillow python frontend/scripts/make_icons.py`.
