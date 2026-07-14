# 코드맵 — 동네운동회 게임방

> 수정/새 세션 시작 전 **여기부터** 본다. 전체 파일을 안 읽고도 어디를 grep할지 알 수 있게 하는 지도.
> 위치는 줄번호가 아니라 **`// ---------- 섹션명 ----------` 주석을 grep**해서 찾는다(줄번호는 바뀜).

## 파일별 역할
| 파일 | 역할 |
|------|------|
| `index.html` | 화면 3개(로비·오목방·알까기방) + 모달들(메뉴/규칙/랭킹/참가자/방만들기/관리자…) |
| `styles.css` | 전체 스타일 |
| `config.js` | Supabase URL·공개키·채널(`ROOM: "main"`) |
| `sb.js` | Supabase 클라이언트 생성(`window.SB`) |
| `net.js` | 실시간 통신. 로비채널(상시)+방채널(입장시). presence·broadcast. **`rosterOf`=presence 배열의 마지막 항목 읽음**(track이 덮어쓰기 안 되고 쌓여서). **자동 재접속**: 채널 끊기면(CHANNEL_ERROR/TIMED_OUT/CLOSED) 지수 백오프로 재구독(세대 gen 가드로 중복 방지, 재접속 시 track+onReady 재실행=놓친 채팅 복구). 의도적 `leaveRoom`은 재접속 안 함 |
| `db.js` | Supabase 테이블 CRUD(accounts/allowlist/games/chat) + 로그인/해시(`login`,`loginHash`,`hashPw`) |
| `renju.js` | **오목 규칙 엔진**(금수 33/44/장목, 승리판정). 순수 로직 |
| `alkkagi.js` | **알까기 물리 엔진**(튕김·충돌·판밖퇴출, 점령전 과녁점수). `MAX_PULL`=최대파워 당김거리, `MAXV`=최대속도 |
| `game.js` | **컨트롤러(오케스트레이터)** — 나머지 전부. 아래 섹션 참조 |

## game.js 섹션 (grep: `// ----------`)
로그인/입장 · 로비 · 방입장/나가기 · 알까기대전 · 방장선출 · 메시지 · 착수 · 무르기 · 기권 · 무효 · 타이머 · 이름/자리/차례 · 참가자목록 · 관리자 · 랭킹/시즌 · 보드(오목 그리기) · 채팅 · 토스트 · 사운드 · 규칙 · 이벤트바인딩(`function bind`)

## 핵심 상태·객체 (game.js 상단)
- `G` = 오목 상태(seats/turn/started/over/board/rev/history…), `A` = 알까기 상태(seats/turn/mode/score…)
- `me` = {nick, isAdmin} · `roster` = 지금 이 방 사람 · `lobbyRoster` = 로비채널 전체(방에 있는 사람 포함)
- `curGame` ∈ {omok, alk}(화면) · `curRoomGame` ∈ {omok, alk, alk_terr}(방 종류)
- `netMode`(방 접속중) · `lobbyMode`(로비 접속중) · `amHost`(내가 방장) · `hostNick`

## 자주 건드리는 함수 (grep 대상)
- 접속수/목록: `updateOnlineCounts`, `renderGameOnline`, `renderLobbyOnline`, `lobbyPeople`(로비=viewing 없는 사람), `clubOnlineCount`
- 방 목록/이동: `renderRoomList`, `renderRoomStrip`, `switchRoom`, `enterRoom`, `leaveRoomToLobby`
- 채팅: `sendChat`/`sendLobbyChat`, `addChatTo`, `pushOverlay`(판 위 오버레이, game별)
- 자리/차례: `renderPresenceUI`, `renderPlayersList`(참가자모달=방장 자리배정), 좌석 chip 탭
- 랭킹: `openRank`(game 또는 "all"), `renderSeason`, `rankTab`, `computeSeasonRank`
- 사운드: `initAudio`(첫 상호작용에 자동해제 `unlockAudio`), `playStone` 등
- 규칙: `buildRules`/`buildAlkRules`/`buildTerrRules` → `showRules(game)`; 메뉴 2뎁스(`menu-rules-btn`)

## 규칙 / 관례 (중요)
- **새 게임 추가 = 그 게임 엔진을 별도 .js로** (renju/alkkagi처럼). `game.js`엔 UI 배선만 얇게 붙인다. game.js를 더 부풀리지 말 것.
- **배포 = `git push`** (드래그 아님). `git add -A && commit && push` → GitHub Pages가 1~2분 내 자동반영. repo=`scbon23-max/dongne-omok`(공개). 슈팅게임 repo와 완전 별개.
- **Supabase 스키마 변경(ALTER/CREATE)은 사용자가** 대시보드 SQL Editor에서(나는 줄 CRUD만). **오목 복기용**: `games` 테이블에 `moves jsonb` 열 필요(`ALTER TABLE games ADD COLUMN moves jsonb;`). 없어도 recordGame이 moves 빼고 재기록해 안 깨짐(복기만 비활성).
- **presence 함정**: track이 덮어쓰기 안 되고 쌓임 → `net.js` `rosterOf`가 `m[m.length-1]`(최신) 읽음. 로비 사람 판별은 meta의 `viewing`(방에 있으면 roomId, 로비면 null).
- **접속 표기**: 방 우측 접속헤더 = `N명 · 전체 N명`(방인원·전체 온라인) / 로비 접속헤더 = `N명 · 전체 N명`(로비인원·전체). 로비 헤더에 "온라인 N명"(전체)도 별도 표시.
- **검증**: 화면/실시간은 로컬 서버+2탭 또는 격리채널(`OMOK_CONFIG.ROOM` 임시덮기) 후 원복. 실클럽(`main`) 오염 주의. 로그인 테스트 후 `localStorage.omok_auth` 정리(자동로그인 방지).
- 상세 이력/함정은 `HANDOFF.md`.
