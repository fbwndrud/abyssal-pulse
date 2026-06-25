# Abyssal Pulse — Audio Credits

This audio pass replaces the previous cyberpunk/sci-fi sources with licensed dark fantasy music and fantasy RPG sound effects. Files were re-encoded to Ogg Vorbis for browser delivery and loudness-managed with `ffmpeg`.

## Music

| Game file | Source | Artist | License | Processing |
|---|---|---|---|---|
| `menu.ogg` | OpenGameArt — [Dark Dungeon Ambience](https://opengameart.org/content/dark-dungeon-ambience) | Machine | CC-BY 3.0 | Re-encoded from `dark_dungeon_ambience_0.mp3` |
| `main_low.ogg` | OpenGameArt — [Dark Quest](https://opengameart.org/content/dark-quest) | Alexandr Zhelanov | CC-BY 4.0 | Re-encoded from `Dark Quest.ogg` |
| `main_high.ogg` | OpenGameArt — [A Darkness Opus](https://opengameart.org/content/a-darkness-opus) | Alexandr Zhelanov | OGA-BY 3.0 | 180-second gameplay excerpt, re-encoded |
| `ai_fight.ogg` | OpenGameArt — [A Darkness Opus](https://opengameart.org/content/a-darkness-opus) | Alexandr Zhelanov | OGA-BY 3.0 | Alternate 180-second excerpt, re-encoded |
| `boss.ogg` | OpenGameArt — [Dark souls type boss theme](https://opengameart.org/content/dark-souls-type-boss-theme) | ProjectHelmet / Philémon Weber (Helmet) | CC-BY 4.0 | Re-encoded from MP3 |

## Sound Effects

All bundled SFX below come from OpenGameArt — [JC Sounds - Fantasy SFX Pack Vol 1](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1), by JC Sounds, licensed CC-BY 4.0. Attribution notice from the source page: `CC BY 4.0 - Credit: JC Sounds`.

| Game file | Source file |
|---|---|
| `sfx_explosion.ogg` | `Single_Fantasy SFX Pack Vol 1_Fireball Impact_03.wav` |
| `sfx_shield.ogg` | `Single_Fantasy SFX Pack Vol 1_Magic Shield_Activation_02.wav` |
| `sfx_ui.ogg` | `Single_Fantasy SFX Pack Vol 1_Dagger_Hit_Metal_02.wav` |
| `sfx_levelup.ogg` | `Single_Fantasy SFX Pack Vol 1_Healing Chime_02.wav` |
| `sfx_bosslaser.ogg` | `Seq_Fantasy SFX Pack Vol 1_Mana Drain_Start.wav` |
| `sfx_shoot.ogg` | `Single_Fantasy SFX Pack Vol 1_Bow_Arrow_Shoot_02.wav` |
| `sfx_hit.ogg` | `Single_Fantasy SFX Pack Vol 1_Heavy Sword_Hit_Metal_01.wav` |
| `sfx_pickup.ogg` | `Single_Fantasy SFX Pack Vol 1_Healing Chime_01.wav` |
| `sfx_damage.ogg` | `Single_Fantasy SFX Pack Vol 1_Heavy Sword_Hit_Metal_03.wav` |
| `sfx_heal.ogg` | `Single_Fantasy SFX Pack Vol 1_Healing Chime_02.wav` |
| `sfx_freeze.ogg` | `Single_Fantasy SFX Pack Vol 1_Ice Shard  Projectile_Impact_03.wav` |
| `sfx_laser.ogg` | `Single_Fantasy SFX Pack Vol 1_Electric Spell_Hit_03.wav` |
| `sfx_blip.ogg` | `Single_Fantasy SFX Pack Vol 1_Dagger_Hit_Metal_01.wav` |

## Runtime Fallbacks

`js/audio.js` still contains small Web Audio fallback generators for rare missing-file cases and transition accents, but normal gameplay now uses the external music/SFX files listed above.
