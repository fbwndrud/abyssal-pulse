# Neon Pulse — Audio Credits

All included audio is licensed under **Creative Commons Zero (CC0 1.0 Universal)** — public domain, no attribution legally required, but acknowledged here as a courtesy to the creators.

## Music (BGM)

| File | Source | Artist | License |
|---|---|---|---|
| `main_low.ogg` | OpenGameArt — Cyberpunk Pack 2 | Trevor Lentz (T&T) | CC0 |
| `main_high.ogg` | OpenGameArt — Cyberpunk Pack 2 | Trevor Lentz (T&T) | CC0 |
| `boss.ogg` | OpenGameArt — Cyberpunk Pack 2 | Trevor Lentz (T&T) | CC0 |
| `menu.ogg` | OpenGameArt — Calm Ambient series | cynicmusic | CC0 |

## Sound Effects

| File | Source | License |
|---|---|---|
| `sfx_explosion.ogg` | Kenney.nl — Sci-Fi Sounds | CC0 |
| `sfx_shield.ogg` | Kenney.nl — Sci-Fi Sounds | CC0 |
| `sfx_ui.ogg` | Kenney.nl — Interface Sounds | CC0 |
| `sfx_levelup.ogg` | Kenney.nl — Sci-Fi Sounds | CC0 |
| `sfx_bosslaser.ogg` | Kenney.nl — Sci-Fi Sounds | CC0 |

Other SFX (shoot, hit, pickup, blip, damage, heal, freeze, etc.) are generated procedurally at runtime via the Web Audio API — no external files, no licensing concerns.

## Processing Notes

Source files were re-encoded to Ogg Vorbis and peak-normalized to −6 dBFS before bundling. The in-game mastering chain (pre-master → 22 Hz high-pass → glue compressor → brickwall limiter) handles final loudness; individual stems were *not* loudness-normalized so the mixer has clean headroom to work with.
