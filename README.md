# SALVO

A casual, near-future naval combat game in the spirit of *Sea Power: Naval Combat in the Missile Age*. It has low-resolution pixelated 3D graphics, synthesized sound, and 1v1 play against the AI or another player online.

The game runs fully in the browser (Three.js + WebAudio). A Cloudflare Worker serves it. A Durable Object relays multiplayer games.

## Play

| Input | Action |
| --- | --- |
| Left click / drag box | Select ships (Shift adds) |
| Right click sea | Move (group keeps formation, Shift queues waypoints) |
| Right click enemy | Designate gun target |
| **F**, then click enemy | Launch an anti-ship missile salvo (Z / X / C = 2 / 4 / 6 missiles) |
| **G** | Fire chaff decoys at incoming missiles |
| **B** | Radar active / silent (EMCON) |
| **J** | Jammer on / off |
| `[` `]` or R / V, Backspace | Speed down / up, all stop |
| 1–4, `` ` `` | Select a ship / the whole fleet (double-tap to jump the camera) |
| H, double-click, Tab | Follow a ship |
| M | Ride the newest friendly missile |
| WASD / arrows, Q / E, wheel | Pan, rotate, zoom (right-drag or middle-drag also rotates) |
| Space, T | Pause, time compression (vs AI only) |
| ? | Command reference |

### Fleet creator

Click **FLEET CREATOR** on the main menu. You have 1,400 points for up to 6 ships.

- **Hulls:** Corvette (60 pts, 4 slots), Frigate (120 pts, 6 slots), Destroyer (200 pts, 8 slots).
- **Modules** (one per slot): anti-ship missiles, naval gun, SAM cells, CIWS, decoys, armour, long-range radar, ESM suite, jammer, gas turbines.
- Click a module to fit it into the selected ship. Click a fitted slot to remove it.
- Presets: Standard Task Group, Wolfpack, Air Defence Group, Silent Hunters.
- **ENEMY** on the menu picks the AI fleet: Standard, Random, or Mirror (your own design). In multiplayer each player brings their own fleet.

### Radar and electronic warfare

- **Radar active**: you track enemy ships at long range and your SAMs work. Enemy ESM (passive receivers) can hear your radar from 1.6 times its range.
- **Radar silent**: the enemy cannot hear you, but your SAMs go offline and you see only to the horizon (lookouts, about 1.3 km). Other ships in your group still share what their radars see.
- **ESM contacts** show as amber "?" symbols with a bearing line and an uncertainty circle. You can fire missiles at them; the missile flies to the estimate and its seeker searches for the real ship.
- **Jammer** (needs a jammer module): enemy radars see a jamming ship at about half range (they burn through at 1.5 km). Missile seekers have a shorter lock range against it and can lose lock. A jammer is heard from 9 km away, so use it when missiles are inbound.
- The AI starts silent and turns its radar on when it detects you.

Each side gets a standard task group: one destroyer, two frigates and one missile boat. SAMs and CIWS shoot down incoming missiles automatically. Large salvos saturate the defenses, and small salvos usually get shot down.

## Develop

```bash
npm install
npm run dev        # client only, http://localhost:5173
npm run preview    # build + run the real Worker locally (multiplayer works), http://localhost:8787
npm test           # headless AI-vs-AI battles to check the simulation
```

`npm run dev` proxies `/api` to `localhost:8787`. To use multiplayer while you use the Vite dev server, run `npx wrangler dev` in a second terminal.

## Deploy (GitHub → Cloudflare)

The workflow in `.github/workflows/deploy.yml` builds, tests and deploys on every push to `main`.

1. In the Cloudflare dashboard, create an API token with the **Edit Cloudflare Workers** template.
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions** and add these secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID` (shown on the Workers & Pages overview page)
3. Push to `main`. The game deploys to `https://salvo.<your-subdomain>.workers.dev`.

As an alternative, you can connect the repository in **Workers & Pages → Create → Import a repository** (Workers Builds). Set the build command to `npm run build` and the deploy command to `npx wrangler deploy`.

## Layout

```
worker/index.js        Worker entry + Room Durable Object (WebSocket relay)
src/config.js          Ship classes, weapons, fleets, waves
src/sim/               Deterministic-ish simulation (world.js) and AI commander (ai.js)
src/render/            Pixel pipeline (renderer.js), ocean, sky, ship models, particles, view sync
src/ui/                Camera rig, HUD, tactical overlay + minimap
src/audio/audio.js     All sound effects, ambience and music, synthesized at runtime
src/net/net.js         Multiplayer transport + guest interpolation
```

### Multiplayer model

The host runs the authoritative simulation and sends snapshots at 15 Hz. Each snapshot carries the events (launches, hits, splashes) that make the effects play. The guest sends commands only and renders an interpolated mirror with a delay of about 150 ms. If the guest disconnects, the AI takes command of their fleet.
