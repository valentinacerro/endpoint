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

---

## What it does

A trip is a **title, some dates, a home timezone and a currency**. Under it sit
**stops** — the cities, in order, each with its own timezone and its own
arrival and departure dates — and everything else hangs off those: bookings,
places you want to see, documents, expenses, photographs.

The phone fetches the whole trip in **one request**
(`GET /api/trips/{id}/bundle`) and keeps it in IndexedDB. Every read screen
renders from that single cached copy, which is why the app works in airplane
mode with no per-screen offline code anywhere.

Five destinations live in the bar along the bottom — **Itinerary, Places, Map,
Spending, More**. Five is the most a thumb can aim at; the rest is behind
*More*, because stops and settings are not what you reach for standing on a
platform.

### Itinerary

The day-by-day plan: each day numbered, dated, and labelled with the city it is
spent in. At the top, the next booking still ahead of you. Under each day
heading a free-text note, then the day's entries in order — bookings and
scheduled visits together, each at the time it happens in the zone it happens
in. Zone labels appear only on a trip that crosses more than one.

- **Plan the day** arranges a single day: it takes what cannot move — a flight,
  a timed museum slot, a check-in — and fits everything else around it. You get
  a preview, a list of what it had to drop and why, and a Cancel beside the
  Apply. Nothing is written until you accept.
- A visit can be nudged onto the previous or next day without opening anything.
- Tapping a booking opens its details: reference codes, addresses, telephone
  numbers, and the documents attached to it.
- At the bottom, everything **not yet scheduled** — the wish list, and any
  booking with no date — each droppable onto a day from there.

### Places

The wish list: what you want to see, with a category, a priority and how long
you think it takes. Four ways in, and typing the name is the worst of them:

- **Share from Google Maps.** With the app installed on the phone: Maps →
  Share → endpoint. The link arrives, its position is resolved, the place is
  saved.
- **Paste links in bulk.** A textarea, because planning happens in batches —
  eleven links in a note at the end of an evening, all in at once.
- **Google Takeout.** Upload a saved-places export (`.zip`, or a single `.csv`
  out of one). Positions carried in the links are read immediately; the rest
  are offered afterwards as a separate, interruptible step, one redirect each.
- **Type a name** and pick a suggestion, searched near wherever you are
  looking.

Each place shows which city it belongs to. Where you never said, it is
**inferred from the coordinates** and labelled as inferred: within 30 km it is
that city's, out to 150 km it is a day of its own, beyond that it belongs to
no city on this trip. The guess is never written down, so `place.stop_id` keeps
meaning exactly one thing — you said so.

### Map

The trip's pins, numbered in the order you would walk them, for one day or for
the whole trip, and a count of the entries it could not draw for want of
coordinates. **The one screen that needs a network**: map tiles cannot be
cached offline.

### Spending

Expenses by day, with a category and how they were paid. Totals are kept per
currency and also converted into the trip's own currency at the ECB reference
rate for the day of the purchase, so a budget has something to measure against.
That rate is an estimate and says so — banks add a spread of a percent or two —
and can be replaced later with the real figure off a statement. Money is summed
in integer minor units throughout, never in decimals.

### More

| Screen | What it is for |
| --- | --- |
| **Organise the trip** | Spreads the whole wish list across all the days, in the right cities, instead of you deciding thirty times which afternoon each place belongs to. It shows what it could *not* fit first — no coordinates, shut every day you are there, no day attributed to that city — then a preview of every day. Writes nothing until you tap Apply, and then in one request, all or nothing. |
| **Diary** | A day at a time, each with a short reminder of what was on that day's itinerary. Nobody remembers on Thursday what the Monday temple was called. |
| **Memories** | Where you actually went, drawn from your own photographs. The browser reads the coordinates and timestamp out of each file and sends **only those** — about a hundred bytes a photo. The pictures never leave the device. |
| **Nearby** | What of *yours* is around you right now: distance, walking or transit minutes, and whether it is still open — and for how much longer. Needs the GPS and nothing else. |
| **Search** | Everything in the trip, out of the cached bundle. No request and no debounce: it answers in a basement, which is where you are standing when someone wants the confirmation code. |
| **Weather** | A daily forecast per city, and the rain re-balancer: given a wet Tuesday and a dry Friday, it looks for a museum on Friday that could trade places with the garden on Tuesday. It proposes; it never rearranges. |
| **Packing** | A checklist by category, with a starter list suggested from the trip's dates and the countries of its stops. Whole rows are the tap target, and it needs no network. |
| **Stops** | The cities: order, dates, timezone, position. **Locate stops** proposes coordinates for the ones that have none — proposes, because "Tokyo" matches a suburb of Tokyo more often than you would like, and a wrong city quietly claims places that belong elsewhere. |
| **Print** | The trip on one sheet of paper, with the confirmation codes and addresses printed outright rather than one tap away. Nothing in software defends against a dead phone. Any browser prints this to a PDF. |
| **Offline status** | The screen you check before boarding: what is *really* on this phone. It counts actual cached entries rather than trusting that a download happened, and fetches every document in one tap. |
| **Settings** | The interface language, Italian or English, remembered on this device rather than on the server. |
| **Edit trip** | Title, destination, dates, timezone, currency, budget, status. |

### Documents

PDFs and images (JPEG, PNG, WebP) attach to a booking, and are sniffed for
their real type rather than trusted by extension. They are shown **inside the
app** — PDFs drawn with pdf.js onto a canvas, because Chrome on Android would
rather offer you a download and throw you out of the app, and because a cached
blob can be drawn where an `<iframe>` pointed at a URL could not. Each can be
pinned for offline, and in the three days before departure the itinerary starts
saying which ones are not yet on the phone.

---

## How you use it

**Setting a trip up.** Create the trip with its dates. Add the **stops**, one
per city, with arrival and departure dates and the right timezone — almost
everything else reasons from those: which city a day belongs to, which forecast
to fetch, what zone a photograph's clock was probably set to. Then run **Locate
stops** so each city has a position on the earth.

**Collecting places.** Over the following weeks: share or paste links from
Google Maps, or import a Takeout export. Nothing needs scheduling yet — a place
with coordinates and a category is enough to work with later.

**Turning the pile into a plan.** **Organise the trip** offers a day for every
place at once; read what it could not fit, then apply. **Plan the day** reworks
a single day afterwards, when a booking moves. Either way you can still drop a
place onto a day by hand from the wish list. Add bookings as they are made and
attach the voucher to each.

**The week before.** Work through the packing list. Check the forecast — a
fortnight is as far as one reaches — and take the re-balancer's swaps if they
make sense. Then open **Offline status**, download every document, and print
one sheet of paper.

**On the road.** The itinerary in the morning; **Nearby** when an afternoon
opens up; **Search** when someone asks for a booking reference; expenses as you
spend them; the diary in the evening. All of that works with no signal, and
what you write is queued and sent when there is one.

**Afterwards.** Import the photographs for the memory map, finish the diary,
set the trip to *done*.

---

## Where it stands

**Current state: all three phases are built.** Itinerary, stops, bookings,
documents, offline cache, Maps links and import, the day optimiser and the
whole-trip organiser, expenses, the packing list, the rain re-balancer, search,
nearby, printing, the diary, the memory map, and Italian/English.

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

## Outside services

All free, none needing a key, an account or a card — the test every dependency
in this project has to pass.

| Service | For | Worth knowing |
| --- | --- | --- |
| [Photon](https://photon.komoot.io) | Type-ahead place search | Proxied through the backend, so what you type never reaches Komoot with your IP attached |
| [Open-Meteo](https://open-meteo.com) | Daily forecast | Reaches about a fortnight; one request per stop, in that stop's own zone |
| [Frankfurter](https://frankfurter.dev) | Exchange rates | ECB reference rates, which are not what a card charges |
| Google Maps | Opening a place, directions, resolving shared links | Plain URLs — no key, no SDK. A shared short link is resolved by following its redirects by hand, host-checked at every hop |

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
the backend, reproducing the single origin you get in production. Sign in with
the password from `backend/.env`, then `make seed` fills the database with a
realistic trip — Tokyo and Kyoto planned from Rome, so two time zones, plus a
booking with no date yet and a voucher to open. Real data beats an empty screen
when working on the interface.

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

Inside the frontend, the division that matters: `lib/` is pure functions over
plain data — the timeline, the day optimiser, the whole-trip organiser, the
rain re-balancer, nearby, search, the money arithmetic — with no fetching and
no React in any of it. That is where the reasoning worth testing lives, and why
it keeps working in a station with no signal. `routes/` and `components/` draw
it; `api/` and `offline/` fetch, cache and queue.

Four decisions worth knowing before touching anything:

**One request holds the trip.** `services/bundle.py` assembles the whole thing
and the phone renders every read screen from that one cache entry. Adding a
screen costs no offline handling; adding a per-screen endpoint would.

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
