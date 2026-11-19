import {MAJORS, SETS, WORDS, wordById, getSetsByMajor, getWordsByMajor, getMajorById} from './data.js';
import {CONFIG} from './config.js';
import {initialState, readState, persist, newSession, answerSession, acknowledge, pendingEvents, localDay, streak, newRecordId} from './store.js?v=6';
import {syncEvents} from './sync.js';
import {createChessConnection} from './chessOnline.js';
import {PIECES, createInitialChessState, getPieceMoves, makeMove, chooseAiMove, isWhite, isBlack} from './chessEngine.js?v=5';

const $ = selector => document.querySelector(selector);
const $$ = selector => document.querySelectorAll(selector);
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

// State variables
let state;
let storageError = '';
let view = 'home'; // 'home' | 'majors' | 'detail' | 'study' | 'result' | 'quiz' | 'review'
let selectedMajorId = 'biz';
let activeSetId = 'biz_day9';
let listFilter = 'all';
let busy = false;
let toastTimer;
let syncStatus = '';

// Interactive Chess Battle State
let chess = createInitialChessState();
let chessMode = 'ai';
let chessConnection;
let onlineSide;
let onlineStatus = 'idle';
let onlineCode = '';
let onlineError = '';
const chessModes = [['online', '온라인 대전'], ['local', '오프라인 2인'], ['ai', 'AI전']];
const sideLabel = side => side === 'white' ? '백' : '흑';
const otherSide = side => side === 'white' ? 'black' : 'white';
const canPlayChess = () => chessMode === 'local'
  || (chessMode === 'ai' && chess.turn === 'white')
  || (chessMode === 'online' && onlineStatus === 'connected' && chess.turn === onlineSide);
let chessDifficulty = 'normal';
const chessDifficulties = [
  ['easy', '쉬움'],
  ['normal', '보통'],
  ['hard', '어려움'],
];
let aiTimer = null;

try {
  state = readState(localStorage);
  if (!state.downloaded.includes('biz_day9')) {
    state.downloaded.push('biz_day9');
    persist(localStorage, state);
  }
} catch (error) {
  state = initialState();
  storageError = error.message;
}

const getSet = id => SETS.find(set => set.id === id) || SETS[0];
const reviewWords = () => WORDS.filter(word => state.records[word.id]?.status === 'review');
const favoriteWords = () => WORDS.filter(word => state.favorites.includes(word.id));
const statusOf = id => state.records[id]?.status || 'new';
const statusName = status => ({known:'완료', review:'다시 학습', new:'미학습'}[status]);
const saved = id => state.downloaded.includes(id);

function getChessRank(knownCount) {
  if (knownCount >= 1500) return { title: 'King ♚', name: '그랜드마스터 킹', icon: '♚', next: 2000, nextName: '단어 정복 완성' };
  if (knownCount >= 1000) return { title: 'Queen ♛', name: '마스터 퀸', icon: '♛', next: 1500, nextName: 'King' };
  if (knownCount >= 600)  return { title: 'Rook ♜', name: '챌린저 룩', icon: '♜', next: 1000, nextName: 'Queen' };
  if (knownCount >= 300)  return { title: 'Bishop ♝', name: '어드밴스드 비숍', icon: '♝', next: 600, nextName: 'Rook' };
  if (knownCount >= 100)  return { title: 'Knight ♞', name: '프로 나이트', icon: '♞', next: 300, nextName: 'Bishop' };
  return { title: 'Pawn ♟️', name: '비기너 폰', icon: '♟️', next: 100, nextName: 'Knight' };
}

function commit(next) {
  if (storageError) {
    toast('기록 보호를 위해 저장을 중단했어요. 기록을 먼저 내려받아 주세요.');
    return false;
  }
  try {
    persist(localStorage, next);
    state = next;
    updateReviewBadge();
    return true;
  } catch {
    toast('저장 공간을 확인해 주세요. 응답은 아직 저장되지 않았어요.');
    return false;
  }
}

function toast(message) {
  clearTimeout(toastTimer);
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function updateReviewBadge() {
  const badge = $('#nav-review-badge');
  if (!badge) return;
  const count = reviewWords().length;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function updateBottomNav() {
  $$('.nav-tab').forEach(tab => tab.classList.remove('active'));
  if (view === 'home') $('[data-action="nav-home"]')?.classList.add('active');
  else if (view === 'majors' || view === 'detail') $('[data-action="nav-majors"]')?.classList.add('active');
  else if (view === 'quiz') $('[data-action="nav-quiz"]')?.classList.add('active');
  else if (view === 'review') $('[data-action="nav-review"]')?.classList.add('active');
  else if (view === 'settings') $('[data-action="nav-settings"]')?.classList.add('active');
}

function navigate(next, options = {}) {
  view = next;
  listFilter = 'all';
  if (options.majorId) selectedMajorId = options.majorId;
  if (options.setId) activeSetId = options.setId;
  if (view === 'quiz' && !chess.activeQuiz && chess.phase === 'word_quiz') {
    generateChessQuiz(chess.turn);
  }
  render();
  window.scrollTo({top: 0, behavior: 'instant'});
  $('#main').focus({preventScroll: true});
}

window.addEventListener('popstate', (e) => {
  if (e.state && e.state.view) {
    view = e.state.view;
    if (e.state.majorId) selectedMajorId = e.state.majorId;
    if (e.state.setId) activeSetId = e.state.setId;
    render();
  }
});

function pushView(targetView, params = {}) {
  history.pushState({ view: targetView, ...params }, '', `#${targetView}`);
  navigate(targetView, params);
}

/* ============================================
   CHESS QUIZ ENGINE (Korean & English Dual-direction)
   ============================================ */
const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Generates a word quiz in either English->Korean or Korean->English
function generateChessQuiz(targetTurn) {
  // 50% chance EN->KO, 50% chance KO->EN
  const isEnToKo = Math.random() < 0.5;
  const targetWord = WORDS[Math.floor(Math.random() * WORDS.length)];
  const otherWords = shuffle(WORDS.filter(w => w.id !== targetWord.id)).slice(0, 3);

  let questionText = '';
  let questionSub = '';
  let correctOpt = '';
  let options = [];

  if (isEnToKo) {
    questionText = targetWord.word;
    questionSub = `[${targetWord.pos}] ${targetWord.phonetic} - 올바른 한국어 뜻을 고르세요`;
    correctOpt = targetWord.meaning;
    options = shuffle([correctOpt, ...otherWords.map(w => w.meaning)]);
  } else {
    questionText = targetWord.meaning;
    questionSub = `[${targetWord.pos}] 뜻에 해당하는 올바른 영어 단어를 고르세요`;
    correctOpt = targetWord.word;
    options = shuffle([correctOpt, ...otherWords.map(w => w.word)]);
  }

  chess.activeQuiz = {
    wordId: targetWord.id,
    type: isEnToKo ? 'en_to_ko' : 'ko_to_en',
    question: questionText,
    sub: questionSub,
    options,
    answer: correctOpt,
    selected: null,
    checked: false,
    isCorrect: false,
    targetTurn // who is answering: 'white' (player) or 'black' (AI turn)
  };
}

/* ============================================
   HEADER COMPONENT
   ============================================ */
function header() {
  const active = state.active;
  if (view === 'study' && active) {
    const percent = Math.round((active.index / active.ids.length) * 100);
    const currSet = getSet(active.setId);
    return `<div class="study-top">
      <button class="back-button" data-action="go-back-study" aria-label="이전으로 돌아가기">
        ← <span>${active.mode === 'review' ? '복습 모드' : currSet.name}</span>
      </button>
      <span class="header-counter">${active.index + 1} / ${active.ids.length}</span>
    </div>
    <div class="header-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
      <i style="width:${percent}%"></i>
    </div>
    <div class="header-progress-label">
      <span>${percent}% 완료</span>
      <span>${active.ids.length - active.index}단어 남음</span>
    </div>`;
  }

  return `<div class="brand-row">
    <button class="brand" data-action="nav-home" aria-label="smalltalk 홈">
      <span>smalltalk</span>
      <svg class="brand-leaf" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21V10M12 15C3 15 3 6 3 6s9-1 9 9ZM12 11c0-8 9-9 9-9s1 9-9 9Z"/>
      </svg>
    </button>
    <div class="header-tools">
      <button class="icon-button" data-action="open-settings" aria-label="설정 및 동기화">⚙️</button>
    </div>
  </div>
  <div class="header-bottom">
    <p>${
      view === 'quiz' ? '단어를 익히며 즐기는 체스' :
      view === 'majors' ? '관심 있는 전공부터 시작하세요.' :
      view === 'review' ? '다시 보고 싶은 단어를 모았습니다.' :
      view === 'detail' ? '하루 한 세트, 차근차근.' :
      '오늘의 학습을 이어가세요.'
    }</p>
    <nav aria-label="상단 메뉴">
      <button class="header-nav-btn ${view === 'home' ? 'selected' : ''}" data-action="nav-home">홈</button>
      <button class="header-nav-btn ${view === 'majors' ? 'selected' : ''}" data-action="nav-majors">전공 단어</button>
      <button class="header-nav-btn ${view === 'quiz' ? 'selected' : ''}" data-action="nav-quiz">단어 체스</button>
    </nav>
  </div>`;
}

function renderConnection() {
  const el = $('#connection');
  el.hidden = navigator.onLine && !storageError && syncStatus !== 'failed';
  el.innerHTML = storageError ?
    `⚠️ ${escape(storageError)} <button data-action="open-settings">기록 확인</button>` :
    syncStatus === 'failed' ?
    `⚠️ 클라우드 동기화에 실패했습니다. <button data-action="sync">다시 시도</button>` :
    `오프라인 · 저장된 단어로 학습 중`;
}

/* ============================================
   CHESS LEVEL & ATTENDANCE CALENDAR WIDGETS
   ============================================ */
function chessBanner() {
  const knownCount = Object.values(state.records).filter(r => r.status === 'known').length;
  const rank = getChessRank(knownCount);
  const currentRankBase = rank.next === 100 ? 0 : rank.next === 300 ? 100 : rank.next === 600 ? 300 : rank.next === 1000 ? 600 : rank.next === 1500 ? 1000 : 1500;
  const progressPercent = Math.min(100, Math.round(((knownCount - currentRankBase) / (rank.next - currentRankBase)) * 100));

  return `<section class="chess-level-banner" aria-label="체스 레벨 정보">
    <div class="chess-badge-col">
      <div class="chess-icon-wrap" title="${rank.name}">${rank.icon}</div>
      <div class="chess-info">
        <h3>체스 랭크 : <span class="chess-rank-name">${rank.title}</span></h3>
        <p>${rank.name} · 마스터한 단어 <b>${knownCount}</b> / ${WORDS.length}</p>
      </div>
    </div>
    <div class="chess-progress-col">
      <div class="chess-progress-labels">
        <span>다음 승급까지</span>
        <span><b>${Math.max(0, rank.next - knownCount)}단어</b> (${rank.nextName})</span>
      </div>
      <div class="chess-track"><i style="width:${progressPercent}%"></i></div>
    </div>
  </section>`;
}

function attendanceCalendar() {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const today = localDay(now);
  const dayNames = ['일','월','화','수','목','금','토'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();

  const countByDay = {};
  state.events.forEach(ev => {
    if (!countByDay[ev.day]) countByDay[ev.day] = new Set();
    countByDay[ev.day].add(ev.wordId);
  });

  const monthStr = `${year}년 ${month+1}월`;
  const currentStreak = streak(state);
  let cells = dayNames.map((d, i) => `<span class="cal-dname ${i===0?'sun':i===6?'sat':''}">${d}</span>`).join('');
  for (let blank = 0; blank < firstDay; blank++) cells += '<span class="cal-day empty"></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const count = countByDay[dayStr] ? countByDay[dayStr].size : 0;
    const isToday = dayStr === today;
    const hasStudied = count > 0;
    cells += `<span class="cal-day ${hasStudied?'studied':''} ${isToday?'today':''}" title="${d}일${hasStudied?' · '+count+'단어 완료':''}">
      ${d}${hasStudied ? `<b>${count}</b>` : ''}
    </span>`;
  }
  return `<section class="cal-card" aria-label="출석 달력">
    <div class="cal-header">
      <div class="cal-title"><span>📅</span><span>출석 달력 · ${monthStr}</span></div>
      <span class="streak-badge">🔥 연속 출석 ${currentStreak}일째</span>
    </div>
    <div class="cal-grid">${cells}</div>
  </section>`;
}

/* ============================================
   VIEWS
   ============================================ */

// 1. HOME VIEW
function home() {
  const today = state.events.filter(event => event.day === localDay());
  const learnedToday = new Set(today.filter(event => event.source === 'web').map(event => event.wordId)).size;
  const knownTotal = Object.values(state.records).filter(record => record.status === 'known').length;
  const percent = Math.min(100, Math.round((learnedToday / CONFIG.dailyGoal) * 100));
  const active = state.active;
  const recommended = [WORDS[0], WORDS[25], WORDS[50]];

  return `
  <section class="garden-hero">
    <div>
      <p class="garden-kicker">전공 영어 단어장</p>
      <h1>나의 전공을<br>영어로 읽는 힘.</h1>
      <p>8개 전공의 핵심 영단어 2,000개를<br>하루 한 세트씩 익혀보세요.</p>
      <button data-action="${active ? 'continue-study' : 'nav-majors'}">${active ? '이어서 학습하기' : '전공 선택하기'} <span aria-hidden="true">↗</span></button>
    </div>
    <img class="garden-mascot" src="./mascot.png" width="1200" height="1280" alt="책을 펼쳐 든 smalltalk 새싹 마스코트">
  </section>
  <section class="today-card" aria-label="오늘의 학습 진도">
    <div class="progress-ring" style="--progress:${percent}%">
      <div>
        <strong>${percent}%</strong>
        <small>오늘 목표</small>
      </div>
    </div>
    <div class="today-copy">
      <h2>오늘의 학습 현황</h2>
      <span>오늘 익힌 단어 <b>${learnedToday}</b> / ${CONFIG.dailyGoal}</span>
      <span>복습 대기 단어 <b>${reviewWords().length}</b>개</span>
      <span class="streak">🔥 연속 학습 <b>${streak(state)}일</b> 달성 중</span>
    </div>
    <div class="today-bars">
      <div><span>오늘 목표 진도</span><b>${learnedToday}/${CONFIG.dailyGoal}</b></div>
      <div class="mini-track"><i style="width:${percent}%"></i></div>
      <div><span>전체 마스터 단어</span><b>${knownTotal}/${WORDS.length}</b></div>
      <div class="mini-track light"><i style="width:${(knownTotal/WORDS.length)*100}%"></i></div>
    </div>
  </section>

  <!-- Quick Start / Continue Preview Card -->
  <button class="preview-card" data-action="${active ? 'continue-study' : 'open-detail'}" data-set="${active ? active.setId : 'biz_day9'}">
    <div>
      <small>${active ? '이어서 학습하기 📖' : '추천 세트 바로가기 · Day 9 경제'}</small>
      <strong>${active ? escape(wordById(active.ids[active.index])?.word || '학습 이어하기') : 'Day 9 · 거시 경제 지표 & 경기 변동'}</strong>
    </div>
    <span>→</span>
  </button>

  <div class="garden-activity">${chessBanner()}${attendanceCalendar()}</div>

  <!-- Major Selection Quick Selector -->
  <section class="section majors-selector-section">
    <div class="section-heading">
      <h2>8대 전공별 전문 단어장</h2>
      <button class="header-nav-btn" data-action="nav-majors">전체 보기 ›</button>
    </div>
    <div class="majors-grid">
      ${MAJORS.map(m => `
        <div class="major-card ${m.id === selectedMajorId ? 'active' : ''}" data-action="select-major" data-major="${m.id}">
          <span class="major-card-icon">${m.icon}</span>
          <span class="major-card-name">${m.name}</span>
          <span class="major-card-badge">${m.badge}</span>
        </div>
      `).join('')}
    </div>
  </section>

  <!-- Selected Major Day Sets (Day 1 ~ Day 10) -->
  <section class="section">
    <div class="section-heading">
      <h2>${getMajorById(selectedMajorId).icon} ${getMajorById(selectedMajorId).name} (10 Days)</h2>
      <span>250단어 · 10일 완성 코스</span>
    </div>
    <div class="day-sets-grid">
      ${getSetsByMajor(selectedMajorId).map(renderDaySetCard).join('')}
    </div>
  </section>

  <!-- Recommended Words -->
  <section class="section">
    <div class="section-heading">
      <h2>오늘의 추천 어휘</h2>
      <button class="header-nav-btn" data-action="refresh-recommend">새로고침 ↻</button>
    </div>
    <div class="recommend-grid">
      ${recommended.map(w => renderWordCard(w)).join('')}
    </div>
  </section>

  <!-- Review Alert Notice -->
  <div class="review-notice">
    <span class="notice-icon">💡</span>
    <div>
      <strong>${reviewWords().length ? '복습이 필요한 단어가 대기 중이에요!' : '꾸준한 복습이 장기 기억의 핵심입니다.'}</strong>
      <p>${reviewWords().length ? `${reviewWords().slice(0,3).map(w=>w.word).join(', ')} 등 총 ${reviewWords().length}단어` : '모르는 단어는 오답 노트에 자동으로 모아집니다.'}</p>
    </div>
    ${reviewWords().length ? '<button class="button primary" style="min-height:38px;padding:6px 14px;font-size:12px;margin-left:auto;" data-action="nav-review">복습하기 →</button>' : ''}
  </div>

  <!-- Bottom CTA Actions -->
  <div class="bottom-actions">
    <button class="button subtle" data-action="nav-quiz">♟️ 단어 배틀 체스 하기</button>
    <button class="button primary" data-action="${active ? 'continue-study' : 'open-detail'}" data-set="${active ? active.setId : 'biz_day9'}">
      ${active ? '📖 이어서 학습하기' : 'Day 9 경제 학습 시작'} <span>→</span>
    </button>
  </div>`;
}

// 2. MAJORS & ALL DAY SETS VIEW
function majorsView() {
  const currentMajor = getMajorById(selectedMajorId);
  const sets = getSetsByMajor(selectedMajorId);
  return `
  <div class="detail-back-row">
    <button class="back-button" data-action="nav-home">← 홈</button>
    <span class="detail-page-title">전공별 학술 어휘 선택</span>
  </div>

  <section class="section">
    <p class="muted" style="margin-bottom:12px;">원하는 전공 분야를 선택하면 10 Days (250단어) 전문 커리큘럼이 열립니다.</p>
    <div class="majors-grid">
      ${MAJORS.map(m => `
        <div class="major-card ${m.id === selectedMajorId ? 'active' : ''}" data-action="select-major" data-major="${m.id}">
          <span class="major-card-icon">${m.icon}</span>
          <span class="major-card-name">${m.name}</span>
          <span class="major-card-badge">${m.badge}</span>
        </div>
      `).join('')}
    </div>
  </section>

  <section class="section">
    <div class="section-heading">
      <h2>${currentMajor.icon} ${currentMajor.name} 커리큘럼</h2>
      <span>총 ${sets.length}개 세트 · 250개 단어</span>
    </div>
    <div class="day-sets-grid">
      ${sets.map(renderDaySetCard).join('')}
    </div>
  </section>`;
}

function renderDaySetCard(set) {
  const done = set.words.filter(w => statusOf(w.id) === 'known').length;
  const isDay9Benchmark = set.id === 'biz_day9';
  return `<div class="day-set-card ${isDay9Benchmark ? 'benchmark-day9' : ''}">
    <div class="day-set-main" data-action="open-detail" data-set="${set.id}">
      <div class="day-badge-col">
        <small>DAY</small>
        <strong>${set.day}</strong>
      </div>
      <div class="day-info-col">
        <strong>${set.name}</strong>
        <small>${set.description}</small>
      </div>
      <div class="day-meta-col">
        <span class="day-progress-pill ${done === set.words.length ? 'done' : ''}">${done}/${set.words.length}</span>
        <small style="color:${saved(set.id)?'#059669':'#94a3b8'}">${saved(set.id)?'✓ 보관됨':'오프라인'}</small>
      </div>
    </div>
    <div class="day-set-actions">
      <button class="btn-save-cache" data-action="save-offline" data-set="${set.id}">
        ${saved(set.id) ? '✓ 기기 저장됨' : '↓ 오프라인 캐시'}
      </button>
      <button class="btn-open-detail" data-action="open-detail" data-set="${set.id}">
        상세 보기 ›
      </button>
    </div>
  </div>`;
}

// 3. SET DETAIL VIEW (Day 9 Economy benchmark layout)
function detail() {
  const set = getSet(activeSetId);
  const done = set.words.filter(w => statusOf(w.id) === 'known').length;
  const rows = set.words.map((w, i) => {
    const st = statusOf(w.id);
    const fav = state.favorites.includes(w.id);
    return `<div class="detail-word-row">
      <span class="detail-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="detail-word-info">
        <button class="detail-eng" data-action="speak" data-word="${w.id}" lang="en">
          ${w.word}
          <span style="font-size:11px;color:#94a3b8;font-weight:400;">${w.phonetic}</span>
        </button>
        <span class="detail-kor">${w.meaning}</span>
      </div>
      <div class="detail-row-actions">
        <span class="detail-status status-${st}" title="${statusName(st)}"></span>
        <button class="detail-star" data-action="favorite" data-word="${w.id}" aria-pressed="${fav}">
          ${fav ? '★' : '☆'}
        </button>
      </div>
    </div>`;
  }).join('');

  return `<div class="detail-page">
    <div class="detail-back-row">
      <button class="back-button" data-action="nav-majors">← 세트 목록</button>
      <span class="detail-page-title">${set.majorIcon} ${set.name}</span>
      <span class="detail-count">${done} / ${set.words.length} 마스터</span>
    </div>
    <div class="detail-story-banner">
      <span class="detail-story-tag">${set.label} 핵심 스토리 ▶</span>
      <span>${set.description}</span>
    </div>
    <div class="detail-section-title">
      <span>전공 핵심 빈출 단어 (${set.words.length}개)</span>
      <span class="detail-section-sub">터치 시 원어민 발음 재생 🔊</span>
    </div>
    <div class="detail-word-table">
      ${rows}
    </div>
    <div class="detail-floating-bar">
      <button class="detail-bar-btn learn" data-action="start-session" data-set="${set.id}">
        📖 이 세트 학습하기 (${set.words.length}단어)
      </button>
      <button class="detail-bar-btn review" data-action="review-set" data-set="${set.id}">
        🔁 복습하기
      </button>
    </div>
  </div>`;
}

// 4. STUDY VIEW
function study() {
  const active = state.active;
  if (!active || active.index >= active.ids.length) return result();

  const word = wordById(active.ids[active.index]);
  const set = getSet(word.setId);
  const known = active.answers.filter(a => a.status === 'known').length;
  const isFav = state.favorites.includes(word.id);

  return `
  <div class="filter-pills" style="margin-bottom:14px;">
    <span class="day-progress-pill done">전체 ${active.ids.length}단어</span>
    <span class="day-progress-pill">진행 중 ${active.index + 1}번째</span>
    <span class="day-progress-pill">남음 ${active.ids.length - active.index - 1}단어</span>
  </div>

  <article class="study-card">
    <div class="study-card-top">
      <span class="tag">${set.majorIcon} ${set.label} · ${set.majorName}</span>
      <button class="detail-star" data-action="favorite" data-word="${word.id}" aria-pressed="${isFav}">
        ${isFav ? '★' : '☆'}
      </button>
    </div>
    <h1 lang="en">${escape(word.word)}</h1>
    <div class="word-metadata">
      <button class="pronounce-mini" data-action="speak" data-word="${word.id}">🔊 ${word.phonetic}</button>
      <span class="pos">${word.pos}</span>
    </div>
    <div class="definition">
      <small>핵심 전공 어휘 의미</small>
      <h2>${escape(word.meaning)}</h2>
    </div>
    <div class="example">
      <span>Academic / Practical Example</span>
      <p lang="en">${escape(word.example).replace(new RegExp(word.word, 'ig'), match => `<b>${match}</b>`)}</p>
      <p>${escape(word.translation)}</p>
    </div>
  </article>

  <div class="response-actions">
    <button class="button review-button" data-action="answer" data-status="review">
      <span>↻</span>
      다시 학습
      <small>아직 낯설어요 (오답 노트로)</small>
    </button>
    <button class="button primary" data-action="answer" data-status="known">
      <span>✓</span>
      알고 있어요
      <small>마스터 완료 (다음 단어로)</small>
    </button>
  </div>

  <aside class="tip">
    <span>💡</span>
    <div>
      <b>어원 및 실전 활용 팁</b>
      <p>${escape(word.tip)}</p>
    </div>
  </aside>

  <div class="summary-strip">
    <div><b>${known}</b><span>알고 있어요</span></div>
    <div><b>${active.answers.length - known}</b><span>다시 학습</span></div>
    <div><b>${active.ids.length - active.index}</b><span>남은 단어</span></div>
  </div>`;
}

// 5. RESULT VIEW
function result() {
  const session = state.lastResult;
  if (!session) {
    return `<div style="text-align:center;padding:50px 20px;">
      <span style="font-size:48px;">🌱</span>
      <h2 style="margin-top:12px;">학습 결과가 아직 없습니다</h2>
      <p class="muted">세트 단어를 학습하고 나면 상세 리포트를 확인할 수 있어요.</p>
      <button class="button primary" style="margin:20px auto 0;max-width:200px;" data-action="nav-home">홈으로 이동</button>
    </div>`;
  }

  const known = session.answers.filter(a => a.status === 'known').length;
  const reviews = session.answers.filter(a => a.status === 'review').map(a => a.wordId);
  const percent = Math.round((known / session.ids.length) * 100);

  return `
  <section class="chess-level-banner" style="text-align:center;justify-content:center;flex-direction:column;">
    <div style="font-size:42px;">🎉</div>
    <h2 style="font-size:22px;color:#fff;margin-top:6px;">세트 완주를 축하합니다!</h2>
    <p style="color:#94a3b8;font-size:13px;">${getSet(session.setId).name} · ${session.ids.length}단어 완료</p>
  </section>

  <div class="summary-strip">
    <div><b>${known}</b><span>알고 있어요</span></div>
    <div><b>${reviews.length}</b><span>다시 학습 필요</span></div>
    <div><b>${percent}%</b><span>정답률</span></div>
  </div>

  <section class="section">
    <div class="section-heading">
      <h2>학습 단어 복습</h2>
      <span>기기에 안전 저장 완료</span>
    </div>
    <div class="word-list">
      ${session.ids.map(id => {
        const w = wordById(id);
        const ans = session.answers.find(a => a.wordId === id);
        return `<div class="word-row">
          <div>
            <strong>${w.word}</strong>
            <small>${w.meaning}</small>
          </div>
          <span class="status ${ans?.status === 'known' ? 'status-known' : 'status-review'}">
            ${ans?.status === 'known' ? '완료 ✓' : '복습 필요 ↻'}
          </span>
        </div>`;
      }).join('')}
    </div>
  </section>

  <div class="bottom-actions">
    <button class="button subtle" data-action="review-result" ${reviews.length ? '' : 'disabled'}>
      ↻ 틀린 단어 복습 (${reviews.length}개)
    </button>
    <button class="button primary" data-action="next-set">
      다음 Day 세트 학습 <span>→</span>
    </button>
  </div>`;
}

// 6. WORD BATTLE CHESS VIEW
function quiz() {
  const isUserTurn = chess.turn === 'white';
  const q = canPlayChess() ? chess.activeQuiz : null;

  // Board coordinates labels
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  // Render Captured pieces
  const renderCaptured = (list) => list.map(p => PIECES[p]).join(' ');

  let boardHtml = '<div class="chess-board-grid">';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const isLight = (r + c) % 2 === 0;
      const piece = chess.board[r][c];
      const isSelected = chess.selectedSquare && chess.selectedSquare[0] === r && chess.selectedSquare[1] === c;
      const isValidMove = chess.validMoves.some(([vr, vc]) => vr === r && vc === c);
      const pieceColorClass = piece ? (isWhite(piece) ? 'white-piece' : 'black-piece') : '';

      boardHtml += `<div class="chess-square ${isLight ? 'light' : 'dark'} ${isSelected ? 'selected' : ''} ${isValidMove ? 'valid-dest' : ''}" data-action="chess-square" data-r="${r}" data-c="${c}">
        ${isValidMove ? '<span class="dest-dot"></span>' : ''}
        ${piece ? `<span class="chess-piece ${pieceColorClass}">${PIECES[piece]}</span>` : ''}
        ${c === 0 ? `<span class="coord-rank">${8 - r}</span>` : ''}
        ${r === 7 ? `<span class="coord-file">${files[c]}</span>` : ''}
      </div>`;
    }
  }
  boardHtml += '</div>';

  return `
  <section class="chess-battle-wrap">
    <fieldset class="chess-difficulty chess-mode">
      <legend>대전 모드</legend>
      ${chessModes.map(([id, label]) => `<button type="button" data-action="chess-mode" data-mode="${id}" aria-pressed="${chessMode === id}">${label}</button>`).join('')}
    </fieldset>
    ${chessMode === 'online' ? onlinePanel() : ''}
    ${chessMode === 'ai' ? `
    <fieldset class="chess-difficulty">
      <legend>상대 AI 난이도</legend>
      ${chessDifficulties.map(([id, label]) => `
        <button type="button" data-action="chess-difficulty" data-level="${id}"
          aria-pressed="${chessDifficulty === id}">${label}</button>
      `).join('')}
    </fieldset>
    ` : ''}
    <div class="chess-battle-header">
      <div class="chess-score-col">
        <span class="player-tag user ${isUserTurn ? 'active-turn' : ''}">
          ⚪ ${chessMode === 'ai' ? '나 (백)' : '백'} ${isUserTurn ? '공격권' : ''}
        </span>
        <span class="captured-row">${renderCaptured(chess.capturedByWhite) || '획득 기물 없음'}</span>
      </div>
      <div class="chess-center-status">
        <span class="streak-badge">연속 성공 ${chess.score.streak}회 🔥</span>
      </div>
      <div class="chess-score-col right">
        <span class="player-tag ai ${!isUserTurn ? 'active-turn' : ''}">
          ⚫ ${chessMode === 'ai' ? '상대 AI (흑)' : '흑'} ${!isUserTurn ? '공격권' : ''}
        </span>
        <span class="captured-row">${renderCaptured(chess.capturedByBlack) || '획득 기물 없음'}</span>
      </div>
    </div>

    <!-- CHESS BOARD -->
    <div class="chess-board-container">
      ${boardHtml}
    </div>

    <!-- BATTLE STATUS BANNER -->
    <div class="battle-turn-banner ${isUserTurn ? 'turn-user' : 'turn-ai'}">
      ${
        chess.phase === 'game_over' ? `🏆 ${sideLabel(chess.winner)} 승리!` :
        chessMode === 'online' && onlineStatus !== 'connected' ? '친구와 연결하면 대전이 시작됩니다.' :
        !canPlayChess() && chessMode === 'online' ? '상대방의 차례를 기다리는 중입니다.' :
        chess.phase === 'move_piece' ? `✨ 퀴즈 정답! ${sideLabel(chess.turn)} 말을 골라 이동하세요.` :
        chess.phase === 'ai_thinking' ? '🤖 상대 AI가 단어 퀴즈에 도전 중입니다...' :
        `🎯 ${sideLabel(chess.turn)} 차례. 문제를 맞추면 말을 움직일 수 있습니다.`
      }
    </div>

    <!-- WORD QUIZ POPUP/CARD -->
    ${(chess.phase === 'word_quiz' && q) ? `
      <section class="quiz-battle-card">
        <div class="quiz-header-row">
          <span class="quiz-direction-tag">${q.type === 'en_to_ko' ? '🇺🇸 영단어 ➔ 한국어 뜻' : '🇰🇷 한국어 뜻 ➔ 영어 단어'}</span>
          <span class="quiz-turn-badge">${sideLabel(chess.turn)}의 문제</span>
        </div>
        <div class="quiz-question-box">
          <h2 lang="${q.type === 'en_to_ko' ? 'en' : 'ko'}">${escape(q.question)}</h2>
          <p class="quiz-sub">${escape(q.sub)}</p>
        </div>
        <div class="quiz-options">
          ${q.options.map((opt, idx) => {
            const isChosen = q.selected === opt;
            const isCorrect = opt === q.answer;
            let optClass = '';
            if (isChosen) optClass = 'chosen';
            if (q.checked && isCorrect) optClass = 'correct';
            if (q.checked && isChosen && !isCorrect) optClass = 'incorrect';

            return `<button class="quiz-option ${optClass}" data-action="chess-quiz-select" data-opt="${escape(opt)}" ${q.checked ? 'disabled' : ''}>
              <span>0${idx + 1}</span>
              <span class="quiz-option-text">${escape(opt)}</span>
              ${q.checked && isCorrect ? '<b>✓ 정답</b>' : ''}
            </button>`;
          }).join('')}
        </div>
        ${q.checked ? `
          <div class="quiz-feedback ${q.isCorrect ? 'correct-fb' : 'wrong-fb'}">
            ${q.isCorrect ?
              `🎉 <b>정답입니다!</b> 체스 공격권을 획득하여 말을 움직일 수 있습니다!` :
              `❌ <b>틀렸습니다!</b> 공격권이 ${sideLabel(otherSide(chess.turn))}에게 넘어갑니다.`
            }
            <div style="font-size:12px;margin-top:4px;color:#475569;">정답: <b>${escape(q.answer)}</b></div>
          </div>
        ` : ''}
        <button class="button primary full" style="margin-top:16px;" data-action="${q.checked ? 'chess-quiz-continue' : 'chess-quiz-submit'}" ${!q.selected ? 'disabled' : ''}>
          ${q.checked ? '계속하기 →' : '정답 제출'}
        </button>
      </section>
    ` : ''}

    ${chess.phase === 'game_over' ? `
      <div style="text-align:center;margin-top:20px;">
        <button class="button primary" style="margin:0 auto;max-width:240px;" data-action="${chessMode === 'online' ? 'chess-online-reset' : 'restart-chess'}">새 체스 게임 시작 ↻</button>
      </div>
    ` : ''}
  </section>`;
}

// 7. REVIEW & FAVORITES VIEW
function reviewPage() {
  const reviews = reviewWords();
  const favorites = favoriteWords();
  const currentList = listFilter === 'favorites' ? favorites : reviews;

  return `
  <div class="detail-back-row">
    <button class="back-button" data-action="nav-home">← 홈</button>
    <span class="detail-page-title">복습 노트 & 즐겨찾기</span>
  </div>

  <div class="section-heading" style="margin-top:16px;">
    <div style="display:flex;gap:8px;">
      <button class="day-progress-pill ${listFilter !== 'favorites' ? 'done' : ''}" data-action="filter-review" data-filter="reviews">
        복습 대기 (${reviews.length})
      </button>
      <button class="day-progress-pill ${listFilter === 'favorites' ? 'done' : ''}" data-action="filter-review" data-filter="favorites">
        즐겨찾기 ★ (${favorites.length})
      </button>
    </div>
  </div>

  ${currentList.length === 0 ? `
    <div style="text-align:center;padding:50px 20px;">
      <span style="font-size:42px;">✨</span>
      <h3 style="margin-top:10px;">${listFilter === 'favorites' ? '즐겨찾기한 단어가 없습니다' : '복습할 단어가 없습니다!'}</h3>
      <p class="muted">단어를 학습하면서 별표를 누르거나 다시 학습을 선택해 보세요.</p>
    </div>
  ` : `
    <div class="detail-word-table" style="margin-top:12px;">
      ${currentList.map((w, idx) => {
        const isFav = state.favorites.includes(w.id);
        return `<div class="detail-word-row">
          <span class="detail-num">${String(idx + 1).padStart(2, '0')}</span>
          <div class="detail-word-info">
            <button class="detail-eng" data-action="speak" data-word="${w.id}" lang="en">
              ${w.word}
              <span style="font-size:11px;color:#94a3b8;font-weight:400;">${w.phonetic}</span>
            </button>
            <span class="detail-kor">${w.meaning}</span>
          </div>
          <div class="detail-row-actions">
            <button class="detail-star" data-action="favorite" data-word="${w.id}" aria-pressed="${isFav}">
              ${isFav ? '★' : '☆'}
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>
    ${listFilter !== 'favorites' ? `
      <div class="detail-floating-bar">
        <button class="detail-bar-btn learn" data-action="start-review-all">
          🔁 복습 단어 집중 학습 시작 (${reviews.length}단어)
        </button>
      </div>
    ` : ''}
  `}
  `;
}

function renderWordCard(word) {
  const isFav = state.favorites.includes(word.id);
  const set = getSet(word.setId);
  return `<article class="word-mini">
    <div class="word-mini-top">
      <span class="tag">${set.majorIcon} ${set.label}</span>
      <button class="detail-star" data-action="favorite" data-word="${word.id}" aria-pressed="${isFav}">
        ${isFav ? '★' : '☆'}
      </button>
    </div>
    <button class="word-link" data-action="open-word-detail" data-word="${word.id}">${escape(word.word)}</button>
    <p>${escape(word.meaning)}</p>
    <button class="pronounce-mini" data-action="speak" data-word="${word.id}" style="width:fit-content;">🔊 ${escape(word.phonetic)}</button>
  </article>`;
}

/* ============================================
   RENDER MAIN LOOP
   ============================================ */
function render() {
  if (view === 'study' && !state.active) view = 'result';
  $('#header').innerHTML = header();
  renderConnection();
  updateBottomNav();
  updateReviewBadge();

  let content = '';
  switch (view) {
    case 'home': content = home(); break;
    case 'majors': content = majorsView(); break;
    case 'detail': content = detail(); break;
    case 'study': content = study(); break;
    case 'result': content = result(); break;
    case 'quiz': content = quiz(); break;
    case 'review': content = reviewPage(); break;
    default: content = home(); break;
  }
  $('#main').innerHTML = content;
}

/* ============================================
   SPEECH & SESSIONS
   ============================================ */
function speak(id) {
  if (!('speechSynthesis' in window)) {
    toast('현재 브라우저에서는 음성 합성을 지원하지 않습니다.');
    return;
  }
  const word = wordById(id);
  if (!word) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(word.word);
  utt.lang = 'en-US';
  utt.rate = 0.85;
  utt.onerror = () => toast('발음을 재생할 수 없습니다.');
  speechSynthesis.speak(utt);
}

function beginSession(setId, ids = null, mode = 'learn') {
  const set = getSet(setId);
  const targetIds = ids || set.words.map(w => w.id);
  const next = structuredClone(state);
  if (!next.downloaded.includes(setId)) next.downloaded.push(setId);
  next.active = newSession(setId, targetIds, mode);
  if (commit(next)) pushView('study');
}

/* ============================================
   AI TURN ENGINE FOR CHESS BATTLE
   ============================================ */
function resetChess() {
  clearTimeout(aiTimer);
  chess = createInitialChessState();
  generateChessQuiz('white');
}

function closeOnlineChess() {
  chessConnection?.close();
  chessConnection = undefined;
  onlineSide = undefined;
  onlineStatus = 'idle';
  onlineCode = '';
  onlineError = '';
  resetChess();
}

function onlinePanel() {
  if (onlineStatus === 'connected') {
    return `<section class="chess-online"><p>연결됨 · 내 말은 ${sideLabel(onlineSide)}입니다.</p>
      <button class="button subtle" data-action="chess-online-reset">연결 종료</button></section>`;
  }
  if (onlineStatus === 'disconnected') {
    return '<section class="chess-online"><p>상대와 연결이 끊겼습니다.</p><button class="button subtle" data-action="chess-online-reset">다시 연결</button></section>';
  }
  if (onlineStatus === 'busy') return '<section class="chess-online" role="status">연결 준비 중…</section>';
  return `<section class="chess-online">
    ${onlineError ? `<p role="alert">${escape(onlineError)}</p>` : ''}
    ${onlineCode ? `<label>${onlineSide === 'white' ? '초대 코드' : '응답 코드'} · 복사해서 친구에게 보내세요.
      <textarea readonly rows="2" spellcheck="false">${escape(onlineCode)}</textarea></label>` : ''}
    ${onlineStatus === 'answer' ? '<p role="status">친구가 응답 코드를 입력하면 대전이 시작됩니다.</p>' : onlineStatus === 'waiting' ? '<p role="status">친구와 연결하는 중입니다.</p>' :
      `<label>${onlineStatus === 'offer' ? '친구의 응답 코드' : '친구의 초대 코드'}
        <textarea id="chess-peer-code" rows="2" maxlength="100000" spellcheck="false"></textarea></label>`}
    <div class="chess-online-actions">
      ${onlineStatus === 'idle' ? '<button class="button primary" data-action="chess-online-offer">초대 코드 만들기</button><button class="button subtle" data-action="chess-online-answer">초대에 응답</button>' : ''}
      ${onlineStatus === 'offer' ? '<button class="button primary" data-action="chess-online-accept">응답 코드 연결</button>' : ''}
      ${onlineStatus !== 'idle' ? '<button class="button subtle" data-action="chess-online-reset">취소</button>' : ''}
    </div></section>`;
}

function finishChessTurn(move, remote = false) {
  if (!remote && chessMode === 'online' && !chessConnection?.send({ move })) {
    onlineStatus = 'disconnected';
    render();
    return;
  }
  if (move) {
    chess = makeMove(chess, ...move);
    if (chess.phase === 'game_over') {
      render();
      return;
    }
  }
  if (chessMode === 'ai') {
    triggerAiTurn();
    return;
  }
  chess.turn = otherSide(chess.turn);
  chess.phase = 'word_quiz';
  generateChessQuiz(chess.turn);
  render();
}

function receiveChessTurn(message) {
  if (chessMode !== 'online' || onlineStatus !== 'connected' ||
      chess.turn === onlineSide || chess.phase === 'game_over') return;
  const move = message?.move;
  if (move !== null) {
    if (!Array.isArray(move) || move.length !== 4 ||
        !move.every(n => Number.isInteger(n) && n >= 0 && n < 8)) return;
    const [r, c, toR, toC] = move;
    const piece = chess.board[r][c];
    if (!piece || isWhite(piece) !== (chess.turn === 'white') ||
        !getPieceMoves(chess.board, r, c).some(([row, col]) => row === toR && col === toC)) return;
  }
  finishChessTurn(move, true);
}

async function connectChess(action, code) {
  const previous = onlineStatus;
  if (action !== 'offer' && !code) {
    onlineError = '친구에게 받은 연결 코드를 입력하세요.';
    render();
    return;
  }
  onlineStatus = 'busy';
  onlineError = '';
  render();
  let connection = chessConnection;
  try {
    if (action !== 'accept') {
      onlineSide = action === 'offer' ? 'white' : 'black';
      connection = createChessConnection(receiveChessTurn, status => {
        if (chessConnection !== connection) return;
        onlineStatus = status;
        render();
      });
      chessConnection = connection;
    }
    const output = await connection[action](code);
    if (chessConnection !== connection || onlineStatus !== 'busy') return;
    if (output) onlineCode = output;
    onlineStatus = action === 'accept' ? 'waiting' : action;
  } catch {
    if (chessMode !== 'online' || chessConnection !== connection) return;
    if (action !== 'accept') closeOnlineChess();
    onlineStatus = previous;
    onlineError = '연결할 수 없어요. 받은 코드 전체를 확인하고 다시 시도하세요.';
  }
  render();
}

function triggerAiTurn() {
  chess.turn = 'black';
  chess.phase = 'ai_thinking';
  render();

  // AI simulates thinking and answering question
  aiTimer = setTimeout(() => {
    // 70% chance AI answers correctly, 30% chance AI makes a mistake
    const aiSuccess = Math.random() < 0.70;
    if (aiSuccess) {
      toast('🤖 상대 AI가 단어를 맞췄습니다! 체스 말을 이동합니다.');
      const aiMove = chooseAiMove(chess.board, chessDifficulty);
      if (aiMove) {
        chess = makeMove(chess, aiMove.from[0], aiMove.from[1], aiMove.to[0], aiMove.to[1]);
        if (chess.phase !== 'game_over') {
          // Switch turn back to White (Player)
          chess.turn = 'white';
          chess.phase = 'word_quiz';
          generateChessQuiz('white');
        }
      } else {
        chess.turn = 'white';
        chess.phase = 'word_quiz';
        generateChessQuiz('white');
      }
    } else {
      // AI failed! Turn reverts back to User!
      toast('💥 상대 AI가 단어를 틀렸습니다! 공격권이 다시 나(⚪)에게 넘어왔습니다!');
      chess.turn = 'white';
      chess.phase = 'word_quiz';
      generateChessQuiz('white');
    }
    render();
  }, 1400);
}

/* ============================================
   EVENT DELEGATION
   ============================================ */
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.disabled) return;

  const action = btn.dataset.action;
  const wordId = btn.dataset.word;
  const setId = btn.dataset.set;
  const majorId = btn.dataset.major;

  // Nav actions
  if (action === 'nav-home') pushView('home');
  if (action === 'nav-majors') pushView('majors');
  if (action === 'nav-quiz') pushView('quiz');
  if (action === 'nav-review') pushView('review');
  if (action === 'open-settings' || action === 'nav-settings') $('#settings').showModal();

  if (action === 'select-major') {
    selectedMajorId = majorId;
    render();
  }

  if (action === 'open-detail') {
    activeSetId = setId;
    pushView('detail', { setId });
  }

  if (action === 'go-back-study') {
    pushView('detail', { setId: state.active?.setId || activeSetId });
  }

  if (action === 'start-session') {
    beginSession(setId);
  }

  if (action === 'continue-study') {
    pushView('study');
  }

  if (action === 'review-set') {
    const set = getSet(setId);
    const reviews = set.words.filter(w => statusOf(w.id) === 'review').map(w => w.id);
    if (!reviews.length) {
      toast('복습할 오답 단어가 없어 전체 세트를 학습합니다!');
      beginSession(setId);
    } else {
      beginSession(setId, reviews, 'review');
    }
  }

  if (action === 'start-review-all') {
    const reviews = reviewWords().map(w => w.id);
    if (!reviews.length) {
      toast('복습할 단어가 없습니다.');
      return;
    }
    beginSession(wordById(reviews[0]).setId, reviews, 'review');
  }

  if (action === 'save-offline') {
    if (!state.downloaded.includes(setId)) {
      const next = structuredClone(state);
      next.downloaded.push(setId);
      if (commit(next)) {
        toast(`${getSet(setId).name} 세트를 오프라인 캐시에 저장했습니다.`);
        render();
      }
    } else {
      toast('이미 기기에 저장된 세트입니다.');
    }
  }

  if (action === 'favorite') {
    const isFav = state.favorites.includes(wordId);
    const next = structuredClone(state);
    if (isFav) next.favorites = next.favorites.filter(id => id !== wordId);
    else next.favorites.push(wordId);
    commit(next);
    render();
  }

  if (action === 'speak') {
    speak(wordId);
  }

  if (action === 'answer' && !busy) {
    busy = true;
    btn.disabled = true;
    try {
      const status = btn.dataset.status;
      const next = answerSession(state, status);
      if (commit(next)) render();
    } finally {
      setTimeout(() => { busy = false; }, 200);
      btn.disabled = false;
    }
  }

  if (action === 'filter-review') {
    listFilter = btn.dataset.filter;
    render();
  }

  if (action === 'review-result') {
    const reviews = state.lastResult.answers.filter(a => a.status === 'review').map(a => a.wordId);
    beginSession(state.lastResult.setId, reviews, 'review');
  }

  if (action === 'next-set') {
    const currentIdx = SETS.findIndex(s => s.id === state.lastResult?.setId);
    const nextSet = SETS[(currentIdx + 1) % SETS.length];
    beginSession(nextSet.id);
  }

  /* ================= CHESS BATTLE ACTIONS ================= */
  if (action === 'chess-mode' && chessMode !== btn.dataset.mode) {
    closeOnlineChess();
    chessMode = btn.dataset.mode;
    render();
  }

  if (action === 'chess-online-reset') {
    closeOnlineChess();
    render();
  }

  if (['chess-online-offer', 'chess-online-answer', 'chess-online-accept'].includes(action)) {
    await connectChess(action.split('-').at(-1), $('#chess-peer-code')?.value.trim());
  }

  if (action === 'chess-quiz-select' && canPlayChess() && chess.activeQuiz && !chess.activeQuiz.checked) {
    chess.activeQuiz.selected = btn.dataset.opt;
    render();
  }

  if (action === 'chess-quiz-submit' && canPlayChess() && chess.activeQuiz?.selected && !chess.activeQuiz.checked) {
    const q = chess.activeQuiz;
    const isCorrect = q.selected === q.answer;
    q.checked = true;
    q.isCorrect = isCorrect;

    const word = wordById(q.wordId);
    const now = new Date();
    const nextState = structuredClone(state);

    nextState.events.push({
      id: newRecordId(),
      sessionId: 'chess_battle',
      wordId: word.id,
      status: isCorrect ? 'known' : 'review',
      occurredAt: now.toISOString(),
      day: localDay(now),
      source: 'chess'
    });

    if (isCorrect) {
      nextState.records[word.id] = { status: 'known', updatedAt: now.toISOString() };
      chess.score.streak++;
    } else {
      nextState.records[word.id] = { status: 'review', updatedAt: now.toISOString() };
      chess.score.streak = 0;
    }
    commit(nextState);
    render();
  }

  if (action === 'chess-quiz-continue' && canPlayChess() && chess.activeQuiz?.checked) {
    const isCorrect = chess.activeQuiz.isCorrect;
    if (isCorrect) {
      // User got it right! Now User can move a piece on the board
      chess.phase = 'move_piece';
      chess.activeQuiz = null;
      toast(`체스판에서 ${sideLabel(chess.turn)} 말을 골라 이동하세요.`);
      render();
    } else {
      // User got it wrong! Turn switches to AI!
      finishChessTurn(null);
    }
  }

  if (action === 'chess-square') {
    const r = parseInt(btn.dataset.r, 10);
    const c = parseInt(btn.dataset.c, 10);

    // Only allow human moves during 'move_piece' phase on White turn
    if (chess.phase !== 'move_piece' || !canPlayChess()) {
      if (chess.phase === 'word_quiz') {
        toast('단어 퀴즈를 먼저 맞춰야 말을 움직일 수 있습니다!');
      }
      return;
    }

    const clickedPiece = chess.board[r][c];

    // If a square was already selected and clicked is a valid move
    if (chess.selectedSquare && chess.validMoves.some(([vr, vc]) => vr === r && vc === c)) {
      const [fromR, fromC] = chess.selectedSquare;
      finishChessTurn([fromR, fromC, r, c]);
      return;
    }

    // Select White piece
    if (clickedPiece && isWhite(clickedPiece) === (chess.turn === 'white')) {
      chess.selectedSquare = [r, c];
      chess.validMoves = getPieceMoves(chess.board, r, c);
      render();
    } else {
      chess.selectedSquare = null;
      chess.validMoves = [];
      render();
    }
  }

  if (action === 'chess-difficulty') {
    chessDifficulty = btn.dataset.level;
    render();
    document.querySelector('[data-action="chess-difficulty"][aria-pressed="true"]')?.focus({preventScroll: true});
  }

  if (action === 'restart-chess') {
    resetChess();
    render();
  }

  if (action === 'refresh-recommend') {
    render();
  }
});

/* ============================================
   SETTINGS & SYNC ACTIONS
   ============================================ */
$('#export-records')?.addEventListener('click', () => {
  const raw = JSON.stringify(state, null, 2);
  const blob = new Blob([raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `word-garden-backup-${localDay()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#sync-records')?.addEventListener('click', async () => {
  toast('로컬 저장소 동기화 상태를 점검 중입니다...');
  try {
    const res = await syncEvents(state);
    if (res.status === 'done') toast('기록이 안전하게 동기화되었습니다.');
    else toast('로컬 브라우저 기기 저장 모드로 정상 작동 중입니다.');
  } catch {
    toast('기록은 이 기기에 안전하게 보존됩니다.');
  }
});

$('#reset-study-btn')?.addEventListener('click', () => {
  if (confirm('모든 학습 기록과 복습 노트를 초기화하시겠습니까? (되돌릴 수 없습니다)')) {
    state = initialState();
    persist(localStorage, state);
    render();
    $('#settings').close();
    toast('학습 기록이 초기화되었습니다.');
  }
});

window.addEventListener('online', () => { render(); toast('네트워크 연결이 복구되었습니다.'); });
window.addEventListener('offline', () => { render(); toast('오프라인 모드로 전환되었습니다. 기기 캐시로 계속 학습할 수 있습니다.'); });

// Start initial
if (state.active) view = 'study';
render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
