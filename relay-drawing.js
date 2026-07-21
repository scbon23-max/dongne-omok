window.RelayDrawing = (function () {
  "use strict";

  var TEXT_MS = 40000;
  var DRAW_MS = 80000;
  var MIN_PLAYERS = 3;
  var MAX_PLAYERS = 12;
  var MAX_TEXT = 40;
  var MAX_STROKES = 160;
  var MAX_POINTS_PER_STROKE = 700;
  var MAX_CANVAS_POINTS = 5000;
  var POINT_PRECISION = 10000;
  var SITUATION_RATIO = 0.15;
  var CANVAS_BG = "#ffffff";
  var AUTO_SUBMIT_GRACE_MS = 1200;
  var PEN_COLORS = ["#17252f", "#d23b3b"];
  var PEN_WIDTHS = [8, 24];
  var ERASER_WIDTH = 90;
  var GALLERY_IMAGE_SIZE = 480;
  var GALLERY_IMAGE_QUALITY = 0.72;
  var GALLERY_IMAGE_MAX_BYTES = 153600;
  var GALLERY_PAGE_SIZE = 10;
  var WAITING_BGM_SRC = "assets/catchmind-bgm.mp3";
  var WAITING_BGM_VOLUME = 0.04;
  var GAME_BGM_SRC = "assets/catchmind-start.mp3";
  var GAME_BGM_VOLUME = 1;
  var PALETTE_COLORS = [
    "#17252f", "#4b5563", "#9ca3af", "#ffffff", "#7c4a2d", "#d23b3b",
    "#be123c", "#f97316", "#facc15", "#84cc16", "#22c55e", "#14b8a6",
    "#06b6d4", "#38bdf8", "#2474b5", "#4338ca", "#8b5cf6", "#ec4899"
  ];
  // 캐치마인드 단어장 중 누구나 바로 떠올릴 수 있는 소재만 골라 조합한다.
  var PROMPT_CHARACTERS = [
    "강아지", "고양이", "토끼", "햄스터", "다람쥐", "고슴도치", "수달", "너구리",
    "여우", "곰", "북극곰", "판다", "코알라", "캥거루", "코끼리", "기린",
    "얼룩말", "하마", "사자", "호랑이", "사슴", "염소", "양", "소",
    "돼지", "말", "원숭이", "고릴라", "물개", "돌고래", "고래", "펭귄",
    "오리", "병아리", "닭", "독수리", "부엉이", "참새", "개구리", "거북이",
    "문어", "오징어", "상어", "금붕어", "나비", "꿀벌", "공룡", "용",
    "로봇", "외계인", "유령", "마법사", "해적", "왕", "공주", "왕자",
    "아기", "어린이", "학생", "선생님", "요리사", "의사", "소방관", "경찰관",
    "운동선수", "우주비행사", "할머니", "할아버지", "산타", "눈사람",
    "치타", "표범", "늑대", "코뿔소", "악어", "카멜레온", "도마뱀", "뱀",
    "앵무새", "공작새", "플라밍고", "백조", "갈매기", "까마귀", "딱따구리", "타조",
    "칠면조", "라쿤", "미어캣", "알파카", "라마", "낙타", "당나귀", "조랑말",
    "송아지", "아기돼지", "아기오리", "아기곰", "해달", "비버", "두더지", "스컹크",
    "나무늘보", "개미핥기", "박쥐", "북극여우", "순록", "고라니", "멧돼지", "들소",
    "물소", "바다거북", "해마", "불가사리", "해파리", "꽃게", "새우", "복어",
    "가오리", "참치", "연어", "고등어", "조개", "달팽이", "애벌레", "개미",
    "무당벌레", "잠자리", "사마귀", "매미", "메뚜기", "반딧불이", "지렁이", "거미",
    "장수풍뎅이", "사슴벌레", "엄마", "아빠", "누나", "형", "언니", "오빠",
    "동생", "친구", "탐정", "발명가", "과학자", "화가", "작가", "사진가",
    "가수", "배우", "무용수", "피아니스트", "기타리스트", "드러머", "마술사", "광대",
    "농부", "어부", "목수", "우체부", "택배기사", "버스기사", "기차기관사", "비행기조종사",
    "선장", "잠수부", "등산가", "축구선수", "야구선수", "농구선수", "수영선수", "스케이트선수",
    "태권도선수", "제빵사", "미용사", "수의사", "간호사", "치과의사", "약사", "기자",
    "아나운서", "유치원선생님", "경비원", "구조대원", "군인", "닌자", "기사", "요정",
    "천사", "도깨비", "좀비", "뱀파이어", "슈퍼영웅", "악당", "인어", "거인",
    "난쟁이", "장난감병정"
  ];
  var PROMPT_ACTIONS = [
    "춤추는", "노래하는", "달리는", "점프하는", "웃는", "우는", "자는", "기지개 켜는",
    "손 흔드는", "박수치는", "인사하는", "숨는", "날아가는", "수영하는", "산책하는", "등산하는",
    "책 읽는", "편지 쓰는", "그림 그리는", "사진 찍는", "공부하는", "요리하는", "청소하는", "설거지하는",
    "빨래하는", "양치하는", "세수하는", "화장하는", "머리 빗는", "쇼핑하는", "선물 주는", "꽃 심는",
    "빵 굽는", "케이크 만드는", "라면 먹는", "아이스크림 먹는", "수박 먹는", "우유 마시는", "주스 마시는", "커피 마시는",
    "자전거 타는", "버스 타는", "기차 타는", "배 타는", "스케이트 타는", "썰매 타는", "그네 타는", "미끄럼틀 타는",
    "축구하는", "농구하는", "야구하는", "볼링하는", "줄넘기하는", "낚시하는", "캠핑하는", "소풍 가는",
    "피아노 치는", "기타 치는", "드럼 치는", "풍선 부는", "연 날리는", "비눗방울 부는", "눈사람 만드는", "모래성 쌓는",
    "우산 쓰는", "모자 쓰는", "안경 쓰는", "목도리 두르는", "꽃다발 든", "보물 찾는", "별 보는", "달 구경하는",
    "하품하는", "재채기하는", "딸꾹질하는", "윙크하는", "코 고는", "꿈꾸는", "놀라는", "화내는",
    "부끄러워하는", "고민하는", "응원하는", "축하하는", "포옹하는", "악수하는", "손잡고 걷는", "뒤돌아보는",
    "엎드려 있는", "누워 있는", "의자에 앉은", "한 발로 서 있는", "빙글빙글 도는", "살금살금 걷는", "빨리 뛰는", "넘어지는",
    "미끄러지는", "공중제비 도는", "벽을 오르는", "나무에 매달린", "파도 타는", "스키 타는", "스노보드 타는", "롤러스케이트 타는",
    "킥보드 타는", "오토바이 타는", "자동차 운전하는", "비행기 타는", "열기구 타는", "잠수함 타는", "로켓 타는", "말을 타는",
    "낙타 타는", "서핑하는", "스노클링하는", "물장구치는", "다이빙하는", "배드민턴 치는", "탁구 치는", "테니스 치는",
    "배구하는", "골프 치는", "양궁하는", "태권도하는", "권투하는", "요가하는", "체조하는", "훌라후프 돌리는",
    "팔굽혀펴기 하는", "역기 드는", "달리기 시합하는", "공 던지는", "공 받는", "골 넣는", "홈런 치는", "응원봉 흔드는",
    "마이크 잡은", "지휘하는", "바이올린 켜는", "트럼펫 부는", "하모니카 부는", "플루트 부는", "색소폰 부는", "첼로 켜는",
    "북 치는", "탬버린 흔드는", "춤 연습하는", "연극하는", "마술 부리는", "인형극 하는", "종이접기 하는", "색칠하는",
    "찰흙으로 만드는", "블록 쌓는", "퍼즐 맞추는", "일기 쓰는", "만화책 보는", "신문 읽는", "지도 보는", "숙제하는",
    "컴퓨터 하는", "게임하는", "전화하는", "영상 통화하는", "음악 듣는", "텔레비전 보는", "영화 보는", "알람 끄는",
    "시계 보는", "가방 싸는", "신발 신는", "옷 갈아입는", "단추 잠그는", "넥타이 매는", "이불 덮는", "침대 정리하는",
    "창문 여는", "문 두드리는", "초인종 누르는", "계단 오르는", "엘리베이터 타는", "길 건너는", "버스 기다리는", "표 사는",
    "여행 가는", "길 잃은", "지도 들고 있는", "여행 가방 끄는", "장 보는", "계산하는", "음식 배달하는", "택배 나르는",
    "편지 배달하는", "꽃에 물 주는", "나무 심는", "낙엽 쓸어 모으는", "눈 치우는", "자동차 닦는", "반려동물 산책시키는", "물고기 밥 주는"
  ];
  var PROMPT_SITUATIONS = [
    "비 오는 날", "눈 오는 날", "바람 부는 날", "햇살 좋은 아침에", "깜깜한 밤에",
    "무더운 여름날", "추운 겨울날", "안개 낀 아침에", "노을 지는 저녁에", "별이 빛나는 밤에",
    "무지개 뜬 날", "천둥 치는 날", "벚꽃 피는 봄날", "낙엽 지는 가을날", "보름달 뜬 밤에",
    "새해 첫날에", "주말 아침에", "한낮에", "해 뜨기 전에", "해 질 무렵에",
    "비가 그친 뒤에", "첫눈 오는 날", "구름 많은 날", "더운 오후에", "선선한 저녁에",

    "집 거실에서", "부엌에서", "침실에서", "베란다에서", "옥상에서",
    "학교 교실에서", "학교 운동장에서", "학교 복도에서", "도서관에서", "미술실에서",
    "음악실에서", "과학실에서", "체육관에서", "급식실에서", "공원에서",
    "놀이터에서", "동네 골목에서", "시장 한가운데서", "마트에서", "빵집에서",
    "카페에서", "식당에서", "편의점에서", "미용실에서", "병원에서",
    "약국에서", "우체국에서", "은행에서", "소방서 앞에서", "경찰서 앞에서",
    "버스 정류장에서", "지하철역에서", "기차역에서", "공항에서", "주차장에서",
    "엘리베이터 안에서", "계단에서", "횡단보도 앞에서", "다리 위에서", "광장에서",
    "영화관에서", "공연장에서", "박물관에서", "미술관에서", "수족관에서",
    "동물원에서", "놀이공원에서", "운동장에서", "수영장에서", "스케이트장에서",

    "숲속에서", "나무 아래서", "꽃밭에서", "잔디밭에서", "산책로에서",
    "강가에서", "호숫가에서", "연못가에서", "폭포 앞에서", "계곡에서",
    "산꼭대기에서", "언덕 위에서", "동굴 안에서", "사막에서", "오아시스에서",
    "들판에서", "농장에서", "논밭에서", "과수원에서", "바닷가에서",
    "모래사장에서", "바닷속에서", "작은 섬에서", "무인도에서", "배 위에서",
    "등대 앞에서", "항구에서", "캠핑장에서", "텐트 안에서", "눈밭에서",
    "얼음 호수에서", "구름 위에서", "하늘 위에서", "우주에서", "달나라에서",
    "별나라에서", "로켓 안에서", "비행기 안에서", "기차 안에서", "버스 안에서",
    "자동차 안에서", "자전거 도로에서", "시골길에서", "산길에서", "해변 도로에서",
    "낯선 도시에서", "여행지에서", "호텔에서", "온천에서", "야영장에서",

    "생일 파티에서", "크리스마스 아침에", "소풍 가서", "운동회에서", "졸업식에서",
    "입학식에서", "결혼식에서", "축제에서", "불꽃놀이를 보며", "콘서트에서",
    "야구장에서", "축구장에서", "농구장에서", "여름 캠프에서", "바자회에서",
    "장기 자랑에서", "학교 축제에서", "가족 모임에서", "친구 집에서", "명절 아침에",
    "어린이날에", "할로윈 밤에", "눈싸움하다가", "물놀이하다가", "보물찾기 중에",
    "숨바꼭질하다가", "술래잡기하다가", "여행을 떠나서", "길을 잃고", "버스를 기다리며",
    "기차를 기다리며", "비행기를 기다리며", "줄을 서서", "사진을 찍다가", "선물을 열다가",
    "케이크 앞에서", "풍선을 들고", "꽃다발을 들고", "우산을 쓰고", "도시락을 들고",

    "잠옷을 입고", "교복을 입고", "한복을 입고", "우비를 입고", "수영복을 입고",
    "우주복을 입고", "마법사 옷을 입고", "해적 옷을 입고", "왕관을 쓰고", "커다란 모자를 쓰고",
    "선글라스를 쓰고", "목도리를 두르고", "장화를 신고", "슬리퍼를 신고", "가방을 메고",
    "배낭을 메고", "망원경을 들고", "지도를 들고", "손전등을 들고", "풍선을 타고",
    "구름을 타고", "썰매를 타고", "열기구를 타고", "작은 배를 타고", "커다란 상자 안에서",
    "선물 상자 옆에서", "장난감 가게에서", "사탕 가게에서", "꽃가게에서", "서점에서",
    "문구점에서", "사진관에서", "세탁소에서", "분수대 앞에서", "시계탑 앞에서"
  ];

  var api = null;
  var state = freshState();
  var chains = Object.create(null);
  var canvas = null;
  var ctx = null;
  var bound = false;
  var tickId = null;
  var drawing = false;
  var currentStroke = null;
  var localStrokes = [];
  var selectedTool = "pen";
  var selectedColorSlot = 0;
  var selectedColor = PEN_COLORS[0];
  var paletteTarget = "pen";
  var canvasBg = CANVAS_BG;
  var waitingBgmEl = null;
  var waitingBgmPlayPending = false;
  var gameBgmEl = null;
  var gameBgmPlayPending = false;
  var lastGameBgmMatchId = null;
  var taskScope = "";
  var inputScope = "";
  var pendingSubmitScope = "";
  var warningScope = "";
  var albumIndex = 0;
  var previewMode = false;
  var lastSuggestion = "";
  var gallerySavedMatches = Object.create(null);
  var galleryRows = [];
  var galleryOffset = 0;
  var galleryTotal = 0;
  var galleryHasMore = false;
  var galleryLoading = false;
  var galleryError = "";
  var galleryRequestToken = 0;
  var galleryDetailToken = 0;
  var galleryBound = false;

  function randomItem(list, random) {
    return list[Math.floor(random() * list.length)];
  }
  function buildPromptSuggestion(random) {
    random = typeof random === "function" ? random : Math.random;
    var includeSituation = random() < SITUATION_RATIO;
    var action = randomItem(PROMPT_ACTIONS, random);
    var character = randomItem(PROMPT_CHARACTERS, random);
    var prompt = action + " " + character;
    if (includeSituation) prompt = randomItem(PROMPT_SITUATIONS, random) + " " + prompt;
    return prompt.slice(0, MAX_TEXT);
  }
  function nextPromptSuggestion(random) {
    var next = "";
    for (var attempt = 0; attempt < 6; attempt++) {
      next = buildPromptSuggestion(random);
      if (next !== lastSuggestion) break;
    }
    lastSuggestion = next;
    return next;
  }

  function freshState() {
    return {
      phase: "idle",
      rev: 0,
      matchId: null,
      players: [],
      spectators: [],
      ready: [],
      stepIndex: 0,
      totalSteps: 0,
      deadline: null,
      submitted: []
    };
  }

  function $(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>\"]/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[ch];
    });
  }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function safeText(value, max) { return String(value == null ? "" : value).trim().slice(0, max); }
  function safeNick(value) { return safeText(value, 40); }
  function me() { return api ? api.me() : { nick: "", isAdmin: false }; }
  function people() { return api ? api.roster() : []; }
  function has(list, value) { return Array.isArray(list) && list.indexOf(value) >= 0; }
  function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length &&
      a.every(function (value, index) { return value === b[index]; });
  }
  function orderedPeople() {
    return people().filter(function (person) { return person && person.nick; }).slice().sort(function (a, b) {
      return (a.joinTs || 0) - (b.joinTs || 0) || String(a.nick).localeCompare(String(b.nick));
    });
  }
  function activePeople() {
    return orderedPeople().filter(function (person) { return !person.away; });
  }
  function waitingParticipants() {
    return activePeople().filter(function (person) { return !has(state.spectators, person.nick); });
  }
  function waitingSpectators() {
    return activePeople().filter(function (person) { return has(state.spectators, person.nick); });
  }
  function participantNicks() {
    return waitingParticipants().map(function (person) { return person.nick; }).slice(0, MAX_PLAYERS);
  }
  function canChangeRole() { return state.phase === "idle" || state.phase === "finished"; }
  function isActivePhase(phase) {
    phase = phase || state.phase;
    return phase === "prompt" || phase === "drawing" || phase === "caption";
  }
  function isSoundMuted() {
    try { return localStorage.getItem("omok_mute") === "1"; }
    catch (error) { return false; }
  }
  function ensureWaitingBgm() {
    if (waitingBgmEl) return waitingBgmEl;
    if (typeof document === "undefined" || !document.createElement) return null;
    waitingBgmEl = document.createElement("audio");
    waitingBgmEl.src = WAITING_BGM_SRC;
    waitingBgmEl.loop = true;
    waitingBgmEl.preload = "auto";
    waitingBgmEl.volume = WAITING_BGM_VOLUME;
    waitingBgmEl.setAttribute("playsinline", "");
    waitingBgmEl.setAttribute("webkit-playsinline", "");
    waitingBgmEl.style.display = "none";
    if (document.body) document.body.appendChild(waitingBgmEl);
    return waitingBgmEl;
  }
  function stopWaitingBgm(reset) {
    waitingBgmPlayPending = false;
    if (!waitingBgmEl) return;
    try {
      waitingBgmEl.pause();
      if (reset) waitingBgmEl.currentTime = 0;
    } catch (error) {}
  }
  function playWaitingBgm() {
    var el = ensureWaitingBgm();
    if (!el || !el.paused || waitingBgmPlayPending) return;
    waitingBgmPlayPending = true;
    el.volume = WAITING_BGM_VOLUME;
    var play = el.play();
    if (play && play.then) {
      play.then(function () { waitingBgmPlayPending = false; })
        .catch(function () { waitingBgmPlayPending = false; });
    } else {
      waitingBgmPlayPending = false;
    }
  }
  function ensureGameBgm() {
    if (gameBgmEl) return gameBgmEl;
    if (typeof Audio === "undefined") return null;
    try {
      gameBgmEl = new Audio(GAME_BGM_SRC);
      gameBgmEl.preload = "auto";
      gameBgmEl.volume = GAME_BGM_VOLUME;
      gameBgmEl.loop = true;
      gameBgmEl.setAttribute("playsinline", "");
      gameBgmEl.setAttribute("webkit-playsinline", "");
      return gameBgmEl;
    } catch (error) {
      return null;
    }
  }
  function stopGameBgm(reset) {
    gameBgmPlayPending = false;
    if (!gameBgmEl) return;
    try {
      gameBgmEl.pause();
      if (reset) gameBgmEl.currentTime = 0;
    } catch (error) {}
  }
  function playGameBgm() {
    var matchId = state.matchId;
    if (!matchId || gameBgmPlayPending) return;
    var el = ensureGameBgm();
    if (!el) return;
    var isNewMatch = lastGameBgmMatchId !== matchId;
    if (!isNewMatch && !el.paused) return;
    try {
      if (isNewMatch) {
        el.pause();
        el.currentTime = 0;
      }
      lastGameBgmMatchId = matchId;
      el.volume = GAME_BGM_VOLUME;
      el.loop = true;
      gameBgmPlayPending = true;
      var play = el.play();
      if (play && play.then) {
        play.then(function () { gameBgmPlayPending = false; })
          .catch(function () { gameBgmPlayPending = false; });
      } else {
        gameBgmPlayPending = false;
      }
    } catch (error) {
      gameBgmPlayPending = false;
    }
  }
  function syncAudio() {
    if (!api || previewMode) {
      stopWaitingBgm(false);
      stopGameBgm(false);
      return;
    }
    if (isSoundMuted()) {
      stopWaitingBgm(false);
      stopGameBgm(false);
      return;
    }
    if (isActivePhase()) {
      stopWaitingBgm(false);
      playGameBgm();
      return;
    }
    stopGameBgm(true);
    playWaitingBgm();
  }
  function phaseForStep(step) {
    if (step === 0) return "prompt";
    return step % 2 ? "drawing" : "caption";
  }
  function durationForPhase(phase) { return phase === "drawing" ? DRAW_MS : TEXT_MS; }
  function phaseName(phase) {
    return phase === "prompt" ? "문장 쓰기" : phase === "drawing" ? "그림 그리기" :
      phase === "caption" ? "그림 설명" : phase === "finished" ? "앨범 공개" : "이어그리기";
  }
  function expectedKind(step) { return step === 0 ? "prompt" : (step % 2 ? "drawing" : "caption"); }

  function assignmentOrigin(players, nick, step) {
    if (!Array.isArray(players) || !players.length) return null;
    var index = players.indexOf(nick);
    if (index < 0) return null;
    return players[(index - step % players.length + players.length) % players.length];
  }
  function currentOrigin(nick) {
    return assignmentOrigin(state.players, nick || me().nick, state.stepIndex);
  }
  function currentChain(nick) {
    var origin = currentOrigin(nick);
    return origin && chains[origin] ? chains[origin] : [];
  }
  function previousEntry(nick) {
    if (state.stepIndex <= 0) return null;
    return currentChain(nick)[state.stepIndex - 1] || null;
  }
  function taskKey() {
    return [state.matchId || "idle", state.stepIndex, state.phase].join(":");
  }
  function mySubmitted() {
    return has(state.submitted, me().nick) || pendingSubmitScope === taskKey();
  }
  function allReady(players) {
    players = players || participantNicks();
    var host = api && api.host ? safeNick(api.host()) : "";
    return players.length >= MIN_PLAYERS && players.indexOf(host) >= 0 &&
      players.filter(function (nick) { return nick !== host; }).every(function (nick) { return has(state.ready, nick); });
  }

  function safeColor(value) {
    value = String(value || "").toLowerCase();
    return /^#[0-9a-f]{6}$/.test(value) ? value : "#17252f";
  }
  function safeCanvasBg(value) {
    value = String(value || "").toLowerCase();
    return /^#[0-9a-f]{6}$/.test(value) ? value : CANVAS_BG;
  }
  function safePoint(raw) {
    if (!raw) return null;
    var x = Number(raw.x), y = Number(raw.y);
    if (!isFinite(x) || !isFinite(y)) return null;
    return {
      x: Math.round(clamp(x, 0, 1) * POINT_PRECISION) / POINT_PRECISION,
      y: Math.round(clamp(y, 0, 1) * POINT_PRECISION) / POINT_PRECISION
    };
  }
  function sanitizeStrokes(raw) {
    if (!Array.isArray(raw)) return [];
    var total = 0, out = [];
    for (var i = 0; i < raw.length && out.length < MAX_STROKES && total < MAX_CANVAS_POINTS; i++) {
      var item = raw[i] || {};
      var points = [], source = Array.isArray(item.points) ? item.points : [];
      for (var j = 0; j < source.length && points.length < MAX_POINTS_PER_STROKE && total < MAX_CANVAS_POINTS; j++) {
        var point = safePoint(source[j]);
        if (!point) continue;
        points.push(point);
        total++;
      }
      if (!points.length) continue;
      out.push({
        id: safeText(item.id, 80) || ("stroke-" + out.length),
        color: safeColor(item.color),
        width: clamp(Number(item.width) || PEN_WIDTHS[0], 3, ERASER_WIDTH),
        points: points
      });
    }
    return out;
  }
  function sanitizeEntry(raw, kind, author, step) {
    raw = raw || {};
    kind = expectedKind(step == null ? Number(raw.step) || 0 : step);
    var entry = {
      kind: kind,
      author: safeNick(author || raw.author),
      step: clamp(Math.floor(Number(step == null ? raw.step : step) || 0), 0, MAX_PLAYERS - 1),
      auto: !!raw.auto
    };
    if (kind === "drawing") {
      entry.bg = safeCanvasBg(raw.bg);
      entry.strokes = sanitizeStrokes(raw.strokes);
    } else {
      entry.text = safeText(raw.text, MAX_TEXT) || (entry.auto ? "시간 안에 작성하지 못했어요" : "");
    }
    return entry;
  }
  function sanitizeState(raw) {
    raw = raw || {};
    var phases = ["idle", "prompt", "drawing", "caption", "finished"];
    var players = Array.isArray(raw.players) ? raw.players.map(safeNick).filter(Boolean).slice(0, MAX_PLAYERS) : [];
    var spectators = Array.isArray(raw.spectators) ? raw.spectators.map(safeNick).filter(Boolean).slice(0, 40) : [];
    var ready = Array.isArray(raw.ready) ? raw.ready.map(safeNick).filter(Boolean).slice(0, MAX_PLAYERS) : [];
    var submitted = Array.isArray(raw.submitted) ? raw.submitted.map(safeNick).filter(function (nick) {
      return players.indexOf(nick) >= 0;
    }) : [];
    return {
      phase: phases.indexOf(raw.phase) >= 0 ? raw.phase : "idle",
      rev: Math.max(0, Math.floor(Number(raw.rev) || 0)),
      matchId: safeText(raw.matchId, 80) || null,
      players: Array.from(new Set(players)),
      spectators: Array.from(new Set(spectators)),
      ready: Array.from(new Set(ready)),
      stepIndex: clamp(Math.floor(Number(raw.stepIndex) || 0), 0, Math.max(0, players.length - 1)),
      totalSteps: clamp(Math.floor(Number(raw.totalSteps) || players.length), 0, players.length),
      deadline: typeof raw.remainMs === "number" ? Date.now() + clamp(raw.remainMs, 0, DRAW_MS) :
        (Number(raw.deadline) || null),
      submitted: Array.from(new Set(submitted))
    };
  }

  function normalizePreviewPhase(value) {
    value = String(value || "").toLowerCase();
    if (value === "idle") value = "waiting";
    if (value === "finished") value = "result";
    return ["waiting", "prompt", "drawing", "caption", "result"].indexOf(value) >= 0 ? value : "waiting";
  }
  function previewStroke(id, color, width, points) {
    return {
      id: id,
      color: color,
      width: width,
      points: points.map(function (point) { return { x: point[0], y: point[1] }; })
    };
  }
  function previewCircle(id, color, width, cx, cy, radius) {
    var points = [];
    for (var i = 0; i <= 28; i++) {
      var angle = Math.PI * 2 * i / 28;
      points.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
    return previewStroke(id, color, width, points);
  }
  function previewDrawing(variant, author, step) {
    var shift = (variant % 3) * 0.035;
    var accent = ["#d9822b", "#2474b5", "#38a875"][variant % 3];
    return {
      kind: "drawing",
      author: author,
      step: step,
      auto: false,
      bg: CANVAS_BG,
      strokes: sanitizeStrokes([
        previewCircle("head-" + variant, accent, 12, 0.48 + shift, 0.45, 0.22),
        previewStroke("ear-left-" + variant, accent, 12, [[0.32 + shift, 0.31], [0.34 + shift, 0.16], [0.43 + shift, 0.27]]),
        previewStroke("ear-right-" + variant, accent, 12, [[0.53 + shift, 0.27], [0.63 + shift, 0.16], [0.65 + shift, 0.33]]),
        previewCircle("eye-left-" + variant, "#17252f", 14, 0.41 + shift, 0.42, 0.012),
        previewCircle("eye-right-" + variant, "#17252f", 14, 0.56 + shift, 0.42, 0.012),
        previewStroke("mouth-" + variant, "#17252f", 8, [[0.46 + shift, 0.51], [0.49 + shift, 0.54], [0.52 + shift, 0.51]]),
        previewStroke("body-" + variant, accent, 15, [[0.38 + shift, 0.66], [0.42 + shift, 0.58], [0.57 + shift, 0.58], [0.63 + shift, 0.78]]),
        previewStroke("ground-" + variant, "#7f9aa6", 7, [[0.22, 0.79], [0.78, 0.79]])
      ])
    };
  }
  function buildPreviewChains(players) {
    var prompts = [
      "우주에서 라면을 배달하는 고양이",
      "결혼식장에서 춤추는 펭귄",
      "치킨을 훔치다 걸린 공룡",
      "수영장에서 낮잠 자는 북극곰"
    ];
    var captions = [
      "우주복을 입은 고양이가 배달 중이에요",
      "신나게 춤추는 동물 같아요",
      "간식을 들고 도망가는 공룡이에요",
      "물가에서 쉬고 있는 북극곰이에요"
    ];
    var result = Object.create(null);
    players.forEach(function (origin, index) {
      result[origin] = [
        { kind: "prompt", author: origin, step: 0, auto: false, text: prompts[index % prompts.length] },
        previewDrawing(index, players[(index + 1) % players.length], 1),
        { kind: "caption", author: players[(index + 2) % players.length], step: 2, auto: false, text: captions[index % captions.length] },
        previewDrawing(index + 1, players[(index + 3) % players.length], 3)
      ];
    });
    return result;
  }
  function setPreviewPhase(value) {
    if (!api) return null;
    var key = normalizePreviewPhase(value);
    var selfNick = safeNick(me().nick) || "나";
    var players = [selfNick, "민서", "서준", "지우"];
    var phase = key === "waiting" ? "idle" : key === "result" ? "finished" : key;
    var stepIndex = phase === "drawing" ? 1 : phase === "caption" ? 2 : phase === "finished" ? 3 : 0;
    var submitted = phase === "prompt" ? ["민서", "서준"] :
      phase === "drawing" ? ["민서"] : phase === "caption" ? ["민서", "서준", "지우"] : [];
    state = {
      phase: phase,
      rev: state.rev + 1,
      matchId: "relay-ui-preview",
      players: phase === "idle" ? [] : players.slice(),
      spectators: ["도윤"],
      ready: phase === "idle" ? ["민서", "서준"] : [],
      stepIndex: stepIndex,
      totalSteps: players.length,
      deadline: isActivePhase(phase) ? Date.now() + (phase === "drawing" ? 68000 : 34000) : null,
      submitted: submitted
    };
    chains = buildPreviewChains(players);
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    albumIndex = 0;
    render();
    return key;
  }

  function snapshot() {
    return {
      phase: state.phase,
      rev: state.rev,
      matchId: state.matchId,
      players: state.players.slice(),
      spectators: state.spectators.slice(),
      ready: state.ready.slice(),
      stepIndex: state.stepIndex,
      totalSteps: state.totalSteps,
      remainMs: state.deadline ? Math.max(0, state.deadline - Date.now()) : null,
      submitted: state.submitted.slice()
    };
  }
  function clearChains(players) {
    chains = Object.create(null);
    (players || []).forEach(function (nick) { chains[nick] = []; });
    albumIndex = 0;
  }
  function applyState(raw, reset) {
    var next = sanitizeState(raw);
    if (!reset && next.rev < state.rev) return false;
    var matchChanged = next.matchId !== state.matchId;
    if (reset || matchChanged) clearChains(next.players);
    state = next;
    if (pendingSubmitScope && has(state.submitted, me().nick)) pendingSubmitScope = "";
    render();
    return true;
  }
  function storeEntry(origin, raw) {
    origin = safeNick(origin);
    if (!origin || !has(state.players, origin)) return false;
    var step = clamp(Math.floor(Number(raw && raw.step) || 0), 0, Math.max(0, state.totalSteps - 1));
    var entry = sanitizeEntry(raw, expectedKind(step), raw && raw.author, step);
    if (!entry.author || !has(state.players, entry.author)) return false;
    if (!chains[origin]) chains[origin] = [];
    if (chains[origin][step] && !chains[origin][step].auto) return false;
    chains[origin][step] = entry;
    render();
    return true;
  }

  function sendState(reset, to) {
    if (!api || !api.isHost()) return;
    api.send({ t: "relay_state", state: snapshot(), reset: !!reset, to: to || null });
    if (api.roomChanged) api.roomChanged();
  }
  function sendEntry(origin, entry, to) {
    if (!api || !api.isHost()) return;
    api.send({
      t: "relay_entry",
      matchId: state.matchId,
      origin: origin,
      entry: entry,
      to: to || null
    });
  }
  function sendFullSync(to) {
    if (!to) {
      sendState(false);
      return;
    }
    sendState(true, to);
    state.players.forEach(function (origin) {
      var chain = chains[origin] || [];
      chain.forEach(function (entry) { if (entry) sendEntry(origin, entry, to); });
    });
  }

  function hostSetReady(nick, ready) {
    if (!api || !api.isHost() || !canChangeRole()) return;
    nick = safeNick(nick);
    if (!nick || !has(participantNicks(), nick) || nick === api.host()) return;
    var next = state.ready.filter(function (item) { return item !== nick; });
    if (ready) next.push(nick);
    if (sameList(next, state.ready)) return;
    state.ready = next;
    state.rev++;
    sendState(false);
  }
  function toggleReady() {
    if (!api || !canChangeRole() || me().nick === api.host() || has(state.spectators, me().nick)) return;
    api.send({ t: "relay_ready", nick: me().nick, ready: !has(state.ready, me().nick) });
  }
  function hostSetRole(nick, spectator) {
    if (!api || !api.isHost() || !canChangeRole()) return;
    nick = safeNick(nick);
    if (!nick || !activePeople().some(function (person) { return person.nick === nick; })) return;
    var next = state.spectators.filter(function (item) { return item !== nick; });
    if (spectator) next.push(nick);
    state.spectators = next;
    state.ready = state.ready.filter(function (item) { return item !== nick; });
    state.rev++;
    sendState(false);
  }
  function toggleRole() {
    if (!api || !canChangeRole()) {
      if (api) api.toast("게임이 끝난 뒤 역할을 바꿀 수 있어요");
      return;
    }
    var spectator = !has(state.spectators, me().nick);
    api.send({ t: "relay_role", nick: me().nick, spectator: spectator });
    if (api.setHostEligible) api.setHostEligible(!spectator);
  }

  function hostStartMatch() {
    if (!api || !api.isHost() || !canChangeRole()) return false;
    var players = participantNicks();
    if (players.length < MIN_PLAYERS) {
      api.toast("이어그리기는 최소 3명이 필요해요");
      return false;
    }
    if (!allReady(players)) {
      api.toast("모든 참가자가 레디해야 시작할 수 있어요");
      return false;
    }
    state = {
      phase: "prompt",
      rev: state.rev + 1,
      matchId: "relay-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1e5).toString(36),
      players: players,
      spectators: state.spectators.filter(function (nick) { return players.indexOf(nick) < 0; }),
      ready: [],
      stepIndex: 0,
      totalSteps: players.length,
      deadline: Date.now() + TEXT_MS,
      submitted: []
    };
    clearChains(players);
    pendingSubmitScope = "";
    taskScope = "";
    inputScope = "";
    sendState(true);
    return true;
  }
  function fallbackEntry(nick) {
    var kind = expectedKind(state.stepIndex);
    return kind === "drawing"
      ? { kind: kind, author: nick, step: state.stepIndex, auto: true, bg: CANVAS_BG, strokes: [] }
      : { kind: kind, author: nick, step: state.stepIndex, auto: true, text: "시간 안에 작성하지 못했어요" };
  }
  function hostAcceptSubmission(nick, raw, deferAdvance) {
    if (!api || !api.isHost() || !isActivePhase()) return false;
    nick = safeNick(nick);
    if (!has(state.players, nick) || has(state.submitted, nick)) return false;
    var origin = assignmentOrigin(state.players, nick, state.stepIndex);
    if (!origin) return false;
    var entry = sanitizeEntry(raw, expectedKind(state.stepIndex), nick, state.stepIndex);
    if (entry.kind !== "drawing" && !entry.text) return false;
    if (!chains[origin]) chains[origin] = [];
    chains[origin][state.stepIndex] = entry;
    sendEntry(origin, entry);
    state.submitted.push(nick);
    state.rev++;
    if (!deferAdvance && state.submitted.length >= state.players.length) hostAdvanceStep();
    else sendState(false);
    return true;
  }
  function hostAdvanceStep() {
    if (!api || !api.isHost() || !isActivePhase()) return;
    var nextStep = state.stepIndex + 1;
    state.submitted = [];
    pendingSubmitScope = "";
    if (nextStep >= state.totalSteps) {
      state.phase = "finished";
      state.deadline = null;
      state.ready = [];
      state.rev++;
      albumIndex = 0;
      sendState(false);
      saveFinishedAlbums();
      return;
    }
    state.stepIndex = nextStep;
    state.phase = phaseForStep(nextStep);
    state.deadline = Date.now() + durationForPhase(state.phase);
    state.rev++;
    sendState(false);
  }
  function hostFinishExpiredStep() {
    if (!api || !api.isHost() || !isActivePhase()) return;
    var missing = state.players.filter(function (nick) { return !has(state.submitted, nick); });
    missing.forEach(function (nick) { hostAcceptSubmission(nick, fallbackEntry(nick), true); });
    hostAdvanceStep();
  }
  function textInputForPhase() {
    return state.phase === "caption" ? $("relay-caption-input") : $("relay-text-input");
  }
  function submitText() {
    if (!api || (state.phase !== "prompt" && state.phase !== "caption") || !has(state.players, me().nick) || mySubmitted()) return;
    var input = textInputForPhase();
    var text = safeText(input && input.value, MAX_TEXT);
    if (!text) {
      api.toast("문장을 먼저 적어주세요");
      return;
    }
    pendingSubmitScope = taskKey();
    api.send({
      t: "relay_submit",
      matchId: state.matchId,
      stepIndex: state.stepIndex,
      nick: me().nick,
      entry: { kind: expectedKind(state.stepIndex), text: text }
    });
    render();
  }
  function submitDrawing() {
    if (!api || state.phase !== "drawing" || !has(state.players, me().nick) || mySubmitted()) return;
    if (!localStrokes.length) {
      api.toast("그림을 조금이라도 그려주세요");
      return;
    }
    pendingSubmitScope = taskKey();
    api.send({
      t: "relay_submit",
      matchId: state.matchId,
      stepIndex: state.stepIndex,
      nick: me().nick,
      entry: { kind: "drawing", bg: canvasBg, strokes: sanitizeStrokes(localStrokes) }
    });
    render();
  }
  function autoSubmitCurrentState() {
    if (!api || !isActivePhase() || !has(state.players, me().nick) || mySubmitted()) return false;
    var entry;
    if (state.phase === "drawing") {
      entry = { kind: "drawing", bg: canvasBg, strokes: sanitizeStrokes(localStrokes), auto: true };
    } else {
      var input = textInputForPhase();
      entry = {
        kind: expectedKind(state.stepIndex),
        text: safeText(input && input.value, MAX_TEXT) || "시간 안에 작성하지 못했어요",
        auto: true
      };
    }
    pendingSubmitScope = taskKey();
    api.send({
      t: "relay_submit",
      matchId: state.matchId,
      stepIndex: state.stepIndex,
      nick: me().nick,
      entry: entry
    });
    render();
    return true;
  }

  function onMessage(msg) {
    if (!msg || typeof msg.t !== "string" || msg.t.indexOf("relay_") !== 0) return false;
    if (msg.to && msg.to !== me().nick) return true;
    if (msg.t === "relay_state") {
      applyState(msg.state, !!msg.reset);
    } else if (msg.t === "relay_sync_request") {
      if (api && api.isHost() && msg.nick !== me().nick) sendFullSync(msg.nick);
    } else if (msg.t === "relay_ready") {
      if (api && api.isHost()) hostSetReady(msg.nick, !!msg.ready);
    } else if (msg.t === "relay_role") {
      if (api && api.isHost()) hostSetRole(msg.nick, !!msg.spectator);
    } else if (msg.t === "relay_start") {
      if (api && api.isHost() && msg.nick === api.host()) hostStartMatch();
    } else if (msg.t === "relay_submit") {
      if (api && api.isHost() && msg.matchId === state.matchId && Number(msg.stepIndex) === state.stepIndex) {
        hostAcceptSubmission(msg.nick, msg.entry, false);
      }
    } else if (msg.t === "relay_entry") {
      if (msg.matchId === state.matchId) storeEntry(msg.origin, msg.entry);
    }
    return true;
  }

  function onPresence(_list, options) {
    if (!api) return;
    var active = activePeople().map(function (person) { return person.nick; });
    if (api.isHost() && canChangeRole()) {
      var spectators = state.spectators.filter(function (nick) { return active.indexOf(nick) >= 0; });
      var participants = active.filter(function (nick) { return spectators.indexOf(nick) < 0; }).slice(0, MAX_PLAYERS);
      var ready = state.ready.filter(function (nick) { return participants.indexOf(nick) >= 0 && nick !== api.host(); });
      if (!sameList(spectators, state.spectators) || !sameList(ready, state.ready)) {
        state.spectators = spectators;
        state.ready = ready;
        state.rev++;
        sendState(false);
      } else if (options && options.becameHost) sendState(false);
    } else if (api.isHost() && options && options.becameHost) {
      sendState(false);
    }
    render();
  }
  function onReady() {
    if (!api) return;
    if (api.isHost()) sendState(false);
    else api.send({ t: "relay_sync_request", nick: me().nick });
  }

  function canvasMetrics(target) {
    var width = target ? target.width : 720;
    var height = target ? target.height : 720;
    return { width: width, height: height };
  }
  function paintStrokes(targetCtx, targetCanvas, strokes, bg) {
    if (!targetCtx || !targetCanvas) return;
    var metrics = canvasMetrics(targetCanvas);
    targetCtx.save();
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.fillStyle = bg || CANVAS_BG;
    targetCtx.fillRect(0, 0, metrics.width, metrics.height);
    (strokes || []).forEach(function (stroke) {
      var points = stroke.points || [];
      if (!points.length) return;
      targetCtx.beginPath();
      targetCtx.lineCap = "round";
      targetCtx.lineJoin = "round";
      targetCtx.strokeStyle = stroke.color || "#17252f";
      targetCtx.lineWidth = (stroke.width || PEN_WIDTHS[0]) * (metrics.width / 720);
      targetCtx.moveTo(points[0].x * metrics.width, points[0].y * metrics.height);
      if (points.length === 1) {
        targetCtx.lineTo(points[0].x * metrics.width + .01, points[0].y * metrics.height + .01);
      } else {
        for (var i = 1; i < points.length; i++) targetCtx.lineTo(points[i].x * metrics.width, points[i].y * metrics.height);
      }
      targetCtx.stroke();
    });
    targetCtx.restore();
  }
  function galleryBlob(entry, quality) {
    return new Promise(function (resolve, reject) {
      if (!document.createElement) { reject(new Error("canvas unavailable")); return; }
      var output = document.createElement("canvas");
      output.width = GALLERY_IMAGE_SIZE;
      output.height = GALLERY_IMAGE_SIZE;
      var outputCtx = output.getContext && output.getContext("2d");
      if (!outputCtx || !output.toBlob) { reject(new Error("image export unavailable")); return; }
      paintStrokes(outputCtx, output, entry.strokes || [], entry.bg || CANVAS_BG);
      output.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("image export failed"));
      }, "image/webp", quality);
    });
  }
  async function compactGalleryBlob(entry) {
    var blob = await galleryBlob(entry, GALLERY_IMAGE_QUALITY);
    if (blob.size > GALLERY_IMAGE_MAX_BYTES) blob = await galleryBlob(entry, 0.58);
    if (!blob.size || blob.size > GALLERY_IMAGE_MAX_BYTES) throw new Error("image too large");
    return blob;
  }
  async function blobBase64(blob) {
    var bytes = new Uint8Array(await blob.arrayBuffer());
    var binary = "";
    for (var i = 0; i < bytes.length; i += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    return window.btoa(binary);
  }
  async function savedAlbumEntry(entry, index) {
    if (entry.kind !== "drawing") {
      return { stepIndex: index, kind: entry.kind, author: entry.author, text: entry.text || "내용 없음" };
    }
    var blob = await compactGalleryBlob(entry);
    return {
      stepIndex: index,
      kind: "drawing",
      author: entry.author,
      mimeType: "image/webp",
      byteSize: blob.size,
      imageBase64: await blobBase64(blob)
    };
  }
  async function saveFinishedAlbums() {
    if (previewMode || !api || !api.isHost() || !api.saveRelayAlbum || state.phase !== "finished" || !state.matchId) return;
    var matchId = state.matchId;
    if (gallerySavedMatches[matchId]) return;
    gallerySavedMatches[matchId] = true;
    var galleryApi = api;
    var players = state.players.slice();
    var albums = players.map(function (origin) {
      return { origin: origin, entries: (chains[origin] || []).slice() };
    });
    for (var albumAt = 0; albumAt < albums.length; albumAt++) {
      var album = albums[albumAt];
      if (album.entries.length !== players.length || album.entries.some(function (entry) { return !entry; })) continue;
      try {
        var entries = [];
        for (var entryAt = 0; entryAt < album.entries.length; entryAt++) {
          entries.push(await savedAlbumEntry(album.entries[entryAt], entryAt));
        }
        var result = await galleryApi.saveRelayAlbum({
          matchId: matchId,
          origin: album.origin,
          playerCount: players.length,
          entries: entries
        });
        if (!result || !result.ok) throw new Error(result && (result.msg || result.reason) || "save failed");
      } catch (error) {
        if (window.console && console.warn) console.warn("Relay gallery save failed:", error);
      }
    }
  }
  function redrawLocal() { paintStrokes(ctx, canvas, localStrokes, canvasBg); }
  function showPreviousDrawing() {
    var previous = previousEntry(me().nick);
    if (previous && previous.kind === "drawing") paintStrokes(ctx, canvas, previous.strokes, previous.bg);
    else paintStrokes(ctx, canvas, [], CANVAS_BG);
  }
  function syncCanvasForTask() {
    var scope = taskKey();
    if (taskScope === scope) return;
    taskScope = scope;
    warningScope = "";
    drawing = false;
    currentStroke = null;
    if (state.phase === "drawing") {
      localStrokes = [];
      canvasBg = CANVAS_BG;
      redrawLocal();
    } else if (state.phase === "caption") {
      localStrokes = [];
      canvasBg = CANVAS_BG;
      showPreviousDrawing();
    } else {
      localStrokes = [];
      canvasBg = CANVAS_BG;
      paintStrokes(ctx, canvas, [], CANVAS_BG);
    }
  }
  function canDraw() {
    return state.phase === "drawing" && has(state.players, me().nick) && !mySubmitted();
  }
  function canvasPoint(event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1)
    };
  }
  function pointerDown(event) {
    if (!canDraw() || localStrokes.length >= MAX_STROKES) return;
    setPaletteOpen(false);
    drawing = true;
    if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
    currentStroke = {
      id: me().nick + "-" + Date.now().toString(36) + "-" + localStrokes.length,
      color: selectedTool === "eraser" ? canvasBg : selectedColor,
      width: selectedTool === "eraser" ? ERASER_WIDTH : PEN_WIDTHS[selectedColorSlot],
      points: [canvasPoint(event)]
    };
    localStrokes.push(currentStroke);
    redrawLocal();
    event.preventDefault();
  }
  function pointerMove(event) {
    if (!drawing || !currentStroke || !canDraw()) return;
    if (currentStroke.points.length >= MAX_POINTS_PER_STROKE) return;
    var point = canvasPoint(event);
    var previous = currentStroke.points[currentStroke.points.length - 1];
    var dx = (point.x - previous.x) * 720, dy = (point.y - previous.y) * 720;
    if (dx * dx + dy * dy < 5) return;
    currentStroke.points.push(point);
    redrawLocal();
    event.preventDefault();
  }
  function pointerUp(event) {
    if (!drawing) return;
    drawing = false;
    currentStroke = null;
    if (canvas.releasePointerCapture) {
      try { canvas.releasePointerCapture(event.pointerId); } catch (e) {}
    }
    redrawLocal();
  }

  function toggleHidden(element, hidden) { if (element) element.classList.toggle("hidden", !!hidden); }
  function renderRoster() {
    var box = $("relay-roster");
    if (!box) return;
    var rows = isActivePhase() || state.phase === "finished"
      ? state.players.map(function (nick) { return { nick: nick, spectator: false }; }).concat(
          state.spectators.map(function (nick) { return { nick: nick, spectator: true }; })
        )
      : orderedPeople().map(function (person) { return { nick: person.nick, spectator: has(state.spectators, person.nick) }; });
    box.innerHTML = rows.map(function (row) {
      var cls = "relay-person" + (row.nick === me().nick ? " me" : "") +
        (row.spectator ? " spectator" : "") + (has(state.submitted, row.nick) ? " done" : "");
      var crown = api && row.nick === api.host() ? " 👑" : "";
      return '<span class="' + cls + '">' + esc(row.nick) + crown + (row.spectator ? " · 관전" : "") + "</span>";
    }).join("");
    if ($("relay-online-num")) $("relay-online-num").textContent = rows.length;
  }
  function renderProgress() {
    var box = $("relay-progress");
    if (!box) return;
    if (!isActivePhase()) { box.innerHTML = ""; return; }
    var html = "";
    for (var i = 0; i < state.totalSteps; i++) {
      html += '<span class="' + (i < state.stepIndex ? "passed" : i === state.stepIndex ? "active" : "") + '"></span>';
    }
    box.innerHTML = html;
  }
  function renderIdle() {
    var participants = participantNicks();
    var host = api ? api.host() : "";
    var allPeople = orderedPeople();
    var participantPeople = allPeople.filter(function (person) { return !has(state.spectators, person.nick); });
    var spectatorPeople = allPeople.filter(function (person) { return has(state.spectators, person.nick); });
    function namesHtml(list, spectator) {
      if (!list.length) return "";
      return list.map(function (person) {
        var away = !!person.away;
        var crown = !away && person.nick === host
          ? '<span class="catch-lobby-crown" title="방장" aria-label="방장">👑</span>'
          : "";
        var mine = person.nick === me().nick ? " mine" : "";
        var cls = "catch-lobby-name" + (spectator ? " spectator" : "") + mine + (away ? " away" : "");
        var readyBadge = !spectator && !away && person.nick !== host && has(state.ready, person.nick)
          ? '<span class="catch-lobby-ready" title="레디" aria-label="레디">✓</span>'
          : "";
        var awayBadge = away ? '<span class="catch-lobby-away">자리비움</span>' : "";
        return '<span class="' + cls + '"><b>' + esc(person.nick) + '</b>' + crown + readyBadge + awayBadge + "</span>";
      }).join("");
    }
    var participantRow = $("relay-lobby-participant-row");
    var spectatorRow = $("relay-lobby-spectator-row");
    if ($("relay-lobby-participant-count")) $("relay-lobby-participant-count").textContent = participantPeople.length;
    if ($("relay-lobby-spectator-count")) $("relay-lobby-spectator-count").textContent = spectatorPeople.length;
    if ($("relay-lobby-participants")) $("relay-lobby-participants").innerHTML = namesHtml(participantPeople, false);
    if ($("relay-lobby-spectators")) $("relay-lobby-spectators").innerHTML = namesHtml(spectatorPeople, true);
    if (participantRow) participantRow.classList.toggle("empty", !participantPeople.length);
    if (spectatorRow) spectatorRow.classList.toggle("empty", !spectatorPeople.length);
    var amHost = api && api.isHost();
    var readyButton = $("relay-ready-btn"), startButton = $("relay-start-btn");
    var amSpectator = has(state.spectators, me().nick);
    toggleHidden($("relay-idle-actions"), amSpectator);
    toggleHidden(readyButton, amHost || amSpectator);
    toggleHidden(startButton, !amHost);
    if (readyButton) {
      var ready = has(state.ready, me().nick);
      readyButton.textContent = ready ? "레디 취소" : "레디";
      readyButton.setAttribute("aria-pressed", ready ? "true" : "false");
    }
    if (startButton) {
      startButton.disabled = !allReady(participants);
      startButton.textContent = allReady(participants) ? "게임 시작" :
        participants.length < MIN_PLAYERS ? "3명 이상 모이면 시작" : "모두 준비되면 시작";
    }
  }
  function renderTextTask() {
    var input = $("relay-text-input");
    if ($("relay-text-panel")) $("relay-text-panel").classList.add("prompt");
    if (inputScope !== taskKey()) {
      inputScope = taskKey();
      if (input) input.value = "";
    }
    if ($("relay-text-title")) $("relay-text-title").textContent = "스토리 시작";
    if ($("relay-text-hint")) $("relay-text-hint").textContent = "나만의 간단한 이야기를 만들어요!";
    if ($("relay-suggest-btn")) $("relay-suggest-btn").textContent = "자동 생성";
    if ($("relay-text-submit")) {
      $("relay-text-submit").textContent = mySubmitted() ? "제출 완료" : "제출하기";
      $("relay-text-submit").disabled = mySubmitted();
    }
    if (input) input.disabled = mySubmitted();
  }
  function renderCaptionTask() {
    var input = $("relay-caption-input");
    if (inputScope !== taskKey()) {
      inputScope = taskKey();
      if (input) input.value = "";
    }
    if (input) input.disabled = mySubmitted();
    if ($("relay-caption-submit")) {
      $("relay-caption-submit").disabled = mySubmitted();
      $("relay-caption-submit").textContent = mySubmitted() ? "제출 완료" : "제출하기";
    }
  }
  function renderWordbar() {
    var label = $("relay-task-label"), text = $("relay-task-text");
    if (!label || !text) return;
    if (state.phase === "prompt") {
      label.textContent = ""; text.textContent = "누군가가 그릴 문장 만들기";
    } else if (state.phase === "drawing") {
      var previous = previousEntry(me().nick);
      label.textContent = "받은 문장";
      text.textContent = previous && previous.text ? previous.text : "문장을 불러오는 중";
    } else if (state.phase === "caption") {
      label.textContent = ""; text.textContent = "그림을 한 문장으로 설명하세요";
    } else if (state.phase === "finished") {
      label.textContent = ""; text.textContent = "";
    } else {
      label.textContent = "진행"; text.textContent = "문장 ↔ 그림";
    }
  }
  function renderTimer() {
    var timer = $("relay-timer");
    if (!timer) return;
    if (!state.deadline || !isActivePhase()) {
      timer.textContent = "--";
      timer.classList.remove("urgent");
      return;
    }
    var seconds = Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));
    timer.textContent = Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
    timer.classList.toggle("urgent", seconds > 0 && seconds <= 5);
    if (seconds > 0 && seconds <= 5 && warningScope !== taskKey()) {
      warningScope = taskKey();
      if (!previewMode && api && api.playWarning) api.playWarning();
    }
  }
  function renderResults() {
    if (!state.players.length) return;
    albumIndex = clamp(albumIndex, 0, state.players.length - 1);
    var origin = state.players[albumIndex];
    var chain = chains[origin] || [];
    var box = $("relay-chain");
    if (!box) return;
    box.innerHTML = chain.map(function (entry, index) {
      if (!entry) return "";
      var cls = "relay-chain-item" + (entry.kind === "prompt" ? " prompt" : "");
      var content = entry.kind === "drawing"
        ? '<div class="relay-chain-drawing"><canvas width="480" height="480" data-relay-result-step="' + index + '"></canvas></div>'
        : '<div class="relay-chain-copy relay-chain-text"><div class="relay-chain-meta"><b>' + esc(entry.author) + '</b></div>'
          + '<strong title="' + esc(entry.text || "내용 없음") + '">' + esc(entry.text || "내용 없음") + '</strong></div>';
      if (entry.kind === "drawing") {
        content = '<div class="relay-chain-copy"><div class="relay-chain-meta"><b>' + esc(entry.author) + '</b></div></div>' + content;
      }
      return '<article class="' + cls + '">' + content + "</article>";
    }).join("");
    if (!chain.length) box.innerHTML = '<p class="relay-chain-empty">앨범 내용을 불러오는 중이에요.</p>';
    var canvases = box.querySelectorAll("[data-relay-result-step]");
    for (var i = 0; i < canvases.length; i++) {
      var step = Number(canvases[i].getAttribute("data-relay-result-step"));
      var entry = chain[step];
      if (entry) paintStrokes(canvases[i].getContext("2d"), canvases[i], entry.strokes, entry.bg);
    }
    if ($("relay-album-prev")) $("relay-album-prev").disabled = state.players.length < 2;
    if ($("relay-album-next")) {
      $("relay-album-next").disabled = state.players.length < 2;
    }
    if ($("relay-album-position")) {
      $("relay-album-position").textContent = (albumIndex + 1) + " / " + state.players.length;
      $("relay-album-position").setAttribute("aria-label", (albumIndex + 1) + "번째 앨범, 전체 " + state.players.length + "개");
    }
    if ($("relay-again-btn")) {
      if (api && api.isHost()) {
        $("relay-again-btn").textContent = "게임 시작";
        $("relay-again-btn").disabled = !allReady(participantNicks());
        $("relay-again-btn").setAttribute("aria-pressed", "false");
      } else {
        var spectator = has(state.spectators, me().nick);
        var ready = has(state.ready, me().nick);
        $("relay-again-btn").textContent = spectator ? "관전 중" : ready ? "레디 취소" : "레디";
        $("relay-again-btn").disabled = spectator;
        $("relay-again-btn").setAttribute("aria-pressed", ready ? "true" : "false");
      }
    }
  }

  function galleryTime(value) {
    var time = new Date(value || 0);
    if (isNaN(time.getTime())) return "";
    var now = new Date();
    if (time.toDateString() === now.toDateString()) {
      return String(time.getHours()).padStart(2, "0") + ":" + String(time.getMinutes()).padStart(2, "0");
    }
    return (time.getMonth() + 1) + "." + time.getDate();
  }
  function renderGallery() {
    var grid = $("relay-gallery-grid");
    var status = $("relay-gallery-status");
    var more = $("relay-gallery-more");
    if (!grid || !status) return;
    if (galleryLoading && !galleryRows.length) {
      status.textContent = "앨범을 불러오는 중이에요";
      grid.innerHTML = "";
    } else if (galleryError) {
      status.textContent = galleryError;
      grid.innerHTML = '<div class="cm-gallery-empty">앨범 갤러리를 열 수 없어요.<br>잠시 뒤 다시 시도해주세요.</div>';
    } else {
      status.textContent = "최근 앨범 " + galleryTotal + "개 · 최대 100개 보관";
      grid.innerHTML = galleryRows.length ? galleryRows.map(function (row) {
        var id = Math.max(0, Math.floor(Number(row.id) || 0));
        var cover = esc(row.coverUrl || "");
        var startText = esc(row.startText || "내용 없음");
        var origin = esc(row.origin || "알 수 없음");
        var coverHtml = cover
          ? '<img src="' + cover + '" alt="' + startText + ' 앨범 대표 그림" loading="lazy">'
          : '<span class="relay-gallery-no-cover">그림 없음</span>';
        return '<article class="cm-gallery-item relay-gallery-item">'
          + '<div class="cm-gallery-media relay-gallery-media"><button class="cm-gallery-thumb relay-gallery-cover" type="button" data-relay-gallery-open="' + id + '" aria-label="' + startText + ' 앨범 보기">'
          + coverHtml + '</button></div>'
          + '<div class="cm-gallery-copy relay-gallery-copy"><strong>' + startText + '</strong><span>'
          + origin + '의 앨범 · ' + Math.max(0, Math.floor(Number(row.entryCount) || 0)) + '단계 · ' + esc(galleryTime(row.createdAt))
          + '</span></div></article>';
      }).join("") : '<div class="cm-gallery-empty">아직 저장된 앨범이 없어요.<br>완성한 이어그리기 앨범이 여기에 모여요.</div>';
    }
    if (more) {
      more.classList.toggle("hidden", !galleryHasMore);
      more.disabled = galleryLoading;
      more.textContent = galleryLoading ? "불러오는 중…" : "더 보기";
    }
  }
  async function loadGallery(reset) {
    if (!api || !api.loadRelayAlbums || galleryLoading) return;
    if (reset) {
      galleryRows = [];
      galleryOffset = 0;
      galleryTotal = 0;
      galleryHasMore = false;
      galleryError = "";
    }
    galleryLoading = true;
    var token = ++galleryRequestToken;
    renderGallery();
    try {
      var result = await api.loadRelayAlbums(galleryOffset, GALLERY_PAGE_SIZE);
      if (token !== galleryRequestToken) return;
      if (!result || !result.ok) throw new Error(result && (result.msg || result.reason) || "load failed");
      var rows = Array.isArray(result.rows) ? result.rows : [];
      galleryRows = reset ? rows : galleryRows.concat(rows);
      galleryOffset = galleryRows.length;
      galleryTotal = clamp(Math.floor(Number(result.total) || galleryRows.length), 0, 100);
      galleryHasMore = !!result.hasMore;
    } catch (error) {
      if (token === galleryRequestToken) {
        galleryRows = [];
        galleryHasMore = false;
        galleryError = "앨범을 불러오지 못했어요. 잠시 뒤 다시 열어주세요.";
      }
    } finally {
      if (token === galleryRequestToken) {
        galleryLoading = false;
        renderGallery();
      }
    }
  }
  function galleryRow(id) {
    id = Number(id);
    for (var i = 0; i < galleryRows.length; i++) {
      if (Number(galleryRows[i].id) === id) return galleryRows[i];
    }
    return null;
  }
  function renderGalleryDetail(album) {
    var chain = $("relay-gallery-preview-chain");
    if (!chain) return;
    var entries = album && Array.isArray(album.entries) ? album.entries : [];
    chain.innerHTML = entries.length ? entries.map(function (entry) {
      var author = esc(entry.author || "알 수 없음");
      if (entry.kind === "drawing") {
        var imageUrl = esc(entry.imageUrl || "");
        return '<article class="relay-chain-item"><div class="relay-chain-copy"><div class="relay-chain-meta"><b>' + author + '</b></div></div>'
          + '<div class="relay-chain-drawing"><img class="relay-gallery-entry-image" src="' + imageUrl + '" alt="' + author + '님의 그림" loading="lazy"></div></article>';
      }
      var text = esc(entry.text || "내용 없음");
      return '<article class="relay-chain-item"><div class="relay-chain-copy relay-chain-text"><div class="relay-chain-meta"><b>' + author + '</b></div>'
        + '<strong>' + text + '</strong></div></article>';
    }).join("") : '<div class="relay-gallery-detail-error">앨범 내용을 찾을 수 없어요.</div>';
  }
  async function openGalleryDetail(id) {
    var row = galleryRow(id);
    var preview = $("relay-gallery-preview");
    var chain = $("relay-gallery-preview-chain");
    if (!row || !preview || !chain || !api || !api.loadRelayAlbum) return;
    preview.classList.remove("hidden");
    preview.setAttribute("aria-hidden", "false");
    $("relay-gallery-preview-title").textContent = row.startText || "이어그리기 앨범";
    $("relay-gallery-preview-meta").textContent = (row.origin || "알 수 없음") + "의 앨범 · " + galleryTime(row.createdAt);
    chain.innerHTML = '<div class="relay-gallery-detail-loading">앨범 내용을 불러오는 중이에요</div>';
    var token = ++galleryDetailToken;
    try {
      var result = await api.loadRelayAlbum(row.id);
      if (token !== galleryDetailToken) return;
      if (!result || !result.ok || !result.album) throw new Error("load failed");
      var album = result.album;
      $("relay-gallery-preview-title").textContent = album.startText || row.startText || "이어그리기 앨범";
      $("relay-gallery-preview-meta").textContent = (album.origin || row.origin || "알 수 없음") + "의 앨범 · " + galleryTime(album.createdAt || row.createdAt);
      renderGalleryDetail(album);
      chain.scrollTop = 0;
    } catch (error) {
      if (token === galleryDetailToken) chain.innerHTML = '<div class="relay-gallery-detail-error">앨범 내용을 불러오지 못했어요.<br>잠시 뒤 다시 열어주세요.</div>';
    }
  }
  function closeGalleryDetail() {
    galleryDetailToken++;
    var preview = $("relay-gallery-preview");
    if (preview) {
      preview.classList.add("hidden");
      preview.setAttribute("aria-hidden", "true");
    }
    var chain = $("relay-gallery-preview-chain");
    if (chain) chain.innerHTML = "";
  }
  function bindGallery() {
    if (galleryBound) return;
    galleryBound = true;
    var openButton = $("relay-gallery-btn");
    var closeButton = $("relay-gallery-close");
    var backdrop = $("relay-gallery-backdrop");
    var more = $("relay-gallery-more");
    var grid = $("relay-gallery-grid");
    var detailClose = $("relay-gallery-preview-close");
    if (openButton) openButton.addEventListener("click", function () { openGallery(); });
    if (closeButton) closeButton.addEventListener("click", closeGallery);
    if (backdrop) backdrop.addEventListener("click", function (event) { if (event.target === backdrop) closeGallery(); });
    if (more) more.addEventListener("click", function () { loadGallery(false); });
    if (detailClose) detailClose.addEventListener("click", closeGalleryDetail);
    if (grid) grid.addEventListener("click", function (event) {
      var button = event.target.closest && event.target.closest("[data-relay-gallery-open]");
      if (button) openGalleryDetail(button.getAttribute("data-relay-gallery-open"));
    });
  }
  function openGallery(nextApi) {
    if (nextApi) api = nextApi;
    bindGallery();
    var backdrop = $("relay-gallery-backdrop");
    if (!backdrop) return;
    closeGalleryDetail();
    backdrop.classList.remove("hidden");
    backdrop.setAttribute("aria-hidden", "false");
    loadGallery(true);
  }
  function closeGallery() {
    galleryRequestToken++;
    galleryLoading = false;
    var backdrop = $("relay-gallery-backdrop");
    if (backdrop) {
      backdrop.classList.add("hidden");
      backdrop.setAttribute("aria-hidden", "true");
    }
    closeGalleryDetail();
  }
  function scrollAlbumToTop() {
    if (!window.scrollTo) return;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    } catch (error) {
      window.scrollTo(0, 0);
    }
  }
  function renderPlayers(box, hint) {
    if (!box || !api) return;
    if (hint) {
      hint.className = "players-hint";
      hint.textContent = "이어그리기 참가 여부와 현재 제출 상태입니다.";
    }
    var list = orderedPeople();
    box.innerHTML = list.map(function (person) {
      var spectator = has(state.spectators, person.nick);
      var active = has(state.players, person.nick);
      var done = has(state.submitted, person.nick);
      var role = spectator ? "관전" : done ? "제출" : active || canChangeRole() ? "참가" : "다음 게임";
      var cls = done ? "done" : active ? "active" : "";
      return '<div class="prow"><span class="pname"><span class="rtag relay-role-tag ' + cls + '">' + role + "</span>"
        + esc(person.nick) + (person.nick === api.host() ? ' <span class="mini-host">방장</span>' : "")
        + (person.nick === me().nick ? ' <span class="mini-me">나</span>' : "") + "</span></div>";
    }).join("");
  }
  function render() {
    if (!api) return;
    syncAudio();
    syncCanvasForTask();
    renderRoster();
    renderProgress();
    renderWordbar();
    renderTimer();
    var active = isActivePhase();
    var idle = !active && state.phase !== "finished";
    var finished = state.phase === "finished";
    if ($("relaygame")) $("relaygame").classList.toggle("result-active", finished);
    if ($("relay-board-wrap")) $("relay-board-wrap").classList.toggle("result-mode", finished);
    toggleHidden($("relay-idle"), !idle);
    toggleHidden($("relay-idle-actions"), !idle);
    toggleHidden($("relay-text-panel"), state.phase !== "prompt");
    toggleHidden($("relay-prompt-actions"), state.phase !== "prompt");
    toggleHidden($("relay-caption-row"), state.phase !== "caption");
    toggleHidden($("relay-result-panel"), !finished);
    toggleHidden($("relay-result-dock"), !finished);
    toggleHidden($("relay-tools"), state.phase !== "drawing");
    if (state.phase !== "drawing") setPaletteOpen(false);
    toggleHidden($("relay-draw-submit"), state.phase !== "drawing");
    toggleHidden($("relay-chat-row"), !idle);
    if ($("relay-status")) $("relay-status").textContent = active
      ? (state.stepIndex + 1) + " / " + state.totalSteps + " 단계"
      : state.phase === "finished" ? "게임 종료" : "게임 대기 중";
    if ($("relay-phase-name")) $("relay-phase-name").textContent = phaseName(state.phase);
    if ($("relay-role-btn")) {
      var spectator = has(state.spectators, me().nick);
      $("relay-role-btn").textContent = spectator ? "참가하기" : "관전하기";
      $("relay-role-btn").setAttribute("aria-pressed", spectator ? "true" : "false");
      $("relay-role-btn").disabled = !canChangeRole();
    }
    if (idle) renderIdle();
    if (state.phase === "prompt") {
      renderTextTask();
    } else if (state.phase === "caption") renderCaptionTask();
    if (state.phase === "drawing") {
      if ($("relay-draw-submit")) {
        $("relay-draw-submit").disabled = mySubmitted();
        $("relay-draw-submit").textContent = mySubmitted() ? "그림 제출 완료" : "그림 제출하기";
      }
    }
    if (state.phase === "finished") renderResults();
    syncToolButtons();
  }

  function colorSlotFromButton(button, fallback) {
    var raw = button ? Number(button.getAttribute("data-relay-color-slot")) : NaN;
    return isFinite(raw) ? clamp(Math.floor(raw), 0, PEN_COLORS.length - 1) : fallback;
  }
  function updateColorButtons() {
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var i = 0; i < colors.length; i++) {
      var slot = colorSlotFromButton(colors[i], i);
      var color = PEN_COLORS[slot] || PEN_COLORS[0];
      colors[i].setAttribute("data-relay-color", color);
      colors[i].setAttribute("aria-controls", "relay-palette");
      colors[i].setAttribute("aria-haspopup", "true");
      var chip = colors[i].querySelector("span");
      if (chip) chip.style.background = color;
    }
  }
  function setPaletteOpen(open) {
    var palette = $("relay-palette");
    if (palette) palette.classList.toggle("hidden", !open);
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var i = 0; i < colors.length; i++) {
      var expanded = !!open && paletteTarget === "pen" &&
        colorSlotFromButton(colors[i], i) === selectedColorSlot;
      colors[i].setAttribute("aria-expanded", expanded ? "true" : "false");
    }
    if ($("relay-bg-btn")) $("relay-bg-btn").classList.toggle("active", !!open && paletteTarget === "bg");
  }
  function buildPaletteUi() {
    var palette = $("relay-palette");
    if (!palette || palette.children.length) return;
    PALETTE_COLORS.forEach(function (color) {
      var swatch = document.createElement("button");
      swatch.className = "catch-palette-color relay-palette-color";
      swatch.type = "button";
      swatch.setAttribute("data-relay-palette-color", color);
      swatch.setAttribute("aria-label", color);
      swatch.style.background = color;
      palette.appendChild(swatch);
    });
  }
  function selectColorSlot(slot) {
    selectedColorSlot = clamp(Math.floor(Number(slot) || 0), 0, PEN_COLORS.length - 1);
    selectedColor = PEN_COLORS[selectedColorSlot] || PEN_COLORS[0];
    selectedTool = "pen";
    paletteTarget = "pen";
    syncToolButtons();
  }
  function applyPaletteColor(color) {
    if (!canDraw()) {
      setPaletteOpen(false);
      return;
    }
    color = safeColor(color);
    if (paletteTarget === "bg") {
      canvasBg = color;
      selectedTool = "pen";
      redrawLocal();
    } else {
      PEN_COLORS[selectedColorSlot] = color;
      selectedColor = color;
      selectedTool = "pen";
    }
    setPaletteOpen(false);
    syncToolButtons();
  }
  function syncToolButtons() {
    updateColorButtons();
    var tools = document.querySelectorAll("[data-relay-tool]");
    for (var i = 0; i < tools.length; i++) {
      var active = tools[i].getAttribute("data-relay-tool") === selectedTool;
      tools[i].classList.toggle("active", active);
      tools[i].setAttribute("aria-pressed", active ? "true" : "false");
    }
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var j = 0; j < colors.length; j++) {
      var colorActive = colorSlotFromButton(colors[j], j) === selectedColorSlot && selectedTool === "pen";
      colors[j].classList.toggle("active", colorActive);
      colors[j].setAttribute("aria-pressed", colorActive ? "true" : "false");
    }
  }
  function bind() {
    if (bound || !canvas) return;
    bound = true;
    canvas.addEventListener("pointerdown", pointerDown);
    canvas.addEventListener("pointermove", pointerMove);
    canvas.addEventListener("pointerup", pointerUp);
    canvas.addEventListener("pointercancel", pointerUp);
    $("relay-ready-btn").addEventListener("click", toggleReady);
    $("relay-start-btn").addEventListener("click", function () {
      if (api && api.isHost()) api.send({ t: "relay_start", nick: me().nick });
    });
    $("relay-role-btn").addEventListener("click", toggleRole);
    $("relay-people-btn").addEventListener("click", function () { if (api) api.openPlayers(); });
    $("relay-leave-btn").addEventListener("click", function () { if (api) api.leaveRoom(); });
    $("relay-menu-btn").addEventListener("click", function () { if (api) api.openMenu(); });
    $("relay-rules-btn").addEventListener("click", function () {
      if (api && api.openRules) api.openRules();
      else if (api) api.openMenu();
    });
    $("relay-text-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) submitText();
    });
    $("relay-text-submit").addEventListener("click", submitText);
    $("relay-caption-input").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && !event.isComposing) submitText();
    });
    $("relay-caption-submit").addEventListener("click", submitText);
    $("relay-suggest-btn").addEventListener("click", function () {
      var input = $("relay-text-input");
      if (!input || input.disabled) return;
      var next = nextPromptSuggestion();
      input.value = next;
      input.dispatchEvent(new Event("input"));
      input.focus();
    });
    $("relay-draw-submit").addEventListener("click", submitDrawing);
    $("relay-undo-btn").addEventListener("click", function () {
      if (!canDraw() || !localStrokes.length) return;
      localStrokes.pop();
      redrawLocal();
    });
    $("relay-clear-btn").addEventListener("click", function () {
      if (!canDraw() || !localStrokes.length) return;
      localStrokes = [];
      redrawLocal();
    });
    var tools = document.querySelectorAll("[data-relay-tool]");
    for (var i = 0; i < tools.length; i++) tools[i].addEventListener("click", function () {
      selectedTool = this.getAttribute("data-relay-tool");
      setPaletteOpen(false);
      syncToolButtons();
    });
    var colors = document.querySelectorAll("[data-relay-color]");
    for (var j = 0; j < colors.length; j++) colors[j].addEventListener("click", function () {
      var slot = colorSlotFromButton(this, 0);
      var palette = $("relay-palette");
      var paletteOpen = !!palette && !palette.classList.contains("hidden");
      var shouldClose = paletteOpen && paletteTarget === "pen" && selectedColorSlot === slot;
      selectColorSlot(slot);
      setPaletteOpen(!shouldClose);
    });
    $("relay-bg-btn").addEventListener("click", function () {
      paletteTarget = "bg";
      selectedTool = "pen";
      syncToolButtons();
      var palette = $("relay-palette");
      setPaletteOpen(!palette || palette.classList.contains("hidden"));
    });
    var paletteColors = document.querySelectorAll("[data-relay-palette-color]");
    for (var k = 0; k < paletteColors.length; k++) paletteColors[k].addEventListener("click", function () {
      applyPaletteColor(this.getAttribute("data-relay-palette-color"));
    });
    $("relay-chat-input").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing || !api) return;
      if (api.sendChat(this.value)) this.value = "";
    });
    $("relay-result-chat-input").addEventListener("keydown", function (event) {
      if (event.key !== "Enter" || event.isComposing || !api) return;
      if (api.sendChat(this.value)) this.value = "";
    });
    $("relay-album-prev").addEventListener("click", function () {
      if (!state.players.length) return;
      albumIndex = (albumIndex - 1 + state.players.length) % state.players.length;
      renderResults();
      scrollAlbumToTop();
    });
    $("relay-album-next").addEventListener("click", function () {
      if (!state.players.length) return;
      albumIndex = (albumIndex + 1) % state.players.length;
      renderResults();
      scrollAlbumToTop();
    });
    $("relay-again-btn").addEventListener("click", function () {
      if (!api) return;
      if (api.isHost()) api.send({ t: "relay_start", nick: me().nick });
      else toggleReady();
    });
  }

  function tick() {
    if (!api) return;
    syncAudio();
    renderTimer();
    var now = Date.now();
    if (!previewMode && isActivePhase() && state.deadline && now >= state.deadline) {
      autoSubmitCurrentState();
    }
    if (!previewMode && api.isHost() && isActivePhase() && state.deadline && now >= state.deadline + AUTO_SUBMIT_GRACE_MS) {
      hostFinishExpiredStep();
    }
  }
  function enter(nextApi, asPreview) {
    previewMode = !!asPreview;
    api = nextApi;
    state = freshState();
    clearChains([]);
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    warningScope = "";
    lastGameBgmMatchId = null;
    stopGameBgm(true);
    albumIndex = 0;
    canvasBg = CANVAS_BG;
    canvas = $("relay-board");
    ctx = canvas ? canvas.getContext("2d") : null;
    if (canvas) {
      buildPaletteUi();
      bind();
      paintStrokes(ctx, canvas, [], CANVAS_BG);
    }
    bindGallery();
    if (tickId) clearInterval(tickId);
    tickId = setInterval(tick, 250);
    render();
  }
  function enterPreview(nextApi, phase) {
    enter(nextApi, true);
    return setPreviewPhase(phase);
  }
  function leave() {
    stopWaitingBgm(true);
    stopGameBgm(true);
    lastGameBgmMatchId = null;
    if (tickId) { clearInterval(tickId); tickId = null; }
    api = null;
    state = freshState();
    clearChains([]);
    drawing = false;
    currentStroke = null;
    localStrokes = [];
    taskScope = "";
    inputScope = "";
    pendingSubmitScope = "";
    warningScope = "";
    canvasBg = CANVAS_BG;
    setPaletteOpen(false);
    previewMode = false;
  }
  function roomMeta() {
    if (state.phase === "finished") return { status: "끝", summary: state.players.length + "개 연쇄 앨범 공개" };
    if (isActivePhase()) {
      return {
        status: "게임중",
        summary: phaseName(state.phase) + " · " + (state.stepIndex + 1) + "/" + state.totalSteps + " · " +
          state.submitted.length + "/" + state.players.length + " 제출"
      };
    }
    return { status: "대기중", summary: participantNicks().length + "명 참가 · " + waitingSpectators().length + "명 관전" };
  }
  function isBusy() { return isActivePhase(); }
  function canChat() { return !isActivePhase(); }
  function rules() {
    return {
      title: "이어그리기 규칙",
      html: '<div class="cm-rules">'
        + '<p class="rule-intro">모두가 동시에 문장과 그림을 주고받으며 하나의 이야기를 엉뚱하게 바꾸는 파티 게임입니다. <b>점수나 승패는 없어요.</b></p>'
        + '<section class="cm-rule-section"><h3>1. 게임 진행</h3><ul class="cm-rule-list">'
        + '<li>첫 단계에서 각자 다른 사람이 그림으로 그릴 <b>시작 문장</b>을 적어요.</li>'
        + '<li>다음 단계에서는 전달받은 문장을 보고 <b>그림</b>을 그려요.</li>'
        + '<li>그다음 사람은 원래 문장을 보지 못하고 그림만 보고 <b>새 설명</b>을 적어요.</li>'
        + '<li>참가 인원수만큼 문장과 그림을 번갈아 이어가면 게임이 끝나요.</li>'
        + '</ul></section>'
        + '<section class="cm-rule-section"><h3>2. 제출 시간</h3><ul class="cm-rule-list">'
        + '<li>문장과 설명은 <b>40초</b>, 그림은 <b>80초</b> 안에 제출해요.</li>'
        + '<li>모두 일찍 제출하면 기다리지 않고 바로 다음 단계로 넘어가요.</li>'
        + '<li>시간이 끝나면 작성하거나 그리던 마지막 상태가 자동으로 제출돼요.</li>'
        + '</ul></section>'
        + '<section class="cm-rule-section"><h3>3. 결과 앨범</h3><p>마지막에는 각 시작 문장이 어떻게 변했는지 연쇄 앨범으로 차례대로 감상합니다. 그림 실력보다 서로의 오해를 즐기는 게임이에요.</p></section>'
        + '<p class="cm-rule-muted">최소 3명부터 시작할 수 있고 4~8명을 권장합니다. 게임 중 들어온 사람은 관전하고 다음 게임부터 참여해요.</p>'
        + '</div>'
    };
  }

  var controller = {
    enter: enter,
    enterPreview: enterPreview,
    setPreviewPhase: setPreviewPhase,
    normalizePreviewPhase: normalizePreviewPhase,
    leave: leave,
    onReady: onReady,
    onMessage: onMessage,
    onPresence: onPresence,
    roomMeta: roomMeta,
    isBusy: isBusy,
    canChat: canChat,
    renderPlayers: renderPlayers,
    render: render,
    rules: rules,
    openGallery: openGallery,
    syncAudio: syncAudio,
    stopWaitingBgm: stopWaitingBgm,
    stopGameBgm: stopGameBgm,
    audioConfig: {
      waitingSrc: WAITING_BGM_SRC,
      waitingVolume: WAITING_BGM_VOLUME,
      gameSrc: GAME_BGM_SRC,
      gameVolume: GAME_BGM_VOLUME
    },
    get previewMode() { return previewMode; },
    get state() { return state; }
  };
  if (window.__RELAY_DRAWING_TEST__) {
    controller._test = {
      freshState: freshState,
      sanitizeState: sanitizeState,
      sanitizeEntry: sanitizeEntry,
      sanitizeStrokes: sanitizeStrokes,
      assignmentOrigin: assignmentOrigin,
      phaseForStep: phaseForStep,
      buildPromptSuggestion: buildPromptSuggestion,
      normalizePreviewPhase: normalizePreviewPhase,
      buildPreviewChains: buildPreviewChains,
      expectedKind: expectedKind,
      allReady: allReady,
      hostStartMatch: hostStartMatch,
      hostAcceptSubmission: hostAcceptSubmission,
      hostAdvanceStep: hostAdvanceStep,
      syncAudio: syncAudio,
      stopWaitingBgm: stopWaitingBgm,
      stopGameBgm: stopGameBgm,
      audioConfig: {
        waitingSrc: WAITING_BGM_SRC,
        waitingVolume: WAITING_BGM_VOLUME,
        gameSrc: GAME_BGM_SRC,
        gameVolume: GAME_BGM_VOLUME
      },
      hostFinishExpiredStep: hostFinishExpiredStep,
      autoSubmitCurrentState: autoSubmitCurrentState,
      tick: tick,
      storeEntry: storeEntry,
      onMessage: onMessage,
      snapshot: snapshot,
      getState: function () { return state; },
      setState: function (next) { state = next; },
      getChains: function () { return chains; },
      setChains: function (next) { chains = next; },
      setApi: function (next) { api = next; },
      limits: {
        textMs: TEXT_MS,
        drawMs: DRAW_MS,
        autoSubmitGraceMs: AUTO_SUBMIT_GRACE_MS,
        minPlayers: MIN_PLAYERS,
        maxPlayers: MAX_PLAYERS,
        maxText: MAX_TEXT,
        maxStrokes: MAX_STROKES,
        maxPoints: MAX_CANVAS_POINTS
      },
      promptParts: {
        characters: PROMPT_CHARACTERS.slice(),
        actions: PROMPT_ACTIONS.slice(),
        situations: PROMPT_SITUATIONS.slice(),
        situationRatio: SITUATION_RATIO
      }
    };
  }
  return controller;
})();
