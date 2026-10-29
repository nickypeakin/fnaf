# Five Nights at Freddy's: Co-op

A browser remake of FNAF 1 that you play **together**. Up to 6 friends share the security office and try to survive until 6 AM, while Freddy, Bonnie, Chica and Foxy (all AI, using FNAF 1's rules) try to get in.

It runs entirely in the browser with no server and no install. One person hosts, gets a 5-letter room code, and everyone else joins with it. You can also play solo.

## Play

**https://nickypeakin.github.io/fnaf/**

That's the link to send your friends. The site is published by GitHub Pages from the `gh-pages` branch, so pushing a new version to `gh-pages` updates it (give it a minute).

## Playing with friends

1. The host opens the game, types a name and clicks **Host a game with friends**.
2. A room code appears (like `QCBTX`). Click **Copy invite link** and send it, or just tell people the code.
3. Friends open the link (or type the code into **Join**). Everyone who joins takes a seat on the night crew.
4. The host picks the night and length, then clicks **Start night**.

### How you work together
- **The office is shared.** The doors, the lights and the power belong to the whole team. If anyone closes the left door, it's closed for everybody.
- **Everyone has their own monitor.** Split the jobs: someone on the left door, someone on the right, someone on the cameras.
- **You can't press the door or light buttons while your monitor is up,** so the camera watcher needs teammates on the doors.
- **Call out** (`F` or the button) flashes the camera you're watching, or the door you're facing, on everyone's screen with a beep.
- **The team list** (top left) shows where everyone is looking. **Coloured dots on the camera map** show which cameras your teammates are on.
- **Bigger crews have it harder and easier:** each extra guard makes the animatronics more aggressive, but the office battery also lasts longer, up to a team of 3.
- If one person gets caught, everyone's caught. You survive together or not at all.

### Good to know
- **The host has to keep their tab open** for the whole night. If the host leaves, the room closes.
- People who join mid-night watch until the next one, then get a seat.
- Some strict school or work networks block the direct connection between players. If someone can't join, try a phone hotspot or home Wi-Fi.

## Rules & controls

Survive from 12 AM to 6 AM.

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Look left / right | Move to the screen edge (drag on touch) | |
| Left door / right door | Red buttons | `Q` / `E` |
| Left light / right light | White buttons | `A` / `D` |
| Monitor up / down | Hover or tap the bar at the bottom | `Space` |
| Change camera | Click the map | `←` / `→` |
| Call out to the team | CALL OUT button | `F` |

- Doors, lights and the cameras drain **power**. If it hits 0%, everything shuts off and Freddy comes for you.
- **Bonnie** comes down the left (west) side and **Chica** down the right (east) side. Check the lights: if one is in the doorway, shut that door until they leave.
- **Foxy** lives in Pirate Cove (CAM 1C). Watching him keeps him put. If he gets out, he sprints down the West Hall, so shut the left door fast. Each bang on the door costs power.
- **Freddy** only moves while nobody is looking at him, and laughs when he does. He sneaks in from the East Hall Corner (CAM 4B) while people are busy on their monitors.
- If an animatronic gets into the office, that side's door and light stop working, and it strikes the moment anyone is off their monitor.

### Settings
- **Night** sets how aggressive the animatronics are and how fast power drains. Survive and the next night is queued up. *Custom night* lets you set each animatronic's AI from 0 to 20.
- **Length**: Classic (~9 min, like the original), Short (6 min) or Quick (4 min).

## Running it locally

Double-click `index.html`, or serve the folder:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000.

## Tweaking the game

Gameplay numbers (power drain, team difficulty bonus, Foxy's run time and so on) live in `FN.TUNE` in `js/config.js`. The AI difficulty per night is in `FN.NIGHT_AI` in the same file.

The game screen is built from ordinary images and page elements, with no `<canvas>` or WebGL, so browser privacy and anti-fingerprinting tools that block those don't break it. Fonts are bundled too, so nothing loads from Google.

| File | What it does |
| --- | --- |
| `js/config.js` | Rooms, paths, night difficulty, tuning numbers |
| `js/layout.js` | Where everything sits on screen (shared with the image builder) |
| `js/game.js` | The night simulation (runs on the host) |
| `js/net.js` | Rooms, joining, and syncing over PeerJS |
| `js/views.js` | What guards and spectators see |
| `js/audio.js` | All the sound, synthesized in code |
| `js/main.js` | Menus, lobby, input, render loop |
| `assets/img/` | The pre-drawn images (office, cameras, animatronics) |
| `tools/` | The code that draws those images |

### Redrawing the images
The art is drawn in code (`tools/art/`), then saved as images so players' browsers never have to draw anything. After changing the art or `js/layout.js`, regenerate the images with:

```bash
npm i -D playwright && npx playwright install chromium
node tools/build-assets.js
```

### Using your own matchmaking server (optional)
Players find each other through the free public [PeerJS](https://peerjs.com/) server. If it's ever down, you can run your own ([peerjs-server](https://github.com/peers/peerjs-server)) and point the game at it with URL parameters:
`?peerhost=your.server.com&peerport=443&peerpath=/`

## Credits

Unofficial, non-commercial fan game. Not affiliated with Scott Cawthon or the Five Nights at Freddy's franchise. Every image and sound here is generated in code, and no original game assets are used. Fonts: VT323 and Archivo Black (SIL Open Font License, see `assets/fonts/`). The power-out music box plays Bizet's *Toreador Song* (public domain). Networking uses [PeerJS](https://peerjs.com/) (MIT license, see `vendor/PEERJS-LICENSE`).
