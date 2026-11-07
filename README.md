# CSE Souls

A cooperative dark fantasy RPG played in the browser. CSE 312 team project at the University at Buffalo.

**Team:** Tabshir Khandaker, Kristian Schuchman and Ryan Chan.

**Deployed app:** _add the link here once it is deployed (required for Objective 1)._

## Run it

```bash
docker compose up
```

Then open <http://localhost:8080>. No other setup is needed: the `.env` file is committed with placeholder values on purpose, and the first start creates the database tables and the JWT signing keys.

Plain `docker compose up` reuses images it has already built. After pulling or changing code, run `docker compose up --build`.

## Project status

The game is in active development, and the project deadline is December 1, 2026.

| Area | State |
|---|---|
| Accounts, profiles, avatars, leaderboard, achievements pages | Working and tested |
| Separate auth service, deployment config, security hardening | Working and tested locally. Not deployed yet. |
| Character creation and multiplayer movement | Working and tested |
| Website art | Working |
| Combat, creatures, chests, Binary Dust, potions, death and respawn | Server code written. Being finished and tested. |
| Forest, castle and the rest of the map | Being finished. Not connected to the game yet. |
| Hit effects, camera effects, VHS filter, combat sounds | Being finished. Not connected to the game yet. |
| Full-body attack animations for all 12 weapons | Being finished |
| Village, graveyard, enemies other than animals, weapon loot, the boss | Not started |

## What exists now

**Accounts.** Register, log in and log out. Each player has a profile at `/character` and a public page at `/players/<username>`. The site also has `/leaderboard`, `/achievements` and `/credits`. A profile picture can be an upload, a built-in emblem, a generated avatar or a GitHub picture.

**Class selection and customization at `/create`.** A new account goes here first. There are four classes (Juggernaut, Duelist, Mage, Ranger), each with its own starting stats. The player then picks a body (male or female), skin tone, hair style, hair color, beard (male bodies only), clothing color, leather and armor color, and one of three starting weapons, and turns the hood and shoulder armor on or off. The character can be changed again later while the game is in early development.

**Characters.** Players are normally proportioned humans, about 1.75 units tall, built from Quaternius's CC0 packs. Bodies, outfits, hair and animations all share one 65-bone skeleton, so a character is a choice of which parts to show. The free outfit tier only has Ranger and Peasant clothes, so there is no plate armor or robes yet. Weapons are real models from two CC0 packs, attached to the hand bones. See [Rebuilding the models](#rebuilding-the-models).

**Multiplayer at `/play`.** You need to be logged in and have a character. Players share one empty map: ground, rocks with no collision, a painted backdrop and a 20-minute day/night cycle. Each player sees the others with nameplates. Opening the game in a second tab takes over from the first, and position is not saved, so you spawn near the center each time you connect.

| Input | Action |
|---|---|
| `W` `A` `S` `D` | Move |
| Mouse | Look around |
| `Shift` | Run |
| `Space` | Jump |
| `C` | Dodge roll |
| Left click | Attack |
| `1` or `Numpad 1` | Drink a healing potion |
| `E` | Open a chest, or rest at a Binary Grace |
| `M` | World map |
| Scroll | Camera distance |
| `Esc` | Pause |

**Binary Graces.** Golden lights around the map, one for each area. Walking near one lights it for good on that save, and `E` beside it sits you down, in one of eight seats so that a group can share it. Sitting refills health, magic, stamina and potions and makes that grace your way back when you fall. A hunter coming near stands you up, and so does moving or being hit. The menu there lets you spend Binary Dust to raise a stat (the cost is `upgradeCost(level)` in `shared/combat.ts`, a stat stops at 40, and each raise adds a level), travel to any grace you have lit, see the world map, and change saves. Each account has 3 saves, and each one is a whole character with its own class, looks, stats, Binary Dust, lit graces and opened chests. The browser only ever asks: the server checks distance, resting, dust and ownership itself, and the upgrade is one atomic SQL update. The rules are in `shared/graces.ts` and `server/src/app/combat.ts`, the saves are in `server/migrations/003_saves.sql`, and the look is in `client/src/game/graces.ts`.

**Server-authoritative movement.** The server runs the game at 30 ticks per second and sends a snapshot every 2 ticks. Clients send inputs only (sequence number, direction, facing, and run, dodge, jump, potion and attack flags). The server never accepts a position from a client, and an input budget stops a client from moving faster than real time. On top of that, the browser uses three techniques:

- **Prediction:** your inputs apply right away, using the same rules the server runs (`shared/sim.ts`).
- **Reconciliation:** each snapshot says which of your inputs the server has applied. The browser resets to the server's state and replays the inputs not confirmed yet. Small differences fade out over a few frames instead of showing as a jump.
- **Interpolation:** other players are drawn 110 ms in the past, blended between their two nearest snapshots.

The code is in `server/src/app/realtime.ts` and `client/src/game/net.ts`.

**PS1 dither shader.** `client/src/game/psxRenderer.ts` draws the scene to a small render target, 240 to 300 pixels tall. A fragment shader then applies 4x4 Bayer ordered dithering and rounds each color channel to 32 levels. Materials also snap their vertices to a coarse screen grid, which gives the PS1 wobble. `/play` and `/create` both use this renderer.

### Still to come

The table under Project status lists what's finished. Snapshots still send every player to every client, because interest management for players isn't built yet.

The plan for the rest of the game is in [docs/GAME_PLAN.md](docs/GAME_PLAN.md). Prompts for optional art are in [docs/IMAGE_PROMPTS.md](docs/IMAGE_PROMPTS.md). The site works without those images: until a file is added to `client/src/art/`, it shows art drawn in code.

## Architecture

```text
Browser ──> nginx ─┬─ /register /login /logout /auth/xsrf ──> auth (Express)  ─┐
  :8080            │                                                           ├─> Postgres
                   └─ everything else, including /ws ───────> app  (Express)  ─┘
```

| Container | Job | Can read |
|---|---|---|
| `nginx` | Only container with a published port. Routes traffic, rate limits, sets `nosniff`. | |
| `auth` | Registration, login, logout. Issues the JWTs. Serves the page for `/login` and `/register`. | Private signing key |
| `app` | The website, REST API, avatars, WebSocket and game simulation. | Public key only |
| `db` | PostgreSQL, on an internal Docker network. | |

The auth and app containers never talk to each other. The public key reaches the app through a shared volume (read-only on the app side), and the private key sits on a volume only `auth` mounts.

### Code layout

| Path | Contents |
|---|---|
| `client/` | The React website and the Three.js game (`client/src/game/`). |
| `server/src/auth/` | The auth service. Built entry point: `dist/server/src/auth/index.js`. |
| `server/src/app/` | The app service. Built entry point: `dist/server/src/app/index.js`. |
| `server/src/shared/` | Code the two services share: database, JWT checks, HTTP middleware and logging. |
| `server/migrations/` | SQL files applied at startup. |
| `shared/` | Game rules used by both the server and the browser. |
| `nginx/` | nginx config. `nginx.conf` sets the worker and connection limits, `local.conf` and `prod.conf.template` are the local and deployed servers, and `snippets/` holds what they share. |
| `client/public/models/` | Character kits, animation files and weapons, with their licenses in `LICENSES.txt`. |
| `client/public/models/animals`, `client/public/models/world` | Animated animals, forest, castle and props. |
| `client/public/audio/sfx/game`, `client/public/fx` | Combat sounds and effect sprites. |
| `client/src/game/attacks/` | How each weapon family stands and attacks. |
| `client/src/game/fx/` | Particles, slash trails, camera effects and effect sprites. |
| `tools/` | Scripts that rebuild the models, the map and the effect sprites. |

The top-level `shared/` folder holds `classes.ts` (classes, stats and appearance limits), `protocol.ts` (WebSocket messages), `sim.ts` (player rules), `combat.ts` (weapon numbers), `creatures.ts` (animal numbers), `collision.ts` and the generated `mapData.ts`. It is not the same as `server/src/shared/`. The server compiles it too, which is why the build output keeps the full `server/src/...` path, with the game rules at `dist/shared/`.

## Third-party APIs

| Service | Used for | Why | Where it runs |
|---|---|---|---|
| [DiceBear](https://www.dicebear.com) | Generated avatars | Gives players a picture without uploading one. Only CC0 styles are used (`pixel-art`, `identicon`, `rings`, `shapes`). | The browser loads previews using random seeds, so no username or account data is sent. The server downloads the one the player picks. |
| GitHub | Profile picture import | Lets a player reuse the picture from their GitHub account. It uses the public `https://github.com/<login>.png` address, not the REST API, and needs no token. | Server |
| [Have I Been Pwned](https://haveibeenpwned.com/Passwords) | Password breach warning | Warns at registration if a password has appeared in a data breach. The warning does not block signup. | Browser only |

The breach check uses k-anonymity. The browser hashes the password with SHA-1, sends only the first 5 characters of the hash to `api.pwnedpasswords.com`, and compares the returned list itself. The password and the full hash never leave the browser for this check. It runs only on HTTPS or localhost, because browsers don't offer the hashing API elsewhere.

**These are optional.** Everything else works if they are down, none of them needs an API key, and nothing contacts them at startup. During an outage:

- **Have I Been Pwned:** no warning appears, and registration carries on as normal.
- **DiceBear:** previews in the picker's Generated tab don't load. Choosing one shows an error, and the current picture stays.
- **GitHub:** importing a picture shows an error, and the current picture stays.
- **Not affected:** uploads and built-in emblems need no outside service. Saved pictures are stored in our own `avatars` volume, so they keep showing.

The server gives each download request 6 seconds. Each redirect must be HTTPS to an expected host, and every image gets the same size limit and re-encoding as an upload. A download stops as soon as it passes the size limit, so a huge response is never held in memory.

## How the requirements are met

**Authentication.** Passwords are salted and hashed with bcrypt (cost 12). Login sets the JWT in a cookie with `HttpOnly`, `SameSite=Strict` and `Max-Age`, plus `Secure` when deployed. JWTs are signed with RS256 and expire after 12 hours by default (`JWT_TTL_SECONDS`). The app verifies them locally with the public key, pinned to RS256, so `alg: none`, HS256 confusion, bad signatures and expired tokens are all refused without a database lookup. Keys live on volumes, so sessions survive a restart.

Logging out clears the cookie. A JWT cannot be revoked server-side without a lookup the assignment forbids, so a copied token stays valid until it expires. That is why the lifetime is limited.

**XSRF.** Every state-changing request needs a token in the `X-XSRF-Token` header. Before login it is a double-submit token from `/auth/xsrf`. After login it is a per-session random value signed into the JWT as the `xsrf` claim, which ties it to that user and ends with that session. `Origin` is checked as well, as an exact match against the `ALLOWED_ORIGINS` list.

**Other security concerns.** SQL values are always passed as parameters, and the leaderboard's sort order is picked from a fixed list. React escapes rendered text, game nameplates use `textContent`, usernames are alphanumeric, and a strict Content-Security-Policy blocks inline scripts. Appearance choices are small integers checked against fixed limits. Uploads are checked by their first bytes before any decoding, then decoded by content and re-encoded to a fresh PNG, so a disguised script cannot survive. WebSocket handshakes must pass both the `Origin` check and JWT verification, all identity comes from the verified JWT, and a socket is closed when its token expires. The Content-Security-Policy only allows WebSocket connections to the origins in `ALLOWED_ORIGINS`. nginx matches `/register`, `/login` and `/logout` case-insensitively, so no spelling of them reaches the app container. The database publishes no port. `.gitignore` keeps `.env.prod`, certificates and keys out of the repo, and the committed `.env` holds only local placeholders.

**DoS.** nginx enforces header and body timeouts, a body size limit and per-IP request and connection limits. The limits are generous because a whole lecture hall may share one IP during the presentation. For the same reason, static files (`/assets`, `/models`, `/audio`, `/icons`, `/avatars`) skip the request limit, and `nginx/nginx.conf` raises `worker_connections` to 8192. Login brute-force protection counts each attempt before the slow password check, per IP plus username, with a much higher cap for one IP alone. WebSocket messages have a size cap and a per-second cap that also counts pings, inputs out of range are dropped, clients too slow to keep up are dropped, and dead connections are found by ping. Image decoding is capped at 16 megapixels and runs one image at a time.

## Testing

With the stack running:

```bash
cd server && npm install && npm test
```

This runs the test suite against the running app through nginx. `test/security.test.ts` checks forged, expired and wrong-algorithm JWTs, XSRF refusals, SQL injection attempts, disguised uploads, WebSocket hijacking, cookie directives and more. `test/game.test.ts` checks the character API, entering the world, seeing other players, movement, anti-cheat and badly behaved clients. The security tests also call `docker compose` to inspect the containers, so run them on the machine hosting the stack. Every run registers new random accounts. `test/world.test.ts` and `test/combat.test.ts` cover combat, creatures, chests and Binary Graces, including raising stats, travel, and keeping saves apart.

To prove sessions survive a restart: log in, run `docker compose restart`, refresh the page.

Two real browser players were also checked seeing each other on port 8080 with the security headers on.

**Load test.** With 60 simulated players moving at 30 inputs per second, the app container used about 6% CPU on one laptop, each client got 14.8 snapshots per second and 41 KB/s down, and nobody was disconnected. All of this ran on one machine, so it does not measure real network conditions. Bandwidth per client also keeps growing with the player count until interest management is built.

## Frontend development

For hot reload while working on the UI, keep the stack running and start Vite:

```bash
cd client && npm install && npm run dev
```

Open <http://localhost:5173>. Graders and normal runs use port 8080 and do not need this.

- API calls, avatars and the WebSocket go through Vite to the stack on port 8080.
- Vite picks up changes in `shared/` right away, but the server does not. After changing game rules, run `docker compose up --build`, or prediction and the server will disagree.
- Vite does not send the Content-Security-Policy header, so test anything affected by it on port 8080.
- `npm run typecheck` works in both `client/` and `server/`.

## Rebuilding the models

The finished files in `client/public/models/` are all the game needs. To change them, for example to add an outfit or keep another animation, download the raw packs listed at the top of `tools/build-models.mjs`, install the dependencies in the `npm i` line there, and run:

```bash
node tools/build-models.mjs <folder with the unzipped packs> <output folder>
```

The raw packs are large, so they stay out of the repo. The free packs come from the normal download buttons on each itch.io page. The LowPoly Fantasy Weapon Pack is FBX, so convert it to GLB first. The paths in the script match the folders the packs were first unzipped into, so adjust them to suit. The animations to keep are in its `KEEP` list.

## Deployment

Needs a server with Docker, a recent Docker Compose (`compose.prod.yml` uses the `!override` tag), Certbot, and a domain whose DNS record points at it. On the server:

```bash
git clone <this repo> && cd <this repo>
cp .env.prod.example .env.prod   # then edit it: a strong DB_PASSWORD, and your DOMAIN
mkdir -p certbot/www
sudo certbot certonly --standalone -d your.domain   # port 80 must be free the first time
docker compose -f compose.yml -f compose.prod.yml --env-file .env.prod up -d --build
```

In this mode nginx publishes 80 and 443 instead of 8080. Port 80 redirects to the same path on HTTPS, cookies get `Secure` (nginx's `proxy_cookie_flags` also adds it to anything the services send), HSTS is on, and the site's WebSocket connects with `wss://`.

**`ALLOWED_ORIGINS`** is the exact list of origins allowed to make state-changing requests and open the WebSocket. The Content-Security-Policy's WebSocket addresses come from the same list. `compose.prod.yml` sets it to `https://${DOMAIN}` on purpose, rather than reading it from the env file, so a typo there cannot weaken the deployed site. There is no wildcard or partial matching, so to serve the site from a second host name, such as `www`, add that origin to the comma-separated value in `compose.prod.yml` and get a certificate that covers it.

Locally it defaults to `http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173`. To open the local stack from any other address, such as a phone on your network, set `ALLOWED_ORIGINS` in your shell or `.env` with that address included.

Later renewals can use the running server:

```bash
sudo certbot renew --webroot -w ./certbot/www --deploy-hook "docker compose -f compose.yml -f compose.prod.yml --env-file .env.prod exec nginx nginx -s reload"
```

## Objective 4 (draft)

_This section is a draft. We recommend confirming with course staff that these features qualify before relying on it._

**Planned feature: netcode**, made up of client-side prediction, server reconciliation and interpolation. The spec lists this as an example under Systems and Networking. Player movement already uses it; see [What exists now](#what-exists-now).

**Also planned: WebGL rendering with custom PS1 shaders**, under Graphics and Interaction. Rendering uses Three.js on top of WebGL. The custom parts are the dither pass, the vertex snapping and the sky shader, in `client/src/game/psxRenderer.ts` and `client/src/game/world.ts`.

To see the netcode, log in with two accounts in separate browsers and open `/play` in both.

## Team note on commits

The course grades individual commits on the default branch, and "If a commit is not in your name, you effectively did not write that code," so each teammate must commit their own work.

## Credits

Made by Tabshir Khandaker, Kristian Schuchman and Ryan Chan.

- **Music:** "Night Vigil" and "Ancient Rite" by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Re-encoded for the web, with short fades added at each end.
- **Sound effects:** website and most combat sounds generated with ElevenLabs. Check that the account's plan allows sharing them before this repo goes public. Others are from [Impact Sounds](https://kenney.nl/assets/impact-sounds) and [RPG Audio](https://kenney.nl/assets/rpg-audio) by Kenney, CC0.
- **Animals:** [Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html) by Quaternius, CC0.
- **World:** Quaternius, Kenney, chilly_durango, Screaming Brain Studios and others. Details are in `client/public/models/LICENSES.txt` and on the `/credits` page.
- **Characters:** [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) and [Modular Character Outfits - Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) by Quaternius, [CC0](https://creativecommons.org/publicdomain/zero/1.0/). Parts were combined onto one skeleton, with polygon counts and textures reduced.
- **Animations:** [Universal Animation Library](https://quaternius.itch.io/universal-animation-library) and [Universal Animation Library 2](https://quaternius.itch.io/universal-animation-library-2) by Quaternius, CC0. Unused clips were removed and the rest compressed.
- **Weapons:** [PSX Weapon Pack](https://amos-makes.itch.io/psx-weapon-pack) by Amos and [LowPoly Fantasy Weapon Pack](https://cardinalzebra.itch.io/low-poly-fantasy-weapon-pack) by CardinalZebra, both CC0. Combined into one file, with textures reduced. See `client/public/models/LICENSES.txt`.
- **Icons:** from [game-icons.net](https://game-icons.net), by Lorc, Delapouite, Skoll, DarkZaitzev and Caro Asercion, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Recolored for this site.

The site's `/credits` page also lists the fonts.

## Checking weapon grips

How each weapon is held and swung is set in `client/src/game/armory.ts`. To check a change, run the Vite dev server and open `http://localhost:5173/weapon-lab.html`, then call `lab.show({ classId: 'duelist', variant: 0, animation: 'attack', at: 0.37, angle: -60 })` in the browser console. It returns how far the arms are stretched: above 1 means a hand can't reach its target. This page isn't part of the production build.
