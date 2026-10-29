# Five Nights at Freddy's: Multiplayer

A browser remake of FNAF 1 with a twist: **your friends can play the animatronics.**

- **1 guard vs. the AI:** classic FNAF 1, Nights 1–6 plus a custom night.
- **2 guards (co-op):** share the office. One watches the cameras while the other works the doors.
- **Guards vs. players:** up to four friends take Freddy, Bonnie, Chica and Foxy and hunt the guard. Any animatronic nobody picks is run by the AI.

It runs entirely in the browser with no server and no install. One person hosts, gets a 5-letter room code, and everyone else joins with it.

## Putting it online (one-time setup)

The game is a static website, so GitHub Pages can host it for free:

1. On GitHub, open this repo and go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
3. Pick the branch with the game on it and the **/ (root)** folder, then **Save**.
4. After a minute or two the game is live at `https://<your-username>.github.io/fnaf/`.

Send that link to your friends. Everyone opens the same link.

## Playing with friends

1. The host opens the game, types a name and clicks **Host online game**.
2. A room code appears (like `QCBTX`). Click **Copy invite link** and send it, or just tell people the code.
3. Friends open the link (or type the code into **Join**).
4. Everyone clicks a role card: **Night Guard** (max 2), **Bonnie**, **Chica**, **Foxy**, **Freddy**, or **Spectate**.
5. The host picks the night and length, then clicks **Start night**.

### How the multiplayer works

The host's browser runs the actual game. Everyone else connects straight to the host, peer-to-peer over WebRTC, using [PeerJS](https://peerjs.com/) and its free public matchmaking server to find each other. Because of that:

- **The host has to keep their tab open** for the whole night. If the host leaves, the room closes.
- If a player drops out mid-night, the AI takes over their animatronic.
- People who join mid-night spectate until the next one.
- Some strict school or work networks block peer-to-peer connections. If someone can't join, try a phone hotspot or home Wi-Fi.

## Rules

### Night guard
Survive from 12 AM to 6 AM.

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Look left / right | Move to the screen edge (drag on touch) | |
| Left door / right door | Red buttons | `Q` / `E` |
| Left light / right light | White buttons | `A` / `D` |
| Monitor up / down | Hover or tap the bar at the bottom | `Space` |
| Change camera | Click the map | `←` / `→` |

Doors, lights and the monitor all drain **power**. If it hits 0% everything shuts off and Freddy comes for you. If an animatronic gets into the office, that side's door and light stop working, and the moment you look up from the monitor, it's over.

### Animatronics (when played by people)
- Click a **green room** on the map to move. Each move has a cooldown.
- **Yellow dashed outlines** show which cameras the guards are watching. A big **eye** means they're looking at *you*.
- **Bonnie** (west side) and **Chica** (east side): reach your doorway, wait a few seconds, then **Sneak in** if the door is open. If the guard keeps the door shut on you for 4 seconds, you're sent back.
- **Freddy**: can only move while nobody is watching him. From the East Hall Corner he can slip into the office, but only while every guard is busy on the monitor.
- **Foxy**: **Creep out** of Pirate Cove twice while nobody is watching, then **Run!** An open left door is a kill. A shut one costs the guard power.
- **Jam camera** (`J`): fills your camera with static for 5 seconds, so you can't be seen and count as unwatched.

### Settings
- **Night** sets how aggressive the AI animatronics are (and how fast power drains). Survive and the next night is queued up.
- **Length**: Classic (~9 min, like the original), Short (6 min) or Quick (4 min).
- **Player animatronic speed**: *Auto* slows human animatronics down when they outnumber the guards. Use Slow, Normal or Fast to tune it yourself.

## Running it locally

Double-click `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

## Tweaking the game

Almost every gameplay number (cooldowns, power drain, how long doors take to push animatronics back, Foxy's run time, and so on) is in `FN.TUNE` at the bottom of `js/config.js`. The AI difficulty per night is in `FN.NIGHT_AI` in the same file.

| File | What it does |
| --- | --- |
| `js/config.js` | Rooms, paths, night difficulty, tuning numbers |
| `js/game.js` | The night simulation (runs on the host) |
| `js/net.js` | Rooms, joining, and syncing over PeerJS |
| `js/views.js` | What the guard, animatronic and spectator players see |
| `js/art-chars.js`, `js/art-scenes.js` | All the art, drawn in code |
| `js/audio.js` | All the sound, synthesized in code |
| `js/main.js` | Menus, lobby, input, render loop |

### Using your own matchmaking server (optional)
If the public PeerJS server is ever down, you can run your own ([peerjs-server](https://github.com/peers/peerjs-server)) and point the game at it with URL parameters:
`?peerhost=your.server.com&peerport=443&peerpath=/`

## Credits

Unofficial, non-commercial fan game. Not affiliated with Scott Cawthon or the Five Nights at Freddy's franchise. Every image and sound here is generated in code, and no original game assets are used. The power-out music box plays Bizet's *Toreador Song* (public domain). Networking uses [PeerJS](https://peerjs.com/) (MIT license, see `vendor/PEERJS-LICENSE`).
