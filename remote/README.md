# Phone access: remote.loom.baby

The page a linked phone opens, and the relay that connects it to Loom on the PC. Both run as one Cloudflare Worker on the Free plan.

| Folder | What it is |
| --- | --- |
| `app/` | The phone page: React, built by Vite into `dist/` |
| `worker/` | The relay: a Worker that hands each Loom install's connections to a Durable Object |
| `public/` | Files served as they are: the icon, the web app manifest, the security headers |
| `../src/shared/remote.ts` | The messages and the encryption, shared with Loom itself |

Loom's side is `src/main/remote.ts` (the connection, the linked phones, what a phone may ask for) and `src/renderer/src/remoteAgent.ts` (what a window sends a phone about the chats it shows).

## How it works

Loom and the phone both connect out to the relay over WebSocket, to a room named by a random id that belongs to that Loom install. The relay passes messages between the PC and its phones. It never sees what they say.

- **Linking.** Loom shows a QR code for `remote.loom.baby/#r=<room>&s=<secret>`. The part after `#` stays in the phone's browser. Phone and PC each make a key pair, swap public keys sealed with a key made from the secret, and work out the phone's key from both. A code links one phone and lasts five minutes. Scanning it only asks: Loom shows a dialog on the PC with the phone's name and four digits worked out from the phone's key, the phone shows the same digits, and the phone is linked when someone at the PC allows it. A device that isn't yours shows up with a name and digits that don't match your phone. The page can also read the code itself (Scan the code, which uses the camera through a small QR reader fetched on demand): a copy of the page on an iPhone's Home Screen has storage apart from Safari's, and the Camera app would open the code in Safari.
- **Every message** after that is sealed with AES-256-GCM under the phone's key. The phone keeps that key in IndexedDB as a key it can use but not read back. The PC keeps it in `%APPDATA%\Loom\remote.json`, encrypted for the Windows account.
- **Each connection** starts with a random number from the phone, which Loom answers with a fresh session id. Messages carry the session id and a count that only goes up, so a recorded message sent again is dropped.
- **The relay knows** the room id, the phones' ids, and how big and how often messages are. It lets one PC own a room (the first to sign in with the room's key) and takes phone connections only from this page's own origin.

The relay uses Durable Objects with WebSocket hibernation: a room with nothing to pass along is put away while its connections stay open, and Loom's keep-alive pings are answered without waking it.

## Run it locally

```
npm run remote:dev        # builds the page, then serves page and relay on http://127.0.0.1:8787
```

Point a Loom at it with `LOOM_REMOTE_URL=http://127.0.0.1:8787` (and `LOOM_USER_DATA=<folder>` for a scratch profile), link a phone in Settings, Phone access, and open the link it shows in a browser on the same PC.

```
npm run remote:typecheck  # generates the Worker's types, then checks the Worker and the page
```

## Deploy

```
npx wrangler login        # once, with the Cloudflare account that has the loom.baby zone
npm run remote:deploy
```

`wrangler.jsonc` routes the Worker to `remote.loom.baby` as a custom domain, so the first deploy also creates its DNS record and certificate. The Durable Object class is SQLite-backed, the kind the Free plan includes.

The page and Loom have to speak the same version of the protocol (`REMOTE_VERSION` in `src/shared/remote.ts`); linking refuses a pair that doesn't. When that number changes, deploy the Worker and release Loom together.

## What the Free plan allows

Per day: 100,000 Worker requests, 100,000 Durable Object requests (incoming WebSocket messages count 20 to 1) and 13,000 GB-seconds of Durable Object time. A room only uses time while messages flow, about 0.13 GB-seconds per second, so the daily allowance is roughly 28 hours of phones actively watching chats, summed over every Loom user. Past that, requests fail until midnight UTC; the Workers Paid plan ($5 a month) lifts the limits.
