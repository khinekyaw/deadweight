# Deadweight: self-hosted

A physics FPS (three.js + Rapier) with WebSocket multiplayer. This folder is everything
your server needs: `server.js` serves the game from `public/` and relays multiplayer
traffic on `/ws`. No database, no CDN, one dependency (`ws`).

## Run it

Needs Node.js 18 or newer.

```bash
npm install
npm start                 # http://localhost:8080
PORT=3000 npm start       # another port
```

Open the address in a browser. Everyone on the same server who types the same **Room**
code (default `public`) plays together. When nobody else is in your room, a bot plays
against you.

### Docker

```bash
docker build -t deadweight .
docker run -d --restart unless-stopped -p 8080:8080 --name deadweight deadweight
```

### On a VPS with a domain (HTTPS)

1. Copy this folder to `/opt/deadweight` and run `npm install --omit=dev` there.
2. Copy `deadweight.service` to `/etc/systemd/system/`, then `systemctl enable --now deadweight`.
3. Put nginx in front using `nginx-example.conf` (the `/ws` block forwards the WebSocket
   upgrade), and get a certificate with `certbot --nginx -d game.example.com`.

On an HTTPS page the game connects with `wss://` automatically. Use HTTPS for anything
public.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | HTTP and WebSocket port |
| `MAX_PER_ROOM` | 16 | Players allowed in one room |

`GET /healthz` returns `ok` for uptime checks.

## Notes

- **Hits are decided by the shooter's browser.** It feels responsive, but a modified
  client can cheat. Fine for friends; for a public server, hit checks would need to move
  to the server.
- The server rate-limits each connection (40 messages/s, burst 80) and caps each message
  at 4 KB.
- To change the game, edit `source-index.html`, then run once
  `npm install esbuild three@0.186.1 @dimforge/rapier3d-compat@0.21.0` and after that
  `node build.mjs`. It bundles the game with three.js and Rapier into `public/game.js`.

## Credits

- "Ak47" rig by kursat_sokmen, CC BY 4.0 (https://skfb.ly/6UEL9), textures recoloured.
- Soldier: three.js example model, character and animations from Mixamo.
- Other weapons, the map and its textures: made for this game.
- three.js (MIT), Rapier (Apache 2.0), ws (MIT).
