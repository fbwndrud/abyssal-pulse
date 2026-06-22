# Neon Pulse Diablo-Like Redesign Plan

> 목표: 기존 호드 서바이버/로그라이트 뼈대는 유지하면서, 체감은 다크 고딕 루터 ARPG처럼 바꾼다.
> 기준 코드: `index.html`, `js/core.js`, `js/data.js`, `js/player.js`, `js/entities.js`, `js/gameloop.js`, `js/render.js`, `js/ui.js`

---

## 1. 한 줄 컨셉

**Neon Pulse: Abyssal Rift**

플레이어는 네온 벡터가 아니라, 심연 균열에 들어간 추방자다. 15분 동안 몰려오는 악마 군단을 버티며 장비, 룬, 저주받은 제단, 보스 글리프를 모으고, 런이 끝나면 금고와 룬 장착으로 다음 원정을 강화한다.

핵심은 디아블로를 그대로 복제하는 것이 아니라, 다음 네 가지 감각을 현재 게임에 이식하는 것이다.

- 적을 녹이면 바닥에 보상이 터지는 드랍 쾌감
- 레어도 색상, 접사, 룬, 보스 보상으로 빌드가 굴러가는 느낌
- 성당, 지하묘지, 지옥 대장간 같은 어두운 던전 분위기
- 엘리트 몬스터와 보스가 짧고 강한 위협을 만드는 템포

### 2026-06-23 아트 적용 상태

- `RIFT WARDEN`, `HOLLOW IMP`, `GRAVE BRUTE`, `ASHEN BUTCHER`를 생성형 투명 PNG 스프라이트로 교체
- `Bone Shards`, `Hellfire Cross`, `Spectral Blades` 투사체 PNG 적용
- PixiJS 렌더러는 PNG 에셋 우선, 기존 도형 텍스처 폴백 구조 유지
- 후속 P1: `BLOOD SEER`, `GRAVE BULWARK`, `IRON EXILE`, `HEX WITCH`, 나머지 일반 적과 보스 이미지 확장

---

## 2. 유지할 뼈대

현재 구조에서 유지할 것:

- `15:00` 런 생존 구조
- WASD 이동 + 자동 공격
- 레벨업 3장 카드 선택
- 무기 레벨업, 패시브, 진화, 융합
- 보스 처치 후 글리프 선택
- 유물/소모품 드랍
- 코어 재화와 메타 강화
- PixiJS 렌더 계층과 HTML 오버레이 UI

바꿀 것:

- 네온 사이버 팔레트 중심 UI를 어두운 성역, 피, 금속, 뼈, 영혼빛 팔레트로 전환
- 클래스/적/무기/아이템 이름을 다크 판타지 역할로 재명명
- 아이템 드랍과 레어도 표현을 화면 전면에 올림
- 일반 몬스터 무리 안에 엘리트 접사 몬스터를 섞음
- 보스가 단순 타이머 이벤트가 아니라 던전 층의 관문처럼 느껴지게 연출

---

## 3. 장르 전환 원칙

### 로그라이크성은 유지

런마다 무기, 패시브, 유물, 글리프, 제단 선택이 달라져야 한다. 영구 장비를 너무 강하게 만들면 런 빌드가 죽으므로, 영구 성장과 런 중 빌드의 비율은 다음처럼 잡는다.

- 런 중 선택: 전투력의 70%
- 영구 성장: 전투력의 20%
- 플레이어 숙련도: 전투력의 10%

### 루터 ARPG성은 강화

현재도 `ITEMS`, `GLYPHS`, `CHIPS`, `SHRINES`가 있으므로 새 시스템을 크게 만들기보다 역할을 재정의한다.

| 현재 시스템 | 새 역할 | 설명 |
|---|---|---|
| `ITEMS` | 런 중 드랍 장비/소모품 | 몹, 엘리트, 보스가 떨어뜨리는 순간 보상 |
| `GLYPHS` | 보스 룬 | 보스 처치 후 1 of 3 선택, 런 한정 강력 보정 |
| `CHIPS` | 영구 룬/보석 | 메타 장착 시스템. 이름과 UI를 룬 소켓으로 변경 |
| `SHRINES` | 저주받은 제단 | 코어를 내고 강력한 런 한정 계약을 받음 |
| `SHOP_ITEMS` | 대장장이/성소 강화 | 기존 메타 상점의 다크 판타지 스킨 |

---

## 4. 세계관 리스킨

### 무대

세계는 `The Signal Cathedral`이라는 붕괴한 네온 성역이다. 신성한 회로와 지옥의 균열이 섞여 있어, 기존 네온 정체성을 완전히 버리지 않고 다크 판타지로 연결한다.

3개 구역을 런 시간에 따라 전환한다.

| 시간 | 구역 | 체감 |
|---|---|---|
| 00:00-05:00 | Ruined Nave | 무너진 성당, 촛불, 스테인드글라스 파편 |
| 05:00-10:00 | Bone Crypt | 뼈 지하묘지, 푸른 영혼불, 좁아지는 압박 |
| 10:00-15:00 | Hellforge Rift | 용암 균열, 쇳가루, 붉은 재, 보스 압박 |

### 클래스 리네임

기존 shape 클래스는 성능과 시작 무기를 유지하고 이름/판타지만 바꾼다.

| 기존 | 새 이름 | 역할 |
|---|---|---|
| `CIRCLE` | Rift Warden | 균형형 성기사. 신성 폭발 시작 |
| `TRIANGLE` | Blood Seer | 빠른 사도. 회전 광선 시작 |
| `HEXAGON` | Grave Bulwark | 탱커. 수호 룬 시작 |
| `SQUARE` | Iron Exile | 중장 전사. 전방 충격파 시작 |
| `STAR` | Hex Witch | 사술사. 번개 저주 시작 |

---

## 5. 전투 시스템 기획

### 무기 리네임

초기에는 로직을 바꾸지 않고 표시명과 이펙트 색부터 바꾼다.

| 기존 무기 | 새 이름 | 판타지 |
|---|---|---|
| `PULSE` | Sanctified Nova | 주변을 정화하는 신성 파동 |
| `BEAM` | Seraph Lance | 몸 주위를 도는 천상 광선 |
| `ORBIT` | Runic Aegis | 궤도 수호 룬 |
| `HOMING` | Bone Shards | 적을 추적하는 뼈 파편 |
| `CROSS` | Hellfire Cross | 사방으로 갈라지는 지옥불 |
| `SHOCK` | Grave Cleave | 전방을 베는 묘지의 충격파 |
| `CHAIN` | Hex Lightning | 적을 잇는 저주 번개 |
| `BLADE` | Spectral Blades | 관통하는 망령 칼날 |
| `BLACKHOLE` | Abyss Well | 적을 빨아들이는 심연 구멍 |
| `PRISM` | Soul Prism | 영혼 결정 파편 |

### 패시브 리네임

| 기존 | 새 이름 |
|---|---|
| `POWER` | Wrath |
| `HASTE` | Fleet |
| `CADENCE` | Zeal |
| `REACH` | Dominion |
| `ARMOR` | Iron Skin |
| `SOUL` | Vitality |
| `MAGNET` | Greed |
| `LUCK` | Fortune |

### 진화/융합

기존 자동 진화와 융합은 이 게임의 강점이다. 이를 `Skill Rune`과 `Legendary Awakening`으로 표현한다.

- 무기 만렙 + 패시브 만렙: 스킬 룬 각성
- 진화 무기 2개 만렙: 전설 각성
- 우측 진행 패널: `EVOLVE/FUSE`에서 `RUNE/AWAKENING`으로 리스킨

---

## 6. 루트 시스템 설계

### 드랍 레어도

현재 `common`, `rare`, `legendary`에 `epic`을 추가하는 것을 권장한다.

| 등급 | 색 | 역할 |
|---|---|---|
| Common | bone white | 소소한 생존/회복 |
| Rare | soul blue | 빌드 방향을 살짝 바꿈 |
| Epic | violet | 특정 무기/상태와 강한 시너지 |
| Legendary | infernal gold | 플레이 스타일을 바꾸는 효과 |

### 접사 방식

1차 MVP에서는 완전 랜덤 아이템명 생성보다, 고정 유물 + 접사 1개를 붙이는 방식이 좋다.

예시:

- `Vampiric Bone Charm`: 처치 회복 + 특정 확률로 피폭발
- `Molten Prism Lens`: 범위 증가 + 적 사망 시 작은 화염 장판
- `Zealous Iron Plate`: 방어 증가 + 쿨감 소폭 증가
- `Greedy Grave Coil`: 픽업 범위 증가 + 코어 획득 증가

구현 방식:

- `ITEMS`는 베이스 유물 정의
- `AFFIXES` 새 테이블 추가
- 드랍 시 `{ baseId, affixId, tier }`를 item entity에 저장
- `applyItem`에서 베이스 효과와 접사 효과를 모두 적용

### 드랍 빔

루터 ARPG 감성은 아이템 자체보다 바닥의 빛기둥이 더 중요하다.

MVP에서 추가할 연출:

- Rare 이상 아이템은 수직 빛기둥
- Legendary는 화면 흔들림 + 짧은 사운드 + 텍스트 배너
- 보스 체스트는 즉시 열리는 카드 선택 대신, 바닥에 떨어진 보물상자 느낌을 강화

---

## 7. 엘리트 몬스터

현재 적 종류를 늘리기보다 기존 적에 `eliteAffix`를 붙인다. 2분 이후 3-8% 확률로 등장하게 한다.

| 접사 | 효과 | 시각 |
|---|---|---|
| Molten | 사망 시 화염 폭발 장판 | 붉은 발광 테두리 |
| Frostbound | 근처 플레이어 둔화 | 푸른 서리 오라 |
| Vampiric | 타격 시 회복 | 어두운 붉은 흡혈선 |
| Plague | 주변 독 피해 오라 | 녹색 연기 링 |
| Ironhide | 피해 감소, 느림 | 금속성 외곽선 |
| Stormcaller | 주기적 번개 탄 | 노란 전기 스파크 |
| Void-Touched | 사망 시 작은 흡입장 | 보라색 균열 |

코드 포인트:

- `js/data.js`: `ELITE_AFFIXES` 추가
- `js/entities.js`: `spawnEnemy`에서 확률로 affix 부여
- `js/gameloop.js`: `updateEnemy` 끝부분에서 affix tick 처리
- `js/entities.js`: `killEnemy` 또는 kill hook에서 onDeath 처리

---

## 8. 보스 리디자인

기존 보스 4개는 패턴을 유지하고 이름/연출을 바꾼다.

| 기존 | 새 보스 | 역할 |
|---|---|---|
| `RING_LORD` | The Bell Prior | 탄환 링, 성당 첫 관문 |
| `SPIKE_KING` | Ashen Butcher | 돌진/가시 탄막, 근접 압박 |
| `HYDRA` | Bone Hydra Matron | 소환형, 잡몹 압력 |
| `PRISMA` | Void Seraph | 광선/탄막 혼합 최종 관문 |

보스 보상:

- 보스 처치 즉시 `GLYPH` 선택
- 바닥에 `Relic Chest` 드랍
- 10분 이후 보스는 `Epic` 이상 보정

---

## 9. UI 리디자인

### 화면 톤

현재 색감은 밝은 사이버 네온이다. 새 톤은 다음 팔레트로 이동한다.

```css
--bg: #070504;
--bg2: #120b0a;
--blood: #b8182f;
--ember: #f06a24;
--infernal-gold: #d6a84f;
--bone: #d8c7a1;
--soul-blue: #49c7ff;
--void-violet: #7f4dd8;
--poison: #8bdc53;
--iron: #4b4a46;
```

### 메뉴

- `NEON PULSE`는 유지하거나 `ABYSSAL PULSE`로 시즌명 추가
- `VECTOR ROGUELIKE`를 `DARK LOOT ROGUELITE`로 변경
- `ARSENAL SHOP`을 `BLACKSMITH`
- `CHIPSET LAB`을 `RUNE SOCKETS`
- `CODEX`를 `BESTIARY`

### 카드

레벨업 카드는 기존 모달 구조를 유지하되, 카드 프레임만 다음처럼 변경한다.

- Common: 뼈/양피지 프레임
- Rare: 푸른 영혼불 프레임
- Epic: 보라 균열 프레임
- Legendary: 금속 + 용암 균열 프레임

---

## 10. 이미지 생성 계획

1차는 게임에 바로 넣기 쉬운 배경/보스 초상/카드 프레임부터 만든다. 월드 내 몬스터는 현재 도형 렌더를 유지하고, 엘리트 오라와 색상으로 디아블로풍을 먼저 낸다.

### 우선 생성 에셋

생성 완료:

- `assets/concept/abyssal-rift-keyart.png`

| 파일 | 용도 | 우선순위 |
|---|---|---|
| `assets/concept/abyssal-rift-keyart.png` | 메뉴/기획 기준 이미지 | P0 |
| `assets/bg/ruined-nave.png` | 0-5분 배경 텍스처 | P1 |
| `assets/bg/bone-crypt.png` | 5-10분 배경 텍스처 | P1 |
| `assets/bg/hellforge-rift.png` | 10-15분 배경 텍스처 | P1 |
| `assets/boss/bell-prior.png` | 보스 배너 초상 | P2 |
| `assets/boss/ashen-butcher.png` | 보스 배너 초상 | P2 |
| `assets/boss/bone-hydra-matron.png` | 보스 배너 초상 | P2 |
| `assets/boss/void-seraph.png` | 보스 배너 초상 | P2 |
| `assets/ui/card-frame-rare.png` | 카드 프레임 텍스처 | P2 |
| `assets/ui/card-frame-legendary.png` | 카드 프레임 텍스처 | P2 |

### 공통 이미지 프롬프트 규칙

저작권/상표를 피하기 위해 프롬프트에는 특정 게임명, 특정 캐릭터, 특정 로고를 쓰지 않는다. 방향은 “dark gothic looter ARPG”, “infernal cathedral”, “isometric game art”로 잡는다.

### P0 키아트 프롬프트

```text
Use case: stylized-concept
Asset type: game key art for main menu and visual direction
Primary request: dark gothic looter ARPG key art for "Neon Pulse: Abyssal Rift"
Scene/backdrop: ruined cathedral fused with glowing arcane circuitry, cracked stone floor, infernal rift opening in the nave, drifting ash and ember particles
Subject: a lone armored exile seen from behind, holding a radiant rune weapon, surrounded by faint geometric neon sigils
Style/medium: polished stylized game concept art, high-detail painterly illustration, not photoreal
Composition/framing: wide 16:9 composition, central character small against massive cathedral architecture, space in upper center for title UI
Lighting/mood: ominous, crimson hellfire from below, cold blue soul light from stained glass, high contrast
Color palette: blood red, ember orange, antique gold, bone white, soul blue, void violet
Constraints: no logos, no existing franchise characters, no readable text, no watermark
Avoid: cartoon style, cute characters, sci-fi spaceship, modern city, direct imitation of any existing game artwork
```

### 배경 프롬프트 템플릿

```text
Use case: stylized-concept
Asset type: seamless-ish game background texture for a 2D top-down action roguelite
Primary request: <zone name>
Scene/backdrop: <zone-specific environment>
Subject: no characters, no UI, only environment texture and atmospheric details
Style/medium: stylized dark gothic fantasy game art, painterly but readable under gameplay
Composition/framing: top-down/isometric hybrid floor-focused view, 16:9, edges can be tiled or cropped
Lighting/mood: dark but playable, strong silhouettes, subtle glowing runes
Constraints: no text, no logos, no characters, no high-frequency clutter near center
Avoid: photorealism, busy tiny details, bright full-screen gradients
```

---

## 11. 구현 로드맵

### Phase 0: 기획 고정 + P0 키아트

- 이 문서 확정
- `assets/concept/abyssal-rift-keyart.png` 생성
- 메뉴 첫 화면의 분위기 기준 확정

### Phase 1: 이름/텍스트/팔레트 리스킨

목표: 게임 로직은 건드리지 않고 체감만 전환한다.

파일:

- `index.html`: 제목, 메뉴, 버튼명, CSS 팔레트
- `js/core.js`: `C` 팔레트 일부 조정
- `js/data.js`: 클래스, 패시브, 적, 보스, 아이템 표시명/설명
- `js/weapons.js`: 무기 표시명/설명
- `js/ui.js`: `VECTOR`, `CODEX`, `ARSENAL`, `CHIPSET` 문구 교체

검증:

- 메뉴, 클래스 선택, 레벨업 카드, 보스 배너, 종료 화면이 정상 표시
- 기존 세이브가 깨지지 않음

### Phase 2: 다크 던전 배경

목표: 런 시간에 따라 배경이 3구역으로 바뀐다.

파일:

- `js/render.js`: `BG.tick()`에 biome state 추가
- `js/gameloop.js`: 시간대에 따라 `G.biome` 설정
- `index.html`: 배경 이미지 preload 또는 CSS 변수 추가

검증:

- 0분, 5분, 10분에 배경 톤이 자연스럽게 전환
- FPS 저하가 없거나 미미함

### Phase 3: 엘리트 접사

목표: 잡몹 무리 안에서 디아블로식 “위험한 이름 붙은 몬스터”가 등장한다.

파일:

- `js/data.js`: `ELITE_AFFIXES`
- `js/entities.js`: `spawnEnemy`, sprite tint/aura
- `js/gameloop.js`: affix update
- `js/ui.js`: 엘리트 처치 텍스트와 드랍 배너

검증:

- 2분 이후 엘리트가 낮은 확률로 등장
- 접사별 onDeath/onTick이 작동
- 엘리트가 일반몹보다 보상이 좋음

### Phase 4: Loot 2.0

목표: 드랍 보상이 더 자주 기억에 남게 한다.

파일:

- `js/data.js`: `ITEM_AFFIXES`, `ITEM_TIERS.epic`
- `js/player.js`: `pickRandomItem`, `dropItem`, `applyItem`
- `js/entities.js`: 아이템 빛기둥/드랍 표시
- `js/ui.js`: 유물 tooltip에 접사 표시

검증:

- Rare/Epic/Legendary 드랍 연출 차이가 명확함
- 접사 효과가 중복 적용되어도 밸런스가 무너지지 않음

### Phase 5: 보스/제단 연출 강화

목표: 보스와 제단이 던전 이벤트처럼 느껴지게 만든다.

파일:

- `js/data.js`: 보스명/제단명 리스킨
- `js/entities.js`: `spawnBoss`, `spawnShrine`
- `js/ui.js`: 보스 배너와 보상 모달
- `js/audio.js`: 가능하면 보스 등장/전설 드랍 사운드 조정

검증:

- 보스 등장 시 화면이 과하게 가려지지 않음
- 보스 처치 보상이 즉시 이해됨

---

## 12. MVP 범위

가장 빠르게 “디아블로처럼 됐다”를 느끼려면 다음 5개만 먼저 한다.

1. UI/텍스트 리스킨
2. 팔레트 변경
3. P0 키아트 생성 후 메뉴 배경 적용
4. 엘리트 접사 3종: Molten, Frostbound, Void-Touched
5. Legendary 드랍 빛기둥과 배너

이 MVP는 기존 로직을 거의 유지하므로 리스크가 낮고, 플레이어가 보는 첫 인상과 전투 보상 감각은 크게 바뀐다.

---

## 13. 밸런스 방향

드랍이 늘어나면 난이도도 같이 올라가야 한다.

- 엘리트는 일반몹보다 HP 2.5-4배
- 엘리트 드랍은 일반몹보다 10-20배
- Legendary는 너무 자주 나오지 않게 15분 런 기준 평균 1-2개
- 보스 글리프는 강하지만 런 한정
- 영구 룬은 편의와 초반 안정성 중심으로 제한

추천 목표:

- 5분 이전: 빌드 씨앗을 찾는 구간
- 5-10분: 유물/제단으로 빌드 방향이 확정되는 구간
- 10-15분: 엘리트와 보스가 완성 빌드를 시험하는 구간

---

## 14. 다음 작업 제안

바로 작업에 들어간다면 순서는 다음이 좋다.

1. P0 키아트 생성 및 `assets/concept/` 저장
2. `index.html` 메뉴와 CSS 팔레트 1차 전환
3. `data.js`, `weapons.js` 표시명 리스킨
4. 엘리트 접사 3종 구현
5. 전설 드랍 빛기둥 구현

이 순서면 하루 안에 화면 첫인상과 전투 보상감이 바뀌고, 그 다음 배경/보스 초상/아이템 접사로 깊이를 더할 수 있다.
