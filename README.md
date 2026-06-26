# Abyssal Pulse

A dark gothic horde-survivor roguelite. Survive a 15-minute abyssal rift, draft skills and virtues, awaken rune evolutions, defeat abyss bosses, and collect relic drops.

## Play

- Repository: https://github.com/fbwndrud/abyssal-pulse
- Public GitHub Pages URL: https://fbwndrud.github.io/abyssal-pulse/
- Local URL after starting a server: http://localhost:8000/

## Run Locally

```bash
npm start
```

Then open `http://localhost:8000/`.

You can also run:

```bash
python3 -m http.server 8000
```

## Controls

- `WASD` or arrow keys: move
- Touch and drag on mobile: analog movement
- `Space`: pause
- `M`: mute

## Current Direction

The game keeps the original horde-survivor roguelite loop while shifting the fantasy to a dark gothic looter ARPG:

- Exile classes with generated gothic class portraits and distinct starting skills
- Generated gothic PNG sprites for Rift Warden, Blood Seer, Grave Bulwark, Iron Exile, Hex Witch, Hollow Imp, Grave Brute, Ashen Butcher, Bone Shards, Hellfire Cross, and Spectral Blades
- Procedural dungeon floor maps for Ruined Nave, Bone Crypt, and Hellforge Rift
- Gothic altar-style skill selection cards with generated skill medallion art and matching dark sanctuary overlays
- Diablo-like skill mechanics: consecrated ground, piercing lances, rune wards, bone bleed, hellfire fissures, grave aftershocks, hex death bursts, returning spectral blades, abyss wells, and soul-prism splits
- Rune awakenings and legendary skill awakenings
- Relic, rune, and cursed altar progression
- Elite affix monsters such as Molten, Frostbound, and Void-Touched
- Time-based dungeon biomes: Ruined Nave, Bone Crypt, and Hellforge Rift
- Licensed dark fantasy BGM from OpenGameArt and JC Sounds fantasy SFX
- Mobile-optimized skill and level-up selection surfaces
- Smoother movement feel with acceleration, camera look-ahead, speed-based trails, and runtime walk-frame textures

See [DIABLO_STYLE_REDESIGN.md](DIABLO_STYLE_REDESIGN.md) for the full redesign plan.

## Audio Credits

Music and SFX attribution is tracked in [audio/CREDITS.md](audio/CREDITS.md). The current audio pass uses:

- `Dark Quest`
- `A Darkness Opus`
- `Dark Dungeon Ambience`
- `Dark souls type boss theme`
- `JC Sounds - Fantasy SFX Pack Vol 1`
