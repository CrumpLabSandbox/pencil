import { PAGE, PENCIL, Sim, runPage, newPencil, tipWidth, sharpness } from './engine.js';
import { drawItem, drawPencilAt, drawGauge } from './render.js';

const $ = (s) => document.querySelector(s);
const pad3 = (n) => String(n).padStart(3, '0');
const LOCAL_KEY = 'pencil.local.v1';
const SPEED_BASE = 60;   // mm of stroke per second at 1×
const LOCAL_STUB = 30;   // your own pencil can be used down to a stub
const MAX_PAGES = 100;

const sheet = $('#sheet'), overlay = $('#overlay'), gauge = $('#gauge');
const sctx = sheet.getContext('2d'), octx = overlay.getContext('2d'), gctx = gauge.getContext('2d');

const app = {
  projects: [], texts: {},   // one manifest per agent-filled notebook project
  local: loadLocal(),
  book: 0, page: 1,
  items: [], idx: 0, carry: 0, start: newPencil(), startSharpenings: 0,
  sim: null,            // live Sim for the local page being drawn on
  playing: false, speed: 25, sharpenUntil: 0, flipAt: 0,
  tool: 'pencil', pressure: 0.8, drawing: null,
  k: 4, cache: new Map(), loadToken: 0
};

// ---------------------------------------------------------------- data

function loadLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY));
    if (v && Array.isArray(v.notebooks)) return v;
  } catch { /* fall through to a fresh store */ }
  return { pencil: newPencil(), notebooks: [], counter: 0 };
}
function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(app.local)); } catch { toast('Could not save — browser storage is full or blocked.'); }
}

const books = () => [
  ...app.projects.flatMap((pr) => pr.notebooks.map((nb, i) => ({
    kind: 'agent', pr, nb, key: `${pr.id}/${nb.id}`, count: nb.pages.length,
    title: pr.notebooks.length > 1 ? `${pr.title} · ${i + 1}` : pr.title
  }))),
  ...app.local.notebooks.map((nb) => ({ kind: 'local', nb, key: nb.id, title: nb.title, count: nb.pages.length }))
];
const stopOf = (b) => b?.pr?.stopAt ?? PENCIL.half;
const finished = (pr) => pr.done && pr.closing;
const cur = () => books()[app.book];

// Returns true if anything changed since the last fetch.
async function fetchProjects() {
  try {
    const res = await fetch('data/index.json', { cache: 'no-store' });
    if (!res.ok) return false;
    const { books: listed } = await res.json();
    let changed = listed.length !== app.projects.length;
    const next = [];
    for (const { id } of listed) {
      const have = app.projects.find((p) => p.id === id);
      if (have && finished(have)) { next.push(have); continue; }
      const r = await fetch(`data/${id}/manifest.json`, { cache: 'no-store' });
      if (!r.ok) continue;
      const text = await r.text();
      if (text !== app.texts[id]) { app.texts[id] = text; changed = true; next.push(JSON.parse(text)); } else next.push(have);
    }
    app.projects = next;
    return changed;
  } catch { return false; }
}

async function agentPage(b, n) {
  const key = `${b.key}/${pad3(n)}`;
  if (!app.cache.has(key)) {
    const res = await fetch(`data/${key}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`page ${key} missing`);
    const page = await res.json();
    const { sim } = runPage(page.ops, page.before, page.seed, { stopAt: stopOf(b) });
    app.cache.set(key, { items: sim.items, start: page.before });
    if (app.cache.size > 12) app.cache.delete(app.cache.keys().next().value);
  }
  return app.cache.get(key);
}

// Local pages store raw hand strokes plus the pencil state each began with.
function replayLocal(page) {
  const sim = new Sim(page.ops[0]?.st ?? app.local.pencil, { stopAt: LOCAL_STUB });
  for (const op of page.ops) {
    Object.assign(sim.s, op.st);
    sim.stopped = sim.s.length <= LOCAL_STUB;
    if (op.k === 'x') sim.sharpen(false);
    else for (let i = 2; i < op.p.length; i += 2) {
      const seg = [[op.p[i - 2], op.p[i - 1]], [op.p[i], op.p[i + 1]]];
      if (op.k === 's') sim.stroke(seg, op.pr); else sim.erase(seg);
    }
  }
  Object.assign(sim.s, app.local.pencil);
  sim.stopped = sim.s.length <= LOCAL_STUB;
  return sim;
}

// ---------------------------------------------------------------- layout + drawing

function layout() {
  const desk = $('#desk'), wide = matchMedia('(min-width: 901px)').matches;
  const availW = desk.clientWidth - 32;
  const availH = (wide ? desk.clientHeight : innerHeight * 0.86) - $('.transport').offsetHeight - 22 - 30;
  app.k = Math.max(2, Math.min(availW / PAGE.w, availH / (PAGE.h + 9)));
  document.documentElement.style.setProperty('--mm', `${app.k}px`);
  const dpr = devicePixelRatio || 1;
  sheet.width = Math.round(PAGE.w * app.k * dpr); sheet.height = Math.round(PAGE.h * app.k * dpr);
  overlay.width = Math.round(desk.clientWidth * dpr); overlay.height = Math.round(desk.clientHeight * dpr);
  gauge.width = Math.round(gauge.clientWidth * dpr); gauge.height = Math.round(gauge.clientHeight * dpr);
  redraw();
}

function redraw() {
  const s = app.k * (devicePixelRatio || 1);
  sctx.setTransform(1, 0, 0, 1, 0, 0);
  sctx.clearRect(0, 0, sheet.width, sheet.height);
  sctx.setTransform(s, 0, 0, s, 0, 0);
  for (let i = 0; i < app.idx; i++) drawItem(sctx, app.items[i]);
  paintChrome();
}

function stateNow() {
  if (app.sim && !app.playing && app.idx === app.items.length) return app.sim.s;
  const it = app.items[app.idx - 1];
  return it ? { ...app.start, length: it.st[0], worn: it.st[1], eraser: it.st[2] } : app.start;
}

function paintChrome() {
  const st = stateNow(), agent = cur()?.kind !== 'local';
  // gauge
  const dpr = devicePixelRatio || 1, total = PENCIL.length + PENCIL.eraser * 0.55 + 4;
  const g = gauge.width / total;
  gctx.setTransform(1, 0, 0, 1, 0, 0);
  gctx.clearRect(0, 0, gauge.width, gauge.height);
  gctx.setTransform(g, 0, 0, g, 2 * g, gauge.height / 2);
  const stopAt = stopOf(cur());
  drawGauge(gctx, st, { mark: agent ? stopAt : null });
  let sharp = app.startSharpenings;
  for (let i = 0; i < app.idx; i++) if (app.items[i].t === 'x') sharp++;
  $('#gLength').textContent = `${st.length.toFixed(1)} mm`;
  const used = PENCIL.length - st.length;
  $('#gUsed').textContent = agent
    ? `${used.toFixed(1)} of ${(PENCIL.length - stopAt).toFixed(1)} mm`
    : `${used.toFixed(1)} mm (${Math.round((used / PENCIL.length) * 100)}%)`;
  $('#gTip').textContent = `${tipWidth(st).toFixed(2)} mm · ${Math.round(sharpness(st) * 100)}% sharp`;
  $('#gEraser').textContent = `${st.eraser.toFixed(1)} mm`;
  $('#gSharp').textContent = `${sharp}×`;
  $('#progress').style.width = `${app.items.length ? (app.idx / app.items.length) * 100 : 0}%`;

  // the pencil on the desk
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const desk = $('#desk').getBoundingClientRect(), sr = sheet.getBoundingClientRect();
  const ox = sr.left - desk.left, oy = sr.top - desk.top, s = app.k * dpr;
  octx.setTransform(s, 0, 0, s, ox * dpr, oy * dpr);
  const active = app.playing || app.drawing;
  if (active) {
    const it = app.items[app.idx - 1] ?? app.items[0];
    const sharpening = performance.now() < app.sharpenUntil;
    const [x, y] = it ? it.p.slice(-2) : [PAGE.w / 2, PAGE.h / 2];
    const mode = sharpening ? 'sharpen' : (it?.t === 'e' || (app.drawing && app.tool === 'eraser')) ? 'erase' : 'write';
    drawPencilAt(octx, x, y, st, mode, mode === 'sharpen' ? -58 + Math.sin(performance.now() / 60) * 3 : -58);
  } else {
    const gutter = (desk.right - sr.right) / app.k; // mm of desk to the right of the pad
    if (gutter > 16) drawPencilAt(octx, PAGE.w + Math.min(gutter / 2, 14), PAGE.h - 6, st, 'write', -90);
  }
}

// ---------------------------------------------------------------- navigation

async function show(book, page, { flip = true, thenPlay = false } = {}) {
  const list = books();
  app.book = Math.max(0, Math.min(book, list.length - 1));
  const b = list[app.book];
  stop();
  app.sim = null;
  const token = ++app.loadToken;
  if (!b) { app.items = []; app.idx = 0; app.page = 1; app.start = newPencil(); renderShell(); redraw(); return; }
  app.page = Math.max(1, Math.min(page, Math.max(1, b.count)));
  if (b.kind === 'agent') {
    if (b.count) {
      let got;
      try { got = await agentPage(b, app.page); } catch { got = { items: [], start: b.pr.pencil }; }
      if (token !== app.loadToken) return;
      app.items = got.items; app.start = got.start; app.startSharpenings = got.start.sharpenings ?? 0;
    } else { app.items = []; app.start = b.pr.pencil; app.startSharpenings = 0; }
  } else {
    const pg = b.nb.pages[app.page - 1];
    app.sim = replayLocal(pg);
    app.items = app.sim.items;
    app.start = pg.ops[0]?.st ? { ...app.local.pencil, ...pg.ops[0].st } : app.local.pencil;
    app.startSharpenings = pg.sharpStart ?? 0;
  }
  app.idx = app.items.length; app.carry = 0;
  if (flip) { const p = $('#pad'); p.classList.remove('flip'); void p.offsetWidth; p.classList.add('flip'); }
  renderShell();
  redraw();
  if (thenPlay) play(true);
}

function renderShell() {
  const list = books(), b = list[app.book];
  // notebook tabs
  // notebook picker: one dropdown, agent-filled notebooks first, then the visitor's own
  const sel = document.createElement('select');
  sel.id = 'bookSelect';
  sel.setAttribute('aria-label', 'Notebook');
  const group = (label, kind) => {
    const opts = list.map((bk, i) => [bk, i]).filter(([bk]) => bk.kind === kind).map(([bk, i]) =>
      Object.assign(document.createElement('option'), { value: i, textContent: `${bk.title} — ${bk.count} page${bk.count === 1 ? '' : 's'}`, selected: i === app.book }));
    if (!opts.length) return;
    const og = Object.assign(document.createElement('optgroup'), { label });
    og.append(...opts);
    sel.append(og);
  };
  group('Filled by agents', 'agent');
  group('Yours', 'local');
  sel.onchange = () => { const i = +sel.value, bk = books()[i]; sel.blur(); show(i, bk.kind === 'agent' ? 1 : bk.count); };
  const label = Object.assign(document.createElement('label'), { textContent: 'Notebook ' });
  label.append(sel);
  $('#books').replaceChildren(...(list.length ? [label] : []),
    Object.assign(document.createElement('button'), { textContent: '+ New notebook', title: 'A blank notebook and a fresh pencil of your own', onclick: addNotebook }));

  const local = b?.kind === 'local', count = b?.count ?? 0;
  $('#sheetWrap').classList.toggle('mine', local);
  $('#tools').hidden = !local;
  $('#gaugeTitle').textContent = local ? 'Your pencil' : 'The pencil';
  $('.talk h2').textContent = local ? 'Your notebook' : 'How the notepad got filled';
  renderAbout(b);
  $('#pageInput').max = Math.max(1, count); $('#pageInput').value = app.page;
  $('#pageCount').textContent = `of ${Math.max(1, count)}${local ? ` (max ${MAX_PAGES})` : ''}`;
  $('#pageno').textContent = count ? app.page : '';
  $('#first').disabled = $('#prev').disabled = app.page <= 1;
  $('#last').disabled = app.page >= count;
  $('#next').disabled = local ? app.page >= MAX_PAGES : app.page >= count;
  $('#next').title = local && app.page >= count ? 'Turn to a new blank page' : 'Next page (→)';
  const blank = $('#blank');
  blank.hidden = !(b?.kind === 'agent' && !count) && !!b;
  blank.textContent = b ? 'This notepad is still blank. Nobody has put pencil to paper yet.' : 'No notebook yet.';
  renderTranscript();
}

function renderAbout(b) {
  const about = $('#about'), legend = $('.talk .legend');
  about.hidden = legend.hidden = b?.kind !== 'agent';
  if (about.hidden) return;
  const pr = b.pr, R = pr.roles, used = PENCIL.length - pr.stopAt;
  legend.innerHTML = `<span class="who w">${escapeHtml(R.writer.name)}</span> ${escapeHtml(R.writer.does)} <span class="who c">${escapeHtml(R.critic.name)}</span> ${escapeHtml(R.critic.does)}`
    + (R.reviewer ? ` <span class="who r">${escapeHtml(R.reviewer.name)}</span> ${escapeHtml(R.reviewer.does)}` : '');
  const prompts = Object.entries(pr.prompts ?? {}).map(([role, text]) =>
    `<details><summary>The prompt given to ${escapeHtml(R[role]?.name ?? role)}</summary><pre>${escapeHtml(text)}</pre></details>`).join('');
  about.innerHTML = `<h2>${escapeHtml(pr.title)}</h2>
    <p>${escapeHtml(pr.about)}</p>
    <p class="facts">Ends when ${used.toFixed(used % 1 ? 2 : 0)} mm of the ${PENCIL.length} mm pencil is used (${Math.round((used / PENCIL.length) * 100)}%).${pr.models ? ` Agents: ${escapeHtml(pr.models)}.` : ''}${pr.started ? ` ${escapeHtml(pr.started)}.` : ''}</p>
    ${prompts}`;
}

function renderTranscript() {
  const b = cur(), ol = $('#transcript'), R = b?.pr?.roles;
  if (!b || b.kind === 'local') {
    ol.innerHTML = `<p class="empty">This notebook is yours. Draw on the page with your mouse or finger: the tip dulls as you go, the pencil shortens when you sharpen it, and the eraser wears away. Nobody is commenting here.</p>`;
    return;
  }
  if (!b.count) { ol.innerHTML = `<p class="empty">Nothing has been said yet.</p>`; return; }
  const pending = app.playing && app.idx < app.items.length;
  ol.replaceChildren(...b.nb.pages.map((p) => {
    const li = document.createElement('li');
    li.className = p.n === app.page ? 'on' : '';
    li.dataset.page = p.n;
    const stats = `${p.stats.strokeM.toFixed(1)} m of line · ${p.stats.used.toFixed(1)} mm of pencil · sharpened ${p.stats.sharpenings}×`;
    li.innerHTML = `<h3>Page ${p.n}<span>${stats}</span></h3>
      <div class="msg w"><span class="who w">${escapeHtml(R.writer.name)}, ${escapeHtml(R.writer.cue)}</span>${escapeHtml(p.writer)}</div>
      ${p.critic ? `<div class="msg c${p.n === app.page && pending ? ' pending' : ''}"><span class="who c">${escapeHtml(R.critic.name)}, ${escapeHtml(R.critic.cue)}</span>${escapeHtml(p.critic)}</div>` : `<div class="msg c pending"><span class="who c">${escapeHtml(R.critic.name)}</span>…</div>`}
      ${!R.reviewer ? '' : p.review ? `<div class="msg r${p.n === app.page && pending ? ' pending' : ''}"><span class="who r">${escapeHtml(R.reviewer.name)}, ${escapeHtml(R.reviewer.cue)}</span>${escapeHtml(p.review)}</div>` : `<div class="msg r pending"><span class="who r">${escapeHtml(R.reviewer.name)}</span>…</div>`}`;
    li.onclick = () => { if (p.n !== app.page) show(app.book, p.n); };
    return li;
  }));
  const lastBook = b.pr.notebooks.at(-1) === b.nb;
  if (lastBook && b.pr.closing) {
    const li = document.createElement('li');
    li.innerHTML = `<h3>Afterword</h3><div class="msg w closing"><span class="who w">${escapeHtml(R.writer.name)}, ${escapeHtml(R.writer.closingCue ?? 'at the end')}</span>${escapeHtml(b.pr.closing)}</div>`;
    ol.append(li);
  } else if (lastBook && !b.pr.done) {
    const li = document.createElement('li');
    li.innerHTML = `<p class="empty">The pencil is still longer than ${b.pr.stopAt} mm, so the agents are still at it. This page updates as they go.</p>`;
    ol.append(li);
  }
  // scroll the side panel itself, never the whole document
  const on = ol.querySelector('li.on'), side = $('.side');
  if (on && side.scrollHeight > side.clientHeight) {
    // the gauge is pinned to the top of the panel, so "visible" means below it
    const pinned = $('.gauge').offsetHeight;
    const top = on.getBoundingClientRect().top - side.getBoundingClientRect().top + side.scrollTop;
    if (top < side.scrollTop + pinned || top + Math.min(on.offsetHeight, 200) > side.scrollTop + side.clientHeight) side.scrollTop = top - pinned - 8;
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------------------------------------------------------------- playback

function play(fromStart = false) {
  if (!app.items.length) return toast('This page is blank — nothing to watch.');
  if (fromStart || app.idx >= app.items.length) { app.idx = 0; app.carry = 0; redraw(); }
  app.playing = true; app.flipAt = 0; app.lastT = performance.now();
  $('#play').textContent = '❚❚ Pause';
  renderTranscript();
  requestAnimationFrame(tick);
}

function stop() {
  if (!app.playing) return;
  app.playing = false; app.flipAt = 0;
  $('#play').textContent = '▶ Watch the pencil';
}

function tick(now) {
  if (!app.playing) return;
  const dt = Math.min(0.1, (now - app.lastT) / 1000);
  app.lastT = now;
  if (app.idx >= app.items.length) {
    // page finished: let the critic speak, then turn the page
    if (!app.flipAt) { app.flipAt = now + 1400; renderTranscript(); paintChrome(); }
    if (now >= app.flipAt) {
      const b = cur();
      if ($('#autoflip').checked && b && app.page < b.count) { show(app.book, app.page + 1, { thenPlay: true }); return; }
      stop(); paintChrome(); return;
    }
  } else if (now >= app.sharpenUntil) {
    app.carry += dt * app.speed * SPEED_BASE;
    while (app.idx < app.items.length) {
      const it = app.items[app.idx];
      if (it.t === 'x') { app.idx++; app.carry = 0; app.sharpenUntil = now + Math.max(260, 1100 / Math.sqrt(app.speed)); break; }
      if (app.carry < it.l) break;
      app.carry -= it.l;
      drawItem(sctx, it);
      app.idx++;
    }
  }
  paintChrome();
  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------- your own notebooks

function addNotebook() {
  const n = (app.local.counter = (app.local.counter ?? 0) + 1);
  app.local.notebooks.push({ id: `mine${n}`, title: `My notebook ${n}`, pages: [{ ops: [], sharpStart: app.local.pencil.sharpenings }] });
  saveLocal();
  show(books().length - 1, 1);
}

function localPage() { const b = cur(); return b?.kind === 'local' ? b.nb.pages[app.page - 1] : null; }
const snapOf = (s) => ({ length: s.length, worn: s.worn, eraser: s.eraser });

function commitLocal() {
  Object.assign(app.local.pencil, app.sim.s);
  saveLocal();
  app.idx = app.items.length;
  paintChrome();
}

function toMm(e) {
  const r = sheet.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * PAGE.w, ((e.clientY - r.top) / r.height) * PAGE.h];
}

sheet.addEventListener('pointerdown', (e) => {
  const pg = localPage();
  if (!pg || app.playing || !app.sim) return;
  if (app.sim.stopped) return toast('This pencil is down to a stub. Start a new notebook for… no, it is the same pencil. It is done.');
  if (app.tool === 'eraser' && app.sim.s.eraser <= 0) return toast('The eraser is worn down to the ferrule.');
  sheet.setPointerCapture(e.pointerId);
  const p = toMm(e);
  app.drawing = { k: app.tool === 'eraser' ? 'e' : 's', p: [...p], pr: app.pressure, st: snapOf(app.sim.s), last: p };
});
sheet.addEventListener('pointermove', (e) => {
  const d = app.drawing;
  if (!d) return;
  const p = toMm(e);
  if (Math.hypot(p[0] - d.last[0], p[1] - d.last[1]) < 0.35) return;
  const from = app.sim.items.length, seg = [d.last, p];
  if (d.k === 's') app.sim.stroke(seg, d.pr); else app.sim.erase(seg);
  for (let i = from; i < app.sim.items.length; i++) drawItem(sctx, app.sim.items[i]);
  d.p.push(p[0], p[1]); d.last = p;
  app.idx = app.items.length;
  paintChrome();
});
const endStroke = () => {
  const d = app.drawing;
  if (!d) return;
  app.drawing = null;
  if (d.p.length >= 4) localPage().ops.push({ k: d.k, p: d.p.map((v) => Math.round(v * 100) / 100), pr: d.pr, st: d.st });
  commitLocal();
};
sheet.addEventListener('pointerup', endStroke);
sheet.addEventListener('pointercancel', endStroke);

$('#sharpen').onclick = () => {
  const pg = localPage();
  if (!pg || !app.sim) return;
  const st = snapOf(app.sim.s);
  if (!app.sim.sharpen(false)) return toast(app.sim.stopped ? 'Nothing left to sharpen.' : 'Already sharp — the sharpener just spins.');
  pg.ops.push({ k: 'x', st });
  app.local.pencil.sharpenings = app.sim.s.sharpenings;
  commitLocal();
  app.sharpenUntil = performance.now() + 500;
  toast(`Sharpened. ${app.sim.s.length.toFixed(1)} mm of pencil left.`);
};
document.querySelectorAll('[data-tool]').forEach((btn) => {
  btn.onclick = () => {
    app.tool = btn.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b === btn));
  };
});
$('#pressure').oninput = (e) => { app.pressure = +e.target.value; };
$('#deleteBook').onclick = () => {
  const b = cur();
  if (b?.kind !== 'local' || !confirm(`Delete "${b.title}"? The pencil stays as worn as it is.`)) return;
  app.local.notebooks.splice(app.local.notebooks.indexOf(b.nb), 1);
  saveLocal();
  show(0, 1);
};

// ---------------------------------------------------------------- controls

function go(delta) {
  const b = cur();
  if (!b) return;
  const target = app.page + delta;
  if (b.kind === 'local' && target > b.count && target <= MAX_PAGES) {
    b.nb.pages.push({ ops: [], sharpStart: app.local.pencil.sharpenings });
    saveLocal();
  }
  show(app.book, target);
}
$('#prev').onclick = () => go(-1);
$('#next').onclick = () => go(1);
$('#first').onclick = () => show(app.book, 1);
$('#last').onclick = () => show(app.book, cur()?.count ?? 1);
$('#pageInput').onchange = (e) => show(app.book, +e.target.value || 1);
$('#play').onclick = () => (app.playing ? (stop(), renderTranscript(), paintChrome()) : play());
$('#speed').onchange = (e) => { app.speed = +e.target.value; };
addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea')) return;
  if (e.key === 'ArrowLeft') go(-1);
  else if (e.key === 'ArrowRight') go(1);
  else if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
});
addEventListener('resize', layout);

// While the agents are still working, pick up new pages and comments as they land.
setInterval(async () => {
  if (app.projects.length && app.projects.every(finished)) return;
  const id = cur()?.key;
  if (!(await fetchProjects())) return;
  // a notebook appearing shifts the tab order: stay on the same notebook
  const at = books().findIndex((b) => b.key === id);
  if (at >= 0) app.book = at;
  if (!cur() || (cur().kind === 'agent' && !app.playing && !app.items.length)) show(app.book, 1); else renderShell();
}, 6000);

await fetchProjects();
layout();
// ?book=half-a-pencil picks a notebook, ?page=7 a page; ?play starts the pencil straight away
const params = new URLSearchParams(location.search);
const wanted = Math.max(0, books().findIndex((b) => b.pr?.id === params.get('book')));
show(wanted, +params.get('page') || 1, { flip: false, thenPlay: params.has('play') });
