# 어비스 펄스

어둡고 고딕한 호드 서바이버 로그라이트입니다. 15분 동안 심연의 균열에서 살아남고, 스킬과 덕목을 선택하며, 룬 각성과 전설 스킬을 완성하고, 심연 보스를 쓰러뜨려 유물과 룬을 모읍니다.

## 플레이

- 저장소: https://github.com/fbwndrud/abyssal-pulse
- 공개 GitHub Pages 주소: https://fbwndrud.github.io/abyssal-pulse/
- 로컬 서버 실행 후 주소: http://localhost:8000/

## 로컬 실행

```bash
npm start
```

이후 `http://localhost:8000/`을 엽니다.

직접 실행도 가능합니다.

```bash
python3 -m http.server 8000
```

## 조작

- 방향키 또는 `W/A/S/D`: 이동
- 모바일 터치 드래그: 아날로그 이동
- 스페이스: 일시정지
- `M`: 음소거

## 현재 방향

기본 호드 서바이버 로그라이트 루프는 유지하되, 판타지는 어두운 고딕 루터 ARPG로 전환했습니다.

- 고딕 클래스 초상화와 서로 다른 시작 스킬을 가진 추방자 클래스
- 균열 수호자, 피의 예언자, 묘지 방벽, 철갑 추방자, 저주 마녀, 공허 임프, 묘지 거한, 잿빛 도살자, 뼈 파편, 지옥불 십자, 망령 칼날 PNG 스프라이트
- 붕괴한 성당, 뼈 납골당, 지옥대장간 균열로 이어지는 절차적 던전 바닥
- 고딕 제단형 스킬 선택 카드와 어두운 성역 오버레이
- 신성 노바, 세라프의 창, 룬 방벽, 뼈 출혈, 지옥불 균열, 묘지 잔진, 저주 폭발, 회귀 망령 칼날, 심연 우물, 영혼 프리즘 분열 등 디아블로풍 스킬 메커닉
- 룬 각성과 전설 스킬 각성
- 유물, 룬, 저주 제단 성장 구조
- 용암핵, 서리결속, 공허낙인 정예 몬스터
- 시간에 따라 바뀌는 던전 바이옴
- OpenGameArt 다크 판타지 BGM과 JC Sounds 판타지 효과음
- 모바일 최적화된 스킬/레벨업 선택 화면
- 가속, 카메라 선행, 속도 기반 잔상, 런타임 걷기 프레임 텍스처로 개선한 이동감

전체 리디자인 계획은 [DIABLO_STYLE_REDESIGN.md](DIABLO_STYLE_REDESIGN.md)를 참고하세요.

## 오디오 크레딧

음악과 효과음 출처는 [audio/CREDITS.md](audio/CREDITS.md)에 정리되어 있습니다. 현재 오디오 패스는 다음 소스를 사용합니다.

- `Dark Quest`
- `A Darkness Opus`
- `Dark Dungeon Ambience`
- `Dark souls type boss theme`
- `JC Sounds - Fantasy SFX Pack Vol 1`
