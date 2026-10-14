# Salvo — notes for Claude

- **Always merge finished work to `main`.** The owner has asked for every change to be merged to `main` without asking first. A push to `main` deploys to Cloudflare (https://salvo.fletchjobrien.workers.dev) through `.github/workflows/deploy.yml`.
- Before merging, run `npm test` (headless AI-vs-AI battles) and `npm run build`. Both must pass.
- The simulation (`src/sim/`) has no rendering code. Visual effects come from events in `world.events`. Multiplayer guests rebuild state from host snapshots (`src/net/net.js`), so new ship fields must go into `World.snapshot()` and `Mirror`.
- Wave math is shared by the CPU and the shader (`src/sim/waves.js`). Change waves only in `WAVES` in `src/config.js`.
