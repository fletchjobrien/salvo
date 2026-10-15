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
| **B** | Radar on / off |
| **J**, then click | Cast a jamming cone |
| **P** | Active sonar ping |
| **U** | Submarine: dive / surface |
| `[` `]` or R / V, Backspace | Speed down / up, all stop |
| 1–4, `` ` `` | Select a ship / the whole fleet (double-tap to jump the camera) |
| H, double-click, Tab | Follow a ship |
| M | Ride the newest friendly missile |
| WASD / arrows, Q / E, wheel | Pan, rotate, zoom (right-drag or middle-drag also rotates) |
| Space, T | Pause, time compression (vs AI only) |
| ? | Command reference |

### Winning

Each battle has a random map: islands (they block radar and missiles), merchant traffic, and a control point. Hold the control point alone to capture it; the holder scores, and the first side to 300 wins. Sinking the whole enemy fleet also wins. Hitting a civilian costs 10 points.

### Fleet creator

Click **FLEET CREATOR** on the main menu. You have 2,000 points for up to 6 ships and 4 air squadrons. Click a design on the left, then click module tiles on the right to fill its slots; click a filled slot to empty it. Hover anything for a one-line description.

- **Hulls:** Corvette (70 pts, 2 slots), Frigate (140 pts, 4 slots), Destroyer (220 pts, 6 slots).
- **Missile batteries:** sea-skimmer (4 missiles, 4.2 km, weaves at the end), supersonic (2, 3.3 km, hard to intercept), cruise (2, 7.5 km, flies high then dives).
- **Guns:** 57mm autocannon (also shoots down nearby missiles), 127mm naval gun, railgun (long, flat, slow-firing).
- **Defence:** SAM battery, CIWS, point-defence laser, decoy launcher.
- **Radar arrays:** search (5.2 km), early-warning (8 km, slow pings), fire-control (3.6 km, fast pings, identifies everything).
- **Jammer arrays:** noise jammer (narrow, 7 km), barrage jammer (wide, 4 km).
- **Submarine** hull (170 pts, 3 slots): torpedo tubes, missile batteries, decoys. Built-in sonar.
- **Undersea:** ASW torpedoes (homing, for hunting subs) and a sonar array for surface ships.
- **Hangars** (frigate/destroyer): carry your helicopter or drone design.
- **ENEMY** on the menu picks the AI fleet: Standard, Random, or Mirror (your own design). In multiplayer each player brings their own fleet.

### Radar and jamming

- Radar **pings** on a timer and shows its range. Contacts in range appear as amber **unknown** blips; close contacts are **identified**. Every ship has a short navigation radar.
- A ship with its radar on can be seen by enemies near it. Turn radar off (B) to hide — but you are blind and your SAMs stop working.
- Missiles fly to the contact and lock the ship nearest their aim point — which may be a freighter.
- **Sonar:** passive sonar hears units by their noise — fast ships are loud, submerged subs are quiet — and gives an estimated position. An active ping (P) reveals everything nearby exactly but gives you away.
- **Submarines** are invisible to radar while submerged (U to surface/dive). Torpedoes run underwater: SAMs and CIWS can't stop them, decoys can.
- **Aircraft** can be selected and ordered like ships; with no orders they orbit their carrier. Helicopters hover to dip sonar and attack submarines automatically.
- **Air wing**: up to 4 squadrons, designed in the fleet creator like ships: pick an airframe (fighter pair, attack-jet pair, patrol plane) and fill its slots with air-to-air missiles, anti-ship missiles, torpedoes, sonar, radar, AEW radar, a jammer pod, flares or drop tanks. In battle, **I / O / K / L** call them in from your edge of the map: click a patrol point, or an identified enemy ship to strike it. The AI uses its air wing too.
- **Deck aircraft**: a helicopter or drone hangar on a frigate or destroyer carries your helicopter or drone design; their loadouts are edited in the fleet creator too.
- **Islands** block radar, line of sight and sea-skimming missiles. Some always flank the control point and others form channels between the fleets. A ship within 350 m of a coast hides in radar land clutter: enemy radar detects it at half range (the card shows COAST MASK).
- **Detection**: the fleets start 12 km apart, beyond radar range. Radar sees big hulls farther than small ones (a fast attack craft at 60 % of the range a destroyer is seen at; a surfaced submarine at 45 %). Intercepting an enemy radar or jammer gives only a rough, drifting position (error up to 15 % of the distance), never an exact track.
- **Neutral traffic**: freighters enter and leave from any edge of the map. Many follow a shipping lane (not drawn on the map) that changes course at several turning points and runs through the control point. Airliners cross high overhead (air defences ignore them, but they appear as unknown radar contacts). Whales wander the area and sound like submarines on passive sonar; an active ping identifies them.
- **Jamming** is cast (J, then click): a cone that blinds enemy radars, SAMs and missile seekers inside it for a few seconds, then recharges.

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
