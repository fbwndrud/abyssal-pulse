# 어비스 펄스 — 오디오 크레딧

이번 오디오 패스는 기존 사이버펑크/공상과학 계열 소스를 라이선스가 확인된 다크 판타지 음악과 판타지 RPG 효과음으로 교체했습니다. 브라우저 전달을 위해 파일은 Ogg Vorbis로 다시 인코딩했고, `ffmpeg`로 음량을 정리했습니다.

## 음악

| 게임 파일 | 출처 | 아티스트 | 라이선스 | 처리 |
|---|---|---|---|---|
| `menu.ogg` | OpenGameArt — [Dark Dungeon Ambience](https://opengameart.org/content/dark-dungeon-ambience) | Machine | CC-BY 3.0 | `dark_dungeon_ambience_0.mp3`에서 재인코딩 |
| `main_low.ogg` | OpenGameArt — [Dark Quest](https://opengameart.org/content/dark-quest) | Alexandr Zhelanov | CC-BY 4.0 | `Dark Quest.ogg`에서 재인코딩 |
| `main_high.ogg` | OpenGameArt — [A Darkness Opus](https://opengameart.org/content/a-darkness-opus) | Alexandr Zhelanov | OGA-BY 3.0 | 180초 게임플레이 구간 추출 후 재인코딩 |
| `ai_fight.ogg` | OpenGameArt — [A Darkness Opus](https://opengameart.org/content/a-darkness-opus) | Alexandr Zhelanov | OGA-BY 3.0 | 다른 180초 구간 추출 후 재인코딩 |
| `boss.ogg` | OpenGameArt — [Dark souls type boss theme](https://opengameart.org/content/dark-souls-type-boss-theme) | ProjectHelmet / Philémon Weber (Helmet) | CC-BY 4.0 | MP3에서 재인코딩 |

## 효과음

아래 효과음은 모두 OpenGameArt — [JC Sounds - Fantasy SFX Pack Vol 1](https://opengameart.org/content/jc-sounds-fantasy-sfx-pack-vol-1)에서 가져왔습니다. 제작자는 JC Sounds이며 라이선스는 CC-BY 4.0입니다. 원 출처의 표기 문구는 `CC BY 4.0 - Credit: JC Sounds`입니다.

| 게임 파일 | 원본 파일 |
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

## 런타임 폴백

`js/audio.js`에는 파일 누락 같은 예외 상황과 전환 강조음에 쓰는 작은 Web Audio 폴백 생성기가 남아 있습니다. 일반 플레이에서는 위에 적은 외부 음악/효과음 파일을 사용합니다.
