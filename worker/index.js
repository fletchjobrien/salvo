// Salvo — Cloudflare Worker entry.
// Static assets (the built game in ./dist) are served by the assets binding.
// Multiplayer uses one Durable Object per room. The DO is a thin relay:
// the host runs the authoritative simulation and the guest sends commands.

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (const b of bytes) s += CODE_CHARS[b % CODE_CHARS.length];
  return s;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') return json({ ok: true });

    if (url.pathname === '/api/room/new') return json({ code: makeCode() });

    const m = url.pathname.match(/^\/api\/room\/([A-Z0-9]{4})\/ws$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const id = env.ROOMS.idFromName(m[1]);
      return env.ROOMS.get(id).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);

    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
    const sockets = this.ctx.getWebSockets();
    const roles = sockets.map((ws) => ws.deserializeAttachment()?.role);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role });

    let error = null;
    if (role === 'host' && roles.includes('host')) error = 'Room code already in use';
    if (role === 'guest' && !roles.includes('host')) error = 'No game is hosted with that code';
    if (role === 'guest' && roles.includes('guest')) error = 'That game is already full';

    if (error) {
      server.send(JSON.stringify({ t: 'error', message: error }));
      server.close(4000, error);
    } else {
      server.send(JSON.stringify({ t: 'hello', role }));
      if (role === 'guest') this.broadcast(server, JSON.stringify({ t: 'peer', joined: true }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(from, message) {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === from) continue;
      try {
        ws.send(message);
      } catch {
        // Socket already closing; ignore.
      }
    }
  }

  async webSocketMessage(ws, message) {
    // Relay verbatim to the other player.
    this.broadcast(ws, message);
  }

  async webSocketClose(ws, code) {
    this.broadcast(ws, JSON.stringify({ t: 'peer', joined: false }));
    try {
      ws.close(code === 1005 ? 1000 : code, 'closed');
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws) {
    this.broadcast(ws, JSON.stringify({ t: 'peer', joined: false }));
  }
}
