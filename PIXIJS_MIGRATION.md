# Neon Pulse — PixiJS v8 마이그레이션 브리핑

> 작성: 2026-05-03
> 다음 세션에서 이 문서를 읽고 plan을 세움.
> 현재 단일 HTML / Canvas 2D 기반 호드 서바이버를 PixiJS v8로 렌더 계층만 교체.

---

## 1. 프로젝트 스냅샷

- 위치: `/Users/lyoojk/jklyoo/games/neon-pulse`
- 장르: Vampire Survivors류 호드 서바이버 + 로그라이트
- 스택: 단일 HTML5, Canvas 2D, Web Audio (외부 의존 없음)
- 구조: 최근 `index.html`에서 `js/` 모듈로 분리 완료
  - `core.js` — G(전역 상태), 카메라, 좌표 헬퍼
  - `audio.js` — Web Audio 합성 + ogg BGM
  - `data.js` — 클래스 5 / 패시브 8 / 적 7 / 보스 4 / 시너지 14 / 아이템 14 (relic 9 + consumable 5)
  - `entities.js` — EGRID(spatial hash), fxBurst/fxRing 등 fx, dealDamage, spawn 헬퍼
  - `player.js` — 플레이어 spawn/레벨업/진화/융합/드랍훅
  - `weapons.js` — 무기 10 + 진화 16 + 융합 14, 각각 onUpdate
  - `gameloop.js` — update/render/spawnDirector
  - `render.js` — drawCircle/drawPolygon/drawStar/drawDiamond + BG (그리드/별/방사형)
  - `ui.js` — 메뉴/HUD/레벨업 카드/결과/상점/도감
  - `main.js` — 부트, 입력, 메인 루프
- 세계관: `LORE.md` (향후 codex/플레이버용)
- 방향성: `DIRECTION.md` (20개 시나리오 평가)

---

## 2. 마이그레이션 결정의 배경

### 2-A. 4분 시점 렉 발생
- 사용자 보고: "4분쯤 넘어가니 렉이 심해지면서 온갖 현상". 호드 서바이버 본질상 적이 기하급수적으로 늘어 임시 처방으론 한계.
- 추가 증상: 렉 직전 카메라가 잠시 player 위치에서 벗어났다가 돌아오는 desync. dt-aware lerp + spawn snap을 시도했지만 frame spike 시 여전히 발생.

### 2-B. 진단된 5개 핫스팟 (이전 세션)
1. 융합 무기 14개 onUpdate가 매 프레임 EGRID.query 다발 호출 (특히 VOID PULSAR/RESONANT RING/COIL HALO의 노드별 호출)
2. VOID PULSAR/RESONANT RING의 이중 쿼리 (pull + damage가 같은 영역 두 번)
3. Chain의 매 프레임 `new Set()` (GC 압박, 다만 빈도 측정 결과 초당 ~30개로 미미)
4. `dealDamage` → 매번 `fxText` 객체 spawn (초당 50~200)
5. `G.ents` cleanup이 배열 크기 비례. 4분 시점 1000~1500 entity → O(n) 매 프레임

### 2-C. 적용된 임시 처방 (Week 1, 이번 세션)
- spawn cap 250 (`gameloop.js`)
- VOID PULSAR 이중 쿼리 통합 (`weapons.js`)
- fxText budget — n>800 시 70% drop, n>1200 전부 drop (보스 데미지 제외)
- 카메라 dt-aware lerp (`core.js:114`) + spawn 시 즉시 snap (`player.js spawnPlayer`)
- 드랍 규칙 정리 — 유물=보스 체스트 전용, 일반/엘리트 몹=consumable + 상한
- 리롤 비용 매 레벨업마다 초기화
- 보스 HP 10배 (`BOSS_HP_MUL`)

→ 임시 처방으로 1차 부하 감소, 그러나 렉 *직전* 카메라 desync는 여전. 근본은 Canvas 2D + shadowBlur + 단일 G.ents 배열의 한계.

### 2-D. 외부 사례 조사 (이전 세션)
- **Vampire Survivors**: Phaser/HTML5 시작 → 수천 적 + 충돌 못 버텨 Unity로 엔진 이전. ($수백M 매출 게임도 같은 한계 부딪힘)
- **Halls of Torment** (Godot): "수천 sprite로 unplayable 됨" → 무거운 부분을 C++로, 일부는 별도 thread로 풀어냄.
- **PixiJS v8**: 일반 노트북 ParticleContainer 30,000 sprites @ 60fps. 실용 수준 1000+ 무리 없음. WebGL 가속.

### 2-E. 후보 비교 결과

| 옵션 | 성능 한계 | 단일 HTML | 마이그 비용 | 모바일 | 콘솔 |
|---|---|---|---|---|---|
| A: 현재 + 깊은 최적화 | 적 ~500 | ✅ | 1주 | 약함 | ❌ |
| **B: PixiJS** | 적 5000+ | ✅ (~450KB CDN) | 1~2주 | 강함 | ❌ |
| C: Phaser 3 | 적 1000~2000 | ✅ (~1.2MB) | 2~3주 | 강함 | ❌ |
| D: Godot native | 적 5000+ | ❌ | 4~8주 | 강함 | ✅ |
| E: Godot HTML5 | 적 500~1000 | ⚠️ (30MB 런타임) | 4~8주 | 약함 | 우회 |

---

## 3. 사용자 결정

1. **렌더 계층 = PixiJS v8** — 단일 HTML 정체성 유지 + WebGL 가속.
2. **화면 영역 cap** — 적 spawn은 카메라 영역 안으로 제한. 화면 밖 cull. "화면에 들어오는 한도" 안에서만 게임플레이.
3. **viewport 크기**는 PixiJS 한계 외부 조사 기반으로 결정 — 권장: **1280×720** (16:9 표준, 화면 안 동시 sprite 한도 ~300, PixiJS 한계 5000보다 항상 낮은 안전 마진).
4. **장기 출시 목표 = Steam, 현재는 웹 테스트**. PixiJS가 단기 베스트. Steam 단계에서 Godot 등 native는 별도 작업.

---

## 4. 보존 vs 교체 영역

### 보존 (그대로 사용)
- `data.js` 100% — 모든 데이터 정의
- `audio.js` 100% — Web Audio 합성/공간화/ducking
- `entities.js`의 비주얼 외 영역 — EGRID, dealDamage, applySlow, killEnemy, fireProjectile/firePulse/fireFanShock/spawnBlackhole, AI brain
- `weapons.js` onUpdate 14+14 — 게임 로직, EGRID 쿼리만 PIXI 무관
- `player.js` — 레벨업/진화/융합/드랍훅 100%
- `gameloop.js`의 update + spawnDirector
- `ui.js` 대부분 (HTML overlay 기반이라 PIXI 무관) — 카드/HUD/메뉴
- `LORE.md`, `DIRECTION.md`, `data.js`의 ITEMS/SYNERGIES/CLASSES/PASSIVES 정의

### 교체 (PIXI로 다시 작성)
- `render.js` 전체 — drawCircle/drawPolygon/drawStar/drawDiamond/BG (그리드/별/방사형 글로우)
- `gameloop.js`의 render() + drawWorld() + 모든 ctx.* 호출
- `index.html`의 `<canvas id="canvas">` → PIXI Application canvas
- `entities.js`의 fxBurst/fxRing/fxLine/fxText/fxShockwave (entity는 유지하되 draw는 PIXI)
- shadowBlur 기반 글로우 → PIXI BlurFilter 또는 사전 렌더된 글로우 sprite
- `render.js:9~34` spritePool → PIXI.Texture 캐시
- `entities.js:71~89` fx 엔티티들 — PIXI Sprite 또는 ParticleContainer

---

## 5. 마이그레이션 권장 단계 (각각 독립 commit 가능)

### Phase 1: PIXI 셋업 (~반나절)
- index.html에 PixiJS v8 CDN 추가 (`https://cdn.jsdelivr.net/npm/pixi.js@8/dist/pixi.min.js`)
- main.js 부트 시점에 `new PIXI.Application()` 생성 + viewport 1280×720
- 기존 `<canvas>`와 PIXI canvas 동시 표시 가능하게 (점진 마이그레이션)
- world container, fx container, hud container 계층 셋업

### Phase 2: 배경 (~반나절)
- BG의 그리드/별/방사형 글로우를 PIXI.Container로
- 그리드는 PIXI.TilingSprite 또는 RenderTexture
- 별 140개 → PIXI.ParticleContainer
- 방사형 글로우 → PIXI.Sprite + RenderTexture 사전 렌더

### Phase 3: 정적 sprite (1일)
- 적 7종 + 보스 4종 + 플레이어 5클래스 + 픽업 → PIXI 텍스처 사전 렌더
- spritePool을 PIXI.Texture 캐시로 변환
- drawCircle/drawPolygon/drawStar/drawDiamond는 텍스처 생성용으로만 사용 (런타임 호출 X)

### Phase 4: 파티클 (1일)
- fxBurst → PIXI.ParticleContainer + Object pool로 재사용
- fxRing/fxShockwave → PIXI.Graphics with BlurFilter
- fxLine → PIXI.Graphics
- fxText → BitmapFont 또는 PIXI.Text 풀

### Phase 5: 동적 primitive (1일)
- 빔(BEAM, EVENT LANCE 등) → PIXI.Graphics 매 프레임 리드로우 또는 RenderTexture
- 체인 라이트닝(CHAIN, COIL HALO) → PIXI.Graphics
- 블랙홀 → PIXI.Sprite + 회전 + glow

### Phase 6: 카메라 + HUD 통합 (반나절)
- 카메라 = world container의 position
- shake = world container의 미세 offset
- HUD overlay는 그대로 (HTML)

### Phase 7: 통합 테스트 + 폴리시 (반나절)
- 풀 런 15분 1회. 4분/8분/12분 시점 FPS 측정
- 카메라 desync 재현 시도 (해소 확인)
- 시각적 회귀 점검 (네온 룩 유지)

---

## 6. 참고 자료 (이번 세션 결과물)

- `/Users/lyoojk/.claude/plans/bright-puzzling-mango.md` — 이전 plan (융합 시스템 + 폴리시)
- `DIRECTION.md` — 장르 믹스 시나리오
- `LORE.md` — 세계관 (Signal Integrity, Zero Form 미스터리 등 향후 활용)
- 외부 사례 (이번 세션 검색):
  - [Vampire Survivors → Unity](https://foro3d.com/en/2026/february/vampire-survivors-changes-engine-to-optimize-sprites.html)
  - [Halls of Torment Godot](https://godotengine.org/showcase/halls-of-torment/)
  - [PixiJS v8 ParticleContainer](https://pixijs.com/blog/particlecontainer-v8)

---

## 7. 첫 단계 가이드 (다음 세션 클로드용)

1. **읽기**: 이 문서 + `index.html` (canvas 부분) + `js/render.js` + `js/gameloop.js`의 render() + `js/entities.js`의 fx*.
2. **Explore**: 1~2 Explore agent로 ctx.\* 호출 위치, shadowBlur 사용처, 사전 렌더되는 sprite cache 패턴 정리.
3. **확인 질문 (AskUserQuestion)**:
   - viewport: 1280×720 (16:9) vs 1100×700 (현재 유지) vs 1920×1080 (큰 화면 풀)?
   - PIXI 텍스처 사전 렌더 방식: 빌드 타임 캔버스 → PIXI.Texture로 한 번 변환 vs 런타임 PIXI.Graphics?
   - 점진 마이그레이션(Canvas 2D + PIXI 병행 일시) vs 한 번에 전환?
4. **plan 파일 작성**: 각 Phase를 독립 commit 단위로 분해. 핵심 파일 + 라인 명시. 검증 방법 (풀 런 + FPS 측정).
5. **ExitPlanMode**.

작업 중 불확실한 부분(예: PIXI v8 BlurFilter 성능, ParticleContainer 글로우 처리)은 WebSearch로 재검색.

---

## 8. 핵심 제약

- **단일 HTML 정체성 유지** — index.html + js/ 그대로, 외부 의존은 PixiJS CDN 한 줄만.
- **네온 룩 보존** — HSL 팔레트, 글로우, 스캔라인, 비네팅. 시각적 회귀 안 됨.
- **게임 로직 안 건드리기** — entities.js EGRID/AI, weapons.js onUpdate, player.js, data.js 그대로.
- **commit별 동작 가능** — 각 Phase 끝 시점에 게임이 정상 작동해야 함 (점진 마이그레이션).
- **Week 1 변경 보존** — 융합 14종 onUpdate, 카드 추가 슬롯, 드랍 규칙, 리롤 초기화, 보스 HP 10배.
