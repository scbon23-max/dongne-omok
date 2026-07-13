# 동네 운동회 게임방 — 인수인계 (2026-07-12)

> 새 세션이 이걸 먼저 읽고 이어서 진행. **이 프로젝트는 슈팅게임(shooting_v0.2)과 무관** — 그쪽 CLAUDE.md 규칙 적용 안 함.

---

## ⚠️ 지금 당장 할 일 (제일 중요)
1. ~~**재배포**~~ ✅ **1차 완료(2026-07-13)** — 점령전·버그수정 11건·랭킹 초기화·알까기/점령전 랭킹 기록이 클럽에 반영됨.
2. **재배포 필요(2026-07-13 추가분)** — 아래 수정들이 **아직 로컬만**. `dongne-omok/` 통째로 Netlify에 다시 드래그해야 클럽에 반영됨:
   - "온라인 N명" 전체통일(로비·오목방·알까기방 모두 클럽 전체 접속자 표시).
   - 상단 헤더줄(온라인·참가자/랭킹·나가기·메뉴)을 **화면 맨 아래로** 이동(CSS `order`+`margin-top:auto`). **로비·오목방·알까기방 세 화면 모두** 적용.
   - 방 헤더 정리: "참가자" 버튼 삭제(→ "온라인 N명" 텍스트 클릭 시 참가자 모달), 🔊 소리 버튼 삭제(→ 메뉴 안 `menu-sound-btn` 항목으로 이동). 로비 🔊도 제거(소리는 공용 메뉴에서). 소리 라벨 "🔊 소리 켜짐/🔇 소리 꺼짐".
   - 랭킹 버튼 앞 아이콘 월별이모지→🏅 고정(`applyRankEmoji`/`MONTH_EMOJI` 삭제, 텍스트 HTML 고정). 로비 버튼 "🏅 전체랭킹"으로 이름+`openRank("all")`. 전체랭킹은 **게임별 탭**(오목/알까기/점령전, `#rank-tabs`·`rankTab`)으로 **한 번에 한 게임만** 표시(기본 오목 탭). 방 랭킹 버튼은 그대로 게임별.
   - 로비 방영역 정리: 필터(전체/오목/알까기/점령전)·"열린 방" 제목 삭제, "방 만들기" 버튼 가로 꽉+맨 위, 빈 상태 "아직 열린 방이…"를 점선 박스(방 카드 크기)로.
   - ~~방 안 하단 "방 이동" 띠 통째 삭제~~ → **오해였음. 복구함**: 방 이동 띠(`room-strip`/`renderRoomStrip`) 되살리되 "방 이동" **라벨 텍스트만 제거**(칩만 표시). `switchRoom`에 **게임중 가드** 추가: 내가 앉아서 대국 진행중(started·!over)이면 이동 차단 + toast "게임 중엔 다른 방으로 이동할 수 없어요". `inActiveGame()` 헬퍼. 대기중/관전은 이동 가능.
   - 메뉴에서 "한 수 제한시간 설정"(`settings-btn`)·"재대국"(`restart-btn`) 삭제(리스너도). 메뉴=소리/관리자/로그아웃만. 시간설정은 타이머박스 클릭, 재대국은 중앙 버튼으로 여전히 가능(settings-modal 유지).
   - 접속 목록(방 우측)에서 "관전" 태그만 제거(`renderGameOnline`), 흑/백 태그는 유지. 참가자 모달(`renderPlayersList`)의 관전은 그대로.
   - 로비 방 카드(`renderRoomList`) 레이아웃 재구조: flex-wrap 다줄→ 좌(배지+이름 / 상태·인원 2줄) + 우(입장 버튼 세로중앙). 클래스 room-main/room-sub→room-info/room-title/room-meta(+room-dot 구분점). 긴 이름 말줄임.
   - 전체 점검(병렬 감사 2 + 실시간 스모크): 확정 버그 0. 정리로 죽은 함수 `switchRoom`·`spectatorCount` 삭제, 고아 CSS(lobby-rooms-head/title/filter/lfil) 삭제. `roomFilter`는 항상 "all"(무해)로 남겨둠.
   - **자동 로그인** 추가: 로그인 화면 "로그인 유지" 체크박스(기본 켜짐). 성공 시 localStorage `omok_auth`={nick, h=sha256(pw)} 저장(비번 원문 저장 안 함). 부팅 시 `tryAutoLogin`→`Db.loginHash(nick,h)`로 검증 로그인(실패 시 저장삭제+로그인화면). 로그아웃 시 `clearAuth`. 체크 끄면 저장 안 함. db.js에 `loginHash`·`hashPw` 노출. 전 시나리오 실측 검증(config ROOM 임시격리 후 원복 완료).
3. **재배포 후 실전 확인**(선택): 2인으로 오목·알까기 대국 → 랭킹 0부터 쌓이는지.

---

## 프로젝트 개요
- **정적 웹앱**(빌드 없음, 순수 JS). 파일: `index.html`, `config.js`, `sb.js`, `db.js`, `renju.js`(오목규칙), `net.js`(네트워크), `alkkagi.js`(알까기엔진), `game.js`(메인 ~1900줄), `styles.css`.
- **백엔드**: Supabase(프로젝트 ref `xkvalutmxdraihawrgmx`, org scbon23-max, **무료 티어**, ap-northeast-2). Realtime broadcast + Postgres.
- **배포**: Netlify. (og:image엔 `phenomenal-madeleine-e99811.netlify.app` — 실제 클럽 사이트 주소는 사용자 확인)
- **게임 3종**: 오목(렌주) / 알까기-일반(넉백) / 알까기-점령전(컬링식).
- **로컬 확인 서버**: `.claude/launch.json`의 `omok` (PowerShell 정적서버, 8779). `preview_start {name:"omok"}` 로 띄움.

## 구조 (핵심)
- **로비 + 방**: 로그인→로비. 로비채널(전체 online·방목록·로비채팅=DB room `main`) + 방채널(방입장시, 게임상태+채팅=DB room `r:<id>`). `net.js` = initLobby/init(roomId)/leaveRoom.
- **호스트 권위**: 방마다 host 선출(관리자 "구나" 우선, 아니면 joinTs). host가 검증·권위상태 broadcast. 클라는 seq(알까기 A)/rev(오목 G) 가드로 채택.
- **방 종류**: `curRoomGame` ∈ {omok, alk, alk_terr}, `curGame` ∈ {omok, alk}(화면). 점령전은 alk 화면 공유.
- **랭킹**: 시즌제(분기). Elo. 게임종류 = `games.game` 컬럼(omok/alk/alk_terr). 월별 이모지.

## DB 상태 (이번 세션에 바뀜)
- **`games.game` 컬럼 추가됨**(사용자가 Supabase SQL Editor서 `ALTER TABLE games ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'omok';` 실행). → 알까기·점령전 랭킹 기록/조회 정상. **검증 완료**(테스트 1판 넣어 확인 후 삭제).
- **랭킹 초기화 = 코드 컷오프**(삭제 아님): `game.js`의 `RANK_EPOCH = 2026-07-12T16:00Z`. 그 전 대국(기존 64판)은 랭킹 집계 제외·**DB 보존**. 되살리려면 이 상수만 지우면 복구. **검증 완료**(실랭킹 비워짐 + 기준선 후 대국만 집계).
- ⚠️ `games`·`accounts`·`allowlist`·`chat` 테이블은 **전역**(배포 클럽과 공유). 테스트 시 `OMOK_CONFIG.ROOM`를 격리값으로 덮어써 채널·채팅 분리. **실멤버 데이터 대량삭제 금지**.

## 이번 세션에 한 것 (전부 실측 검증, 명시된 것 외)
- **점령전(territory) 2인 대전** 완성: 방종류·과녁·발사돌(바깥라인 탭배치)·링점수·배치동기화(alk_place+px)·랭킹분리(alk_terr). 2탭(다른닉) 검증.
- **알까기 물리**: 미끄럼↓(FR 0.933)·알 R14·과녁 축소·실시간점수·조준점선 반대방향·**바둑알 주황테두리 제거**. (수치는 실측, **느낌은 사용자 눈** — 캔버스라 나는 못 봄)
  - 2026-07-13 최대파워 당김거리 단축: `POWER` 제거 → `MAX_PULL` 도입. 속도 = min(d,MAX_PULL)/MAX_PULL × MAXV(25). 조준선·파워링 상한서 멈추고 최대 도달 시 빨강. MAX_PULL 값으로 느낌 조절.
  - 2026-07-13(3차) 강도 10%↓: MAXV 25→**22.5**(길이 MAX_PULL 90 유지). 실측 90→22.5/45→11.25.
  - 2026-07-13(2차) MAX_PULL 130→**90**(더 짧게). 최대 도달 시 테두리 링을 **굵고 진한 빨강+깜빡임**(드래그 중 rAF 루프 `dragTick`로 손 멈춰도 계속 렌더, `performance.now()` sin으로 투명도·굵기 맥동). 실측: 45→12.5/90→25/150→상한25, 홀드 중 rAF 계속(22/350ms), 링 픽셀 프레임마다 변함. 깜빡임 세기·MAX_PULL은 alkkagi.js 상수로 조절.
- **혼자 연습 / 점령전 연습** 버튼(방에 혼자일 때만, 여럿이면 숨김+가드).
- **기권 버튼**(오목), 로비 채팅 고정높이·방목록 레이아웃, 시즌제+월별이모지.
- **울트라 감사(33 에이전트) → 버그 11건 수정**: ①자리 하이재킹(솔로버튼) ②방전환 이중호스트 ③대기중 유령시간초과 ④참가자모달 알까기자리 ⑤알까기 이탈 무기록 ⑥무르기/무효 검증(gseq) ⑦resign 신원 ⑧begin 관전자차단 ⑨넉아웃 동시전멸=무승부 ⑩알까기 desync 가드 ⑪roomCreatedTs. (부팅·guards·유령타이머 실측 통과)

## 미완 / 보류 (다음에)
- **울트라 감사 low 7건 보류**(저위험·자가치유): mid-flight 관전자 스냅샷, 기록insert실패 recorded선세팅, getGamesByType폴백, 종료애니 호스트변경 이중기록, 원격불법착수 피드백無, 죽은 unread코드, presence지연 room_close.
- **아이템전**(알까기): 조사만 함(파워샷/더블샷/폭탄/프리즈 등). 미제작.
- **토너먼트 모드**: 논의만(킹전/스위스/싱글엘리), 보류.
- **느낌 눈검증 대기**(내가 못 보는 것): 흰 돌 가시성·실시간 점수 글자·물리 세기·과녁 크기.

## 함정 / 주의 (꼭)
- **나(Claude)가 못 하는 것**: Supabase **구조변경(ALTER/CREATE = DDL)**. 브라우저 DB클라는 줄(row) CRUD만. → 스키마 변경은 **사용자가 대시보드 SQL Editor**서. (줄 insert/delete는 가능하나 **실멤버 데이터 대량삭제는 안전정책상 안 함** — 사용자가 직접)
- **캔버스(알까기판) 시각은 내가 못 봄** → 색/그림/글자 가시성은 사용자 확인.
- **rAF는 배경탭서 정지** → 2탭 테스트 시 탭 전환하면 애니메이션 멈춤(테스트 아티팩트, 실사용선 조작자 탭 앞).
- **테스트 방법**: 프리뷰 2탭 + `javascript_tool`로 상태 측정. 스크린샷은 되기도/멈추기도. 물리는 rAF 동기 우회. 다른닉 2인 테스트는 `Db.addAllowed('테스트닉')`→플레이→`Db.deleteAccount`+`Db.removeAllowed`로 정리. 게임 종료까지 안 가면 랭킹 기록 안 됨.
- **베트남어(vi) 번역은 나중에** 일괄 — 지금 한국어만.

## 관련 메모리 (자동 로드됨)
`project_dongne_omok`, `project_dongne_omok_alkkagi`(상세 이력·버그수정 다 기록됨).
