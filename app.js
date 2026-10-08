import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import {
  getDatabase, ref, push, update, remove, onValue
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyAXl2nUTmbrEILGBCjLwuYmM4VHW1h1HPo",
  authDomain: "csw-todo-backend.firebaseapp.com",
  projectId: "csw-todo-backend",
  storageBucket: "csw-todo-backend.firebasestorage.app",
  messagingSenderId: "256506137478",
  appId: "1:256506137478:web:b13cf179fdceea7ba7fa07",
  databaseURL: "https://csw-todo-backend-default-rtdb.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const todosRef = ref(db, 'todos');

const membersRef = ref(db, 'colleagues');

// ---- 주차 (월요일 시작) ----
const pad = n => String(n).padStart(2, '0');
const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function mondayOf(d) {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}
const weekKeyOf = d => dateKey(mondayOf(d));
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
// 주차 정보가 없는 예전 할일은 생성일 기준 주차로 분류
const todoWeek = t => t.week || weekKeyOf(new Date(t.createdAt || Date.now()));
function weekLabel(key) {
  const mon = parseKey(key);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const thu = new Date(mon); thu.setDate(mon.getDate() + 3); // 목요일이 속한 달을 기준으로 N주차 계산
  const n = Math.ceil(thu.getDate() / 7);
  const f = d => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${thu.getFullYear()}년 ${thu.getMonth() + 1}월 ${n}주차 (${f(mon)} ~ ${f(sun)})`;
}
// ---- 월 (그 주의 목요일이 속한 달 = 그 주차가 속한 달) ----
const monthOfWeek = key => { const t = parseKey(key); t.setDate(t.getDate() + 3); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}`; };
const monthLabel = m => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const shiftMonthKey = (m, delta) => { const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5)) - 1 + delta, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const weekParts = key => {
  const mon = parseKey(key), sun = new Date(mon), thu = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  thu.setDate(mon.getDate() + 3);
  return { month: thu.getMonth() + 1, n: Math.ceil(thu.getDate() / 7), range: `${mon.getMonth() + 1}/${mon.getDate()}~${sun.getMonth() + 1}/${sun.getDate()}` };
};

// ---- 콤비네이션 차트: 할일 개수(막대, 왼쪽 축) + 달성률(선, 오른쪽 축) ----
let chartMode = 'week'; // 'week'(주차별) | 'month'(월별)

// 1년 전이 속한 주/달부터, 가장 최근 구간(이번 주/달 또는 더 미래에 할일이 있으면 그 주/달)까지
function chartData(items) {
  const buckets = [];
  const today = new Date();
  const thisWeek = weekKeyOf(today);
  const lastWeek = items.reduce((mx, t) => { const w = todoWeek(t); return w > mx ? w : mx; }, thisWeek);
  const yearAgoWeek = weekKeyOf(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate()));
  if (chartMode === 'week') {
    for (let key = yearAgoWeek; key <= lastWeek; ) {
      const p = weekParts(key);
      buckets.push({ key, label: `${p.n}주차`, sub: `${p.month}월`, title: `${p.month}월 ${p.n}주차 (${p.range})`, total: 0, done: 0 });
      const d = parseKey(key); d.setDate(d.getDate() + 7); key = dateKey(d);
    }
  } else {
    const last = monthOfWeek(lastWeek);
    for (let key = monthOfWeek(yearAgoWeek); key <= last; key = shiftMonthKey(key, 1)) {
      buckets.push({ key, label: `${Number(key.slice(5))}월`, sub: key.slice(0, 4), title: monthLabel(key), total: 0, done: 0 });
    }
  }
  const currentKey = chartMode === 'week' ? thisWeek : monthOfWeek(thisWeek);
  let excluded = 0;
  items.forEach(t => {
    const k = chartMode === 'week' ? todoWeek(t) : monthOfWeek(todoWeek(t));
    const b = buckets.find(x => x.key === k);
    if (!b) return excluded++;
    b.total++; if (t.done) b.done++;
  });
  buckets.forEach(b => { b.rate = b.total ? Math.round((b.done / b.total) * 100) : null; });
  return { buckets, excluded, currentKey };
}

let lastChartItems = [];

function renderChart(items) {
  lastChartItems = items;
  const isMonth = chartMode === 'month';
  const wrap = document.getElementById('chart');
  const wrapW = Math.max(260, wrap.clientWidth || 600);
  const { buckets, excluded, currentKey } = chartData(items);
  document.getElementById('chart-title').textContent =
    `📊 ${isMonth ? '월별' : '주차별'} 할일 개수와 달성률`;

  // 주차별 / 월별 전환 토글
  const toggle = document.getElementById('chart-toggle');
  toggle.innerHTML = '';
  [['week', '주차별'], ['month', '월별']].forEach(([mode, text]) => {
    const b = btn(text, chartMode === mode ? '' : 'ghost', () => { chartMode = mode; renderChart(lastChartItems); });
    b.setAttribute('aria-pressed', chartMode === mode);
    toggle.appendChild(b);
  });

  const note = document.getElementById('chart-note');
  note.textContent = `과거 1년 전부터 보여줘요 (${buckets.length}${isMonth ? '개월' : '주'}). 좁으면 좌우로 밀어 보세요.` +
    (excluded ? ` 1년보다 오래된 할일 ${excluded}개는 제외됐어요.` : '');

  // 표 (접근성/대체 보기)
  document.getElementById('chart-table').innerHTML =
    '<table><thead><tr><th>' + (isMonth ? '월' : '주차') + '</th><th>할일</th><th>완료</th><th>달성률</th></tr></thead><tbody>' +
    buckets.map(b => `<tr><td>${b.title}</td><td>${b.total}</td><td>${b.done}</td><td>${b.rate == null ? '-' : b.rate + '%'}</td></tr>`).join('') +
    '</tbody></table>';

  if (!buckets.some(b => b.total)) {
    wrap.innerHTML = '<div class="chart-empty">차트로 표시할 할일이 없어요</div>';
    return;
  }

  const minBand = isMonth ? 44 : 18; // 막대가 너무 가늘어지지 않도록 최소 폭 확보 → 넘치면 가로 스크롤
  const W = Math.max(wrapW, 32 + 44 + buckets.length * minBand);
  const H = wrapW < 420 ? 230 : 270;
  const m = { l: 32, r: 44, t: 26, b: 44 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const maxC = Math.max(...buckets.map(b => b.total));
  const yMax = Math.max(4, Math.ceil(maxC / 4) * 4); // 4등분 → 오른쪽 축 0/25/50/75/100%와 눈금 일치
  const band = iw / buckets.length;
  const cx = i => m.l + band * (i + 0.5);
  const yC = v => m.t + ih - (v / yMax) * ih;
  const yP = v => m.t + ih - (v / 100) * ih;
  const bw = Math.min(30, band * 0.5);

  let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${isMonth ? '월별' : '주차별'} 할일 개수(막대)와 달성률(선)">`;

  // 눈금선 + 양쪽 축 라벨
  for (let i = 0; i <= 4; i++) {
    const y = m.t + ih - (ih * i) / 4;
    s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${i === 0 ? '#9ca3af' : '#e5e7eb'}" stroke-width="1"/>`;
    s += `<text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${(yMax * i) / 4}</text>`;
    s += `<text x="${W - m.r + 6}" y="${y + 4}" text-anchor="start">${i * 25}%</text>`;
  }
  s += `<text x="${m.l - 6}" y="10" text-anchor="end">개수</text>`;
  s += `<text x="${W - m.r + 6}" y="10" text-anchor="start">달성률</text>`;

  // 막대 (윗면만 4px 둥글게, 기준선에 붙음)
  buckets.forEach((b, i) => {
    if (!b.total) return;
    const h = ih - (yC(b.total) - m.t), x = cx(i) - bw / 2, y = yC(b.total), r = Math.min(4, h, bw / 2);
    s += `<path d="M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + h} Z" fill="var(--c-bar)"/>`;
  });

  // 선 (값이 없는 구간은 끊음) + 마커
  let seg = [];
  const segs = [];
  buckets.forEach((b, i) => {
    if (b.rate == null) { if (seg.length) segs.push(seg); seg = []; return; }
    seg.push([cx(i), yP(b.rate)]);
  });
  if (seg.length) segs.push(seg);
  segs.forEach(p => {
    if (p.length > 1) s += `<polyline points="${p.map(q => q.join(',')).join(' ')}" fill="none" stroke="var(--c-line)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  buckets.forEach((b, i) => {
    if (b.rate == null) return;
    s += `<circle cx="${cx(i)}" cy="${yP(b.rate)}" r="4" fill="var(--c-line)" stroke="#fff" stroke-width="2"/>`;
  });

  // x축 라벨(칸이 좁으면 건너뛰며 표시) + 호버 영역
  const labelStep = Math.max(1, Math.ceil(40 / band));
  buckets.forEach((b, i) => {
    if (i % labelStep === 0) {
      s += `<text x="${cx(i)}" y="${H - m.b + 16}" text-anchor="middle" style="fill:var(--c-ink)">${b.label}</text>`;
      if (band * labelStep >= 44) s += `<text x="${cx(i)}" y="${H - m.b + 30}" text-anchor="middle">${b.sub}</text>`;
    }
    s += `<rect class="hover-band" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih}"/>`;
    s += `<rect class="hit" data-i="${i}" x="${m.l + band * i}" y="${m.t}" width="${band}" height="${ih + 40}"/>`;
  });
  s += '</svg><div class="chart-tip" id="chart-tip"></div>';
  // 다시 그릴 때 스크롤 위치 유지, 처음/전환 시에는 이번 주(달)가 보이도록 이동
  const prevScroll = wrap.dataset.mode === chartMode ? wrap.scrollLeft : null;
  wrap.dataset.mode = chartMode;
  wrap.innerHTML = s;
  if (W > wrapW) {
    const ci = Math.max(0, buckets.findIndex(b => b.key === currentKey));
    wrap.scrollLeft = prevScroll != null ? prevScroll : Math.max(0, cx(ci) - wrapW * 0.65);
  }

  // 툴팁
  const tip = document.getElementById('chart-tip');
  const bands = wrap.querySelectorAll('.hover-band');
  const show = i => {
    const b = buckets[i];
    bands.forEach((el, k) => el.classList.toggle('on', k === i));
    tip.innerHTML =
      `<b>${b.title}</b>` +
      `<div><i style="background:var(--c-bar)"></i>할일 ${b.total}개 (완료 ${b.done}개)</div>` +
      `<div><i style="background:var(--c-line)"></i>달성률 ${b.rate == null ? '-' : b.rate + '%'}</div>`;
    tip.classList.add('on');
    const tw = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(W - tw, cx(i) - tw / 2)) + 'px';
    tip.style.top = Math.max(0, m.t - 4) + 'px';
  };
  const hide = () => { tip.classList.remove('on'); bands.forEach(el => el.classList.remove('on')); };
  wrap.querySelectorAll('.hit').forEach(el => {
    el.addEventListener('pointerenter', () => show(+el.dataset.i));
    el.addEventListener('pointerdown', () => show(+el.dataset.i));
    // 터치는 손을 떼도 툴팁을 유지하고, 다른 곳을 누르면 닫음
    el.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') hide(); });
  });
  if (!wrap.dataset.outside) {
    wrap.dataset.outside = '1';
    document.addEventListener('pointerdown', e => {
      if (!e.target.closest || !e.target.closest('.chart-wrap')) {
        const t = document.getElementById('chart-tip');
        if (t) t.classList.remove('on');
        document.querySelectorAll('.hover-band.on').forEach(el => el.classList.remove('on'));
      }
    });
  }
}

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => renderChart(lastChartItems), 150);
});

let todos = [];
let members = [];
let editingId = null;

function showError(err) {
  console.error(err);
  countEl.textContent = '⚠️ Firebase 오류: ' + err.message;
}

// 실시간 동기화: 데이터가 바뀔 때마다 목록을 다시 그림
onValue(todosRef, snap => {
  const val = snap.val() || {};
  todos = Object.entries(val)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  render();
}, showError);

onValue(membersRef, snap => {
  const val = snap.val() || {};
  members = Object.entries(val)
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  render();
}, showError);

const listEl = document.getElementById('list');
const countEl = document.getElementById('count');
const input = document.getElementById('new-todo');

const memberName = id => (members.find(m => m.id === id) || {}).name;

function assigneeSelect(selected) {
  const sel = document.createElement('select');
  sel.title = '담당자';
  sel.add(new Option('담당자 없음', ''));
  members.forEach(m => sel.add(new Option(m.name, m.id)));
  sel.value = members.some(m => m.id === selected) ? selected : '';
  return sel;
}

let filterAssignee = 'all'; // 'all' | '' (담당자 없음) | 동료 id

function renderFilter(all) {
  const box = document.getElementById('filter');
  box.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'filter-label';
  label.textContent = '👤 담당자별 보기';
  box.appendChild(label);
  const count = fn => all.filter(fn).length;
  const options = [
    ['all', '전체', all.length],
    ...members.map(m => [m.id, m.name, count(t => t.assignee === m.id)]),
    ['', '담당자 없음', count(t => !memberName(t.assignee))]
  ];
  options.forEach(([val, text, n]) => {
    const b = btn(`${text} ${n}`, filterAssignee === val ? '' : 'ghost', () => { filterAssignee = val; editingId = null; render(); });
    b.classList.add('pill');
    b.setAttribute('aria-pressed', filterAssignee === val);
    box.appendChild(b);
  });
}

function renderMembers() {
  const chips = document.getElementById('members');
  chips.innerHTML = '';
  members.forEach(m => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.append(m.name);
    const x = btn('×', '', () => {
      if (confirm(`'${m.name}' 동료를 삭제할까요?`)) remove(ref(db, 'colleagues/' + m.id)).catch(showError);
    });
    x.title = '삭제';
    chip.appendChild(x);
    chips.appendChild(chip);
  });
  // 추가 폼의 담당자 선택 목록 갱신 (선택값 유지)
  const addSel = document.getElementById('new-assignee');
  const cur = addSel.value;
  addSel.innerHTML = '';
  addSel.add(new Option('담당자 없음', ''));
  members.forEach(m => addSel.add(new Option(m.name, m.id)));
  addSel.value = members.some(m => m.id === cur) ? cur : '';
}

function render() {
  renderMembers();
  // 마감 당일(D-0) 또는 하루 전(D-1)인 미완료 할일이 있으면 화면 깜빡임 + 이유 안내
  const urgent = todos.filter(t => !t.done && t.due && daysLeft(t.due) <= 1 && daysLeft(t.due) >= 0);
  document.getElementById('alert').classList.toggle('on', urgent.length > 0);
  const banner = document.getElementById('banner');
  banner.classList.toggle('on', urgent.length > 0);
  banner.innerHTML = '';
  if (urgent.length) {
    const title = document.createElement('strong');
    title.textContent = `🚨 마감이 임박한 할일이 ${urgent.length}개 있어서 화면이 깜빡이고 있어요 (마감 당일/하루 전)`;
    const ul = document.createElement('ul');
    urgent.forEach(t => {
      const li = document.createElement('li');
      const who = memberName(t.assignee);
      li.textContent = `${t.text} — ${daysLeft(t.due) === 0 ? '오늘 마감' : '내일 마감'} (${t.due})` + (who ? ` · 담당: ${who}` : '');
      ul.appendChild(li);
    });
    banner.append(title, ul);
  }
  const urgentIds = new Set(urgent.map(t => t.id));
  listEl.innerHTML = '';
  // 전체 할일을 최근 주차부터 보여줌 (같은 주 안에서는 만든 순서 유지)
  const sorted = [...todos].sort((a, b) => todoWeek(b).localeCompare(todoWeek(a)));
  // 담당자 필터 (선택한 동료가 삭제됐으면 전체로 되돌림)
  if (filterAssignee !== 'all' && filterAssignee !== '' && !members.some(m => m.id === filterAssignee)) filterAssignee = 'all';
  renderFilter(sorted);
  const weekTodos = sorted.filter(t =>
    filterAssignee === 'all' ? true
    : filterAssignee === '' ? !memberName(t.assignee)
    : t.assignee === filterAssignee);
  let lastHeadWeek = null;
  if (!weekTodos.length) {
    listEl.innerHTML = `<div class="empty">${filterAssignee === 'all' ? '할일이 없습니다 🎉' : '해당 담당자의 할일이 없습니다'}</div>`;
  }
  weekTodos.forEach(t => {
    // 주차마다 소제목을 넣어 구분
    if (todoWeek(t) !== lastHeadWeek) {
      lastHeadWeek = todoWeek(t);
      const head = document.createElement('li');
      head.className = 'week-head';
      head.textContent = weekLabel(lastHeadWeek) + (lastHeadWeek === weekKeyOf(new Date()) ? ' · 이번 주' : '');
      listEl.appendChild(head);
    }
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    else if (urgentIds.has(t.id)) li.className = 'urgent';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = t.done;
    cb.onchange = () => update(ref(db, 'todos/' + t.id), { done: cb.checked }).catch(showError);
    li.appendChild(cb);

    if (editingId === t.id) {
      const edit = document.createElement('input');
      edit.type = 'text';
      edit.value = t.text;
      const dueEdit = document.createElement('input');
      dueEdit.type = 'date';
      dueEdit.value = t.due || '';
      const whoEdit = assigneeSelect(t.assignee);
      const commit = () => {
        const v = edit.value.trim() || t.text;
        const d = dueEdit.value;
        const a = whoEdit.value;
        editingId = null;
        if (v !== t.text || d !== (t.due || '') || a !== (t.assignee || '')) update(ref(db, 'todos/' + t.id), { text: v, due: d, assignee: a }).catch(showError);
        else render();
      };
      edit.onkeydown = e => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') { editingId = null; render(); }
      };
      li.appendChild(edit);
      li.appendChild(whoEdit);
      li.appendChild(dueEdit);
      li.appendChild(btn('저장', '', commit));
      li.appendChild(btn('취소', 'ghost', () => { editingId = null; render(); }));
      setTimeout(() => edit.focus(), 0);
    } else {
      const span = document.createElement('span');
      span.textContent = t.text;
      li.appendChild(span);
      const who = memberName(t.assignee);
      if (who) {
        const whoEl = document.createElement('span');
        whoEl.className = 'who';
        whoEl.textContent = '👤 ' + who;
        li.appendChild(whoEl);
      }
      if (t.due) {
        const dueEl = document.createElement('span');
        dueEl.className = 'due';
        const left = daysLeft(t.due);
        dueEl.textContent = '📅 ' + t.due + (left === 0 ? ' (오늘)' : left < 0 ? ` (${-left}일 지남)` : ` (D-${left})`);
        if (left < 0 && !t.done) dueEl.classList.add('overdue');
        li.appendChild(dueEl);
      }
      li.appendChild(btn('수정', 'ghost', () => { editingId = t.id; render(); }));
      li.appendChild(btn('삭제', 'danger', () => remove(ref(db, 'todos/' + t.id)).catch(showError)));
    }
    listEl.appendChild(li);
  });
  const remaining = weekTodos.filter(t => !t.done).length;
  countEl.textContent = weekTodos.length ? `남은 할일 ${remaining}개 / 전체 ${weekTodos.length}개` : '';
  renderChart(todos);
}

function daysLeft(due) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [y, m, d] = due.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}

function btn(label, cls, onclick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = onclick;
  return b;
}

document.getElementById('add-form').onsubmit = e => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  const dueInput = document.getElementById('new-due');
  const assignee = document.getElementById('new-assignee').value;
  push(todosRef, { text, done: false, due: dueInput.value, assignee, week: weekKeyOf(new Date()), createdAt: Date.now() }).catch(showError);
  input.value = '';
  dueInput.value = '';
};

document.getElementById('member-form').onsubmit = e => {
  e.preventDefault();
  const memberInput = document.getElementById('new-member');
  const name = memberInput.value.trim();
  if (!name) return;
  push(membersRef, { name, createdAt: Date.now() }).catch(showError);
  memberInput.value = '';
};

render();

const clockEl = document.getElementById('clock');
// ---- 글귀 (사이트를 열 때마다 무작위로 하나, 직전과 같은 글귀는 피함) ----
const QUOTES = [
  { q: '새는 알에서 나오려고 투쟁한다. 알은 세계다. 태어나려는 자는 하나의 세계를 파괴하지 않으면 안 된다.', a: '헤르만 헤세', b: '데미안' },
  { q: '사막이 아름다운 것은 어딘가에 우물을 숨기고 있기 때문이야.', a: '앙투안 드 생텍쥐페리', b: '어린 왕자' },
  { q: '인간은 파멸당할 수는 있어도 패배할 수는 없다.', a: '어니스트 헤밍웨이', b: '노인과 바다' },
  { q: '천 리 길도 한 걸음부터 시작된다.', a: '노자', b: '도덕경' },
  { q: '배우기만 하고 생각하지 않으면 얻는 것이 없고, 생각만 하고 배우지 않으면 위태롭다.', a: '공자', b: '논어' },
  { q: '아침에 일어나기 싫을 때는 이렇게 생각하라. 나는 인간으로서 일하기 위해 일어나는 것이다.', a: '마르쿠스 아우렐리우스', b: '명상록' },
  { q: '네가 오후 4시에 온다면, 나는 3시부터 행복해지기 시작할 거야.', a: '앙투안 드 생텍쥐페리', b: '어린 왕자' },
  { q: '세 사람이 길을 가면 그 안에 반드시 나의 스승이 있다.', a: '공자', b: '논어' },
  { q: '인간은 생각하는 갈대이다.', a: '블레즈 파스칼', b: '팡세' }
];
function renderQuote() {
  let last = -1;
  try { last = Number(localStorage.getItem('lastQuote')); } catch (e) {}
  let idx;
  do { idx = Math.floor(Math.random() * QUOTES.length); } while (idx === last && QUOTES.length > 1);
  try { localStorage.setItem('lastQuote', idx); } catch (e) {}
  const item = QUOTES[idx];
  const el = document.getElementById('quote');
  el.innerHTML = '';
  const q = document.createElement('span');
  q.className = 'q';
  q.textContent = `“${item.q}”`;
  const src = document.createElement('span');
  src.className = 'src';
  src.textContent = `— ${item.a}, 『${item.b}』`;
  el.append(q, src);
}
renderQuote();

let lastDay = new Date().toDateString();
function tick() {
  // 자정이 지나 날짜가 바뀌면 D-day 계산을 다시 반영
  const day = new Date().toDateString();
  if (day !== lastDay) { lastDay = day; render(); }
  clockEl.textContent = new Date().toLocaleString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}
tick();
setInterval(tick, 1000);

// ---- 날씨 (Open-Meteo, API 키 불필요) ----
const SEOUL = { lat: 37.5665, lon: 126.978, label: '서울(기본값)' };

function describe(code) {
  if (code === 0) return { kind: 'clear', text: '맑음', icon: '☀️' };
  if (code <= 2) return { kind: 'partly', text: '구름 조금', icon: '🌤️' };
  if (code === 3) return { kind: 'cloudy', text: '흐림', icon: '☁️' };
  if (code === 45 || code === 48) return { kind: 'fog', text: '안개', icon: '🌫️' };
  if (code >= 51 && code <= 67) return { kind: 'rain', text: '비', icon: '🌧️' };
  if (code >= 71 && code <= 77) return { kind: 'snow', text: '눈', icon: '❄️' };
  if (code >= 80 && code <= 82) return { kind: 'rain', text: '소나기', icon: '🌦️' };
  if (code === 85 || code === 86) return { kind: 'snow', text: '눈보라', icon: '🌨️' };
  if (code >= 95) return { kind: 'storm', text: '뇌우', icon: '⛈️' };
  return { kind: 'cloudy', text: '알 수 없음', icon: '🌡️' };
}

const SKY = {
  clear:  ['#4facfe', '#87cefb', '#1e3a5f', '#0b1026'],
  partly: ['#6ea8e6', '#b5d3f0', '#2a3f66', '#121a33'],
  cloudy: ['#8e9aaf', '#c5ccd6', '#3a4150', '#1c2029'],
  fog:    ['#b0b8c1', '#dfe3e8', '#4a505a', '#262a31'],
  rain:   ['#5b6b80', '#8b9bb0', '#2b3441', '#141920'],
  snow:   ['#aebfd3', '#eef3f8', '#4b5a70', '#222a38'],
  storm:  ['#3d4658', '#657089', '#1f2430', '#0c0e14']
};

function applyWeather(w, isDay, place) {
  const [top, bottom, nTop, nBottom] = SKY[w.kind];
  document.body.style.background = isDay
    ? `linear-gradient(to bottom, ${top}, ${bottom})`
    : `linear-gradient(to bottom, ${nTop}, ${nBottom})`;
  document.getElementById('weather').textContent =
    `${w.icon} ${place} · ${w.text}` + (w.temp != null ? ` · ${Math.round(w.temp)}°C` : '') + (isDay ? '' : ' · 밤');
  particles(w.kind);
}

function particles(kind) {
  const fx = document.getElementById('fx');
  fx.innerHTML = '';
  if (kind !== 'rain' && kind !== 'snow' && kind !== 'storm') return;
  const snow = kind === 'snow';
  const n = snow ? 60 : 90;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'drop' + (snow ? '' : ' rain');
    if (snow) d.textContent = '❄';
    d.style.left = Math.random() * 100 + 'vw';
    d.style.animationDuration = (snow ? 6 + Math.random() * 6 : 0.7 + Math.random() * 0.6) + 's';
    d.style.animationDelay = -Math.random() * 8 + 's';
    d.style.setProperty('--dx', (snow ? Math.random() * 60 - 30 : -20) + 'px');
    if (snow) d.style.fontSize = 10 + Math.random() * 12 + 'px';
    fx.appendChild(d);
  }
}

async function loadWeather(pos) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}` +
      `&current=temperature_2m,weather_code,is_day&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const c = (await res.json()).current;
    const w = describe(c.weather_code);
    w.temp = c.temperature_2m;
    applyWeather(w, c.is_day === 1, pos.label);
  } catch (err) {
    console.error(err);
    document.getElementById('weather').textContent = '⚠️ 날씨를 불러오지 못했어요';
  }
}

function startWeather() {
  const go = pos => { loadWeather(pos); };
  const fallback = () => go(SEOUL);
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    p => { current = { lat: p.coords.latitude, lon: p.coords.longitude, label: '현재 위치' }; go(current); },
    () => { current = SEOUL; fallback(); },
    { timeout: 8000 }
  );
}

let current = SEOUL;
startWeather();
setInterval(() => loadWeather(current), 30 * 60 * 1000); // 30분마다 갱신
