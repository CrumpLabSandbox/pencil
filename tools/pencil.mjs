#!/usr/bin/env node
// The notepads' back office: agents fill a notebook through this CLI, two roles taking turns.
// The "writer" role holds the pencil; the "critic" role responds to each page.
//   node tools/pencil.mjs init <config.json>                     start a new notebook project
//   node tools/pencil.mjs --book <id> status
//   node tools/pencil.mjs --book <id> preview <draft.json>      dry run, renders renders/<id>-preview.png
//   node tools/pencil.mjs --book <id> commit <draft.json>       writer: put the page in the notepad
//   node tools/pencil.mjs --book <id> comment <comment.txt>     critic: respond to the latest page
//   node tools/pencil.mjs --book <id> closing <closing.txt>     writer: last words once the pencil hits its mark
//   node tools/pencil.mjs --book <id> wait <writer|critic>      block until it is that role's turn
// --book may be left out while there is only one project (or set PENCIL_BOOK).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGE, PENCIL, newPencil, runPage, tipWidth, sharpness } from '../js/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data'), RENDERS = path.join(ROOT, 'renders');
const INDEX = path.join(DATA, 'index.json');
const PAGES_PER_NOTEBOOK = 100;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEFAULT_ROLES = {
  writer: { name: 'Writer', cue: 'before the page', does: 'says what it will put on the page, then does it.' },
  critic: { name: 'Critic', cue: 'after looking at it', does: 'looks at the page and responds.' }
};

const pad = (n) => String(n).padStart(3, '0');
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1));
  fs.renameSync(`${file}.tmp`, file);
}

const argv = process.argv.slice(2);
let bookId = process.env.PENCIL_BOOK;
const flag = argv.indexOf('--book');
if (flag >= 0) [, bookId] = argv.splice(flag, 2);
const [cmd, arg] = argv;

const index = fs.existsSync(INDEX) ? readJson(INDEX) : { books: [] };
const manifestPath = (id) => path.join(DATA, id, 'manifest.json');
const load = (id) => readJson(manifestPath(id));
const save = (m) => writeJson(manifestPath(m.id), m);

const allPages = (m) => m.notebooks.flatMap((nb) => nb.pages.map((p) => ({ nb, p })));
const lastPage = (m) => allPages(m).at(-1);
function turn(m) {
  const last = lastPage(m);
  if (last && !last.p.critic) return 'critic';
  if (!m.done) return 'writer';
  return m.closing ? 'done' : 'closing';
}

function svgOf(sim) {
  const S = 5, parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE.w * S}" height="${PAGE.h * S}" viewBox="0 0 ${PAGE.w} ${PAGE.h}">`);
  parts.push(`<rect width="${PAGE.w}" height="${PAGE.h}" fill="#fbf8ee"/>`);
  for (let y = PAGE.firstRule; y < PAGE.h - 4; y += PAGE.rule) parts.push(`<line x1="0" x2="${PAGE.w}" y1="${y}" y2="${y}" stroke="#9db7d6" stroke-width="0.15"/>`);
  parts.push('<g fill="none" stroke-linejoin="round">');
  for (const it of sim.items) {
    if (it.t === 'x') continue;
    const pts = [];
    for (let i = 0; i < it.p.length; i += 2) pts.push(`${it.p[i]},${it.p[i + 1]}`);
    parts.push(it.t === 's'
      ? `<polyline points="${pts.join(' ')}" stroke="#25252b" stroke-opacity="${it.a}" stroke-width="${it.w}"/>`
      : `<polyline points="${pts.join(' ')}" stroke="#fbf8ee" stroke-opacity="0.88" stroke-width="${it.w}" stroke-linecap="round"/>`);
  }
  parts.push('</g></svg>');
  return parts.join('\n');
}

function render(sim, name) {
  fs.mkdirSync(RENDERS, { recursive: true });
  const html = path.join(RENDERS, `${name}.html`), png = path.join(RENDERS, `${name}.png`);
  fs.writeFileSync(html, `<!doctype html><body style="margin:0;background:#fbf8ee">${svgOf(sim)}</body>`);
  try {
    execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${PAGE.w * 5},${PAGE.h * 5}`, `--screenshot=${png}`, `file://${html}`], { stdio: 'ignore', timeout: 90000 });
    fs.rmSync(html);
    return png;
  } catch {
    return `${html} (PNG render failed; open the HTML instead)`;
  }
}

function readDraft(file) {
  if (!file) die('give a draft JSON file: {"says": "...", "ops": [...]}');
  let d;
  try { d = readJson(file); } catch (e) { die(`could not read draft: ${e.message}`); }
  if (typeof d.says !== 'string' || !d.says.trim()) die('draft needs "says": your words for this turn');
  if (!Array.isArray(d.ops) || !d.ops.length) die('draft needs a non-empty "ops" array');
  return d;
}

function report(m, sim, warnings, before) {
  const s = sim.s, st = sim.stats;
  const lines = [
    `strokes drawn:    ${f2(st.strokeMm / 1000)} m`,
    `graphite laid:    ${f2(st.graphite)} mm3  (page tooth ${f1(sim.coverage() * 100)}% full)`,
    `pencil length:    ${f2(before.length)} -> ${f2(s.length)} mm  (this page used ${f2(before.length - s.length)} mm)`,
    `sharpenings:      ${st.sharpenings} this page (${st.autoSharpenings} forced by a tip worn to the wood), ${s.sharpenings} total`,
    `tip now:          ${f2(tipWidth(s))} mm wide (${Math.round(sharpness(s) * 100)}% sharp)`,
    `eraser:           ${f2(s.eraser)} mm left (rubbed ${st.erasedMm2} mm2 this page)`,
    `to the stop mark: ${f2(Math.max(0, s.length - m.stopAt))} mm of pencil still to use (started at ${PENCIL.length}, stops at ${m.stopAt})`
  ];
  if (sim.stopped) lines.push('*** THE PENCIL REACHED ITS STOP MARK ON THIS PAGE. It stopped mid-stroke; anything after that was not drawn. ***');
  for (const w of warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}

function status(m, role) {
  const t = turn(m), last = lastPage(m), s = m.pencil, R = m.roles;
  const blind = role === 'critic' && m.hearOnly; // the second role only hears the first; it never sees the page
  const out = [
    `turn: ${t}`,
    `pages filled: ${allPages(m).length} (notebook ${m.notebooks.length}, ${PAGES_PER_NOTEBOOK} pages per notebook)`
  ];
  if (!blind) out.push(`pencil: ${f2(s.length)} mm long; ${f2(Math.max(0, s.length - m.stopAt))} mm left to use before the stop mark; tip ${f2(tipWidth(s))} mm (${Math.round(sharpness(s) * 100)}% sharp); eraser ${f2(s.eraser)} mm; ${s.sharpenings} sharpenings so far`);
  if (last) {
    const { nb, p } = last;
    if (!blind) {
      out.push(`latest page: ${nb.id} page ${p.n} -> image ${path.join(RENDERS, `${m.id}-${nb.id}-${pad(p.n)}.png`)}`);
      out.push(`latest page stats: ${f2(p.stats.strokeM)} m of strokes, ${f2(p.stats.graphite)} mm3 graphite, ${f2(p.stats.used)} mm of pencil, ${p.stats.sharpenings} sharpenings, tooth ${f1(p.stats.coverage * 100)}% full`);
    }
    if (role !== 'writer') out.push(`${R.writer.name} said (page ${p.n}): ${p.writer}`);
    if (p.critic && role !== 'critic') out.push(`${R.critic.name} said (after page ${p.n}): ${p.critic}`);
  }
  if (t === 'closing') out.push(`The pencil has reached its stop mark and ${R.critic.name} has had the last reply. ${R.writer.name}: give your closing words with \`closing <file>\`.`);
  if (t === 'done') out.push('FINISHED: the notepad is closed.');
  return out.join('\n');
}

if (cmd === 'init') {
  let c;
  try { c = readJson(arg); } catch (e) { die(`could not read config: ${e.message}`); }
  if (!/^[a-z0-9-]+$/.test(c.id ?? '')) die('config needs an "id" of lowercase letters, digits and dashes');
  if (!c.title) die('config needs a "title"');
  if (fs.existsSync(manifestPath(c.id))) die(`project ${c.id} already exists`);
  const stopAt = c.stopAt ?? PENCIL.half;
  if (!(stopAt >= 30 && stopAt < PENCIL.length)) die('stopAt must be between 30 and 175 (mm of pencil left when the project ends)');
  save({
    id: c.id, title: c.title, about: c.about ?? '', stopAt, hearOnly: !!c.hearOnly, models: c.models ?? '', started: c.started ?? new Date().toISOString().slice(0, 10),
    roles: { writer: { ...DEFAULT_ROLES.writer, ...c.roles?.writer }, critic: { ...DEFAULT_ROLES.critic, ...c.roles?.critic } },
    prompts: c.prompts ?? {},
    pencil: newPencil(), done: false, closing: null,
    notebooks: [{ id: 'nb1', title: 'Notebook 1', pages: [] }]
  });
  index.books.push({ id: c.id });
  writeJson(INDEX, index);
  console.log(`created project ${c.id}: the pencil stops at ${stopAt} mm. Use --book ${c.id}`);
  process.exit(0);
}

if (!bookId && index.books.length === 1) bookId = index.books[0].id;
if (!bookId || !fs.existsSync(manifestPath(bookId))) die(`which notebook project? use --book <id>. Known: ${index.books.map((b) => b.id).join(', ') || '(none — run init first)'}`);
const m = load(bookId);

if (cmd === 'status') {
  console.log(status(m));
} else if (cmd === 'preview') {
  const d = readDraft(arg);
  const { sim, warnings } = runPage(d.ops, m.pencil, allPages(m).length + 1, { stopAt: m.stopAt });
  console.log(`PREVIEW ONLY (nothing committed)\n${report(m, sim, warnings, m.pencil)}\nimage: ${render(sim, `${m.id}-preview`)}`);
} else if (cmd === 'commit') {
  if (turn(m) !== 'writer') die(`not ${m.roles.writer.name}'s turn (turn: ${turn(m)})`);
  const d = readDraft(arg);
  let nb = m.notebooks.at(-1);
  if (nb.pages.length >= PAGES_PER_NOTEBOOK) {
    nb = { id: `nb${m.notebooks.length + 1}`, title: `Notebook ${m.notebooks.length + 1}`, pages: [] };
    m.notebooks.push(nb);
  }
  const n = nb.pages.length + 1, seed = allPages(m).length + 1, before = { ...m.pencil };
  const { sim, warnings } = runPage(d.ops, before, seed, { stopAt: m.stopAt });
  const st = sim.stats;
  const stats = { strokeM: st.strokeMm / 1000, graphite: st.graphite, used: before.length - sim.s.length, sharpenings: st.sharpenings, erasedMm2: st.erasedMm2, coverage: sim.coverage(), stopped: sim.stopped };
  fs.mkdirSync(path.join(DATA, m.id, nb.id), { recursive: true });
  fs.writeFileSync(path.join(DATA, m.id, nb.id, `${pad(n)}.json`), JSON.stringify({ notebook: nb.id, page: n, seed, says: d.says.trim(), before, after: sim.s, stats, warnings, ops: d.ops }));
  nb.pages.push({ n, writer: d.says.trim(), critic: null, stats, before: before.length, after: sim.s.length });
  m.pencil = sim.s;
  m.done = sim.stopped;
  save(m);
  console.log(`COMMITTED ${nb.id} page ${n}\n${report(m, sim, warnings, before)}\nimage: ${render(sim, `${m.id}-${nb.id}-${pad(n)}`)}`);
} else if (cmd === 'comment' || cmd === 'closing') {
  if (turn(m) !== (cmd === 'comment' ? 'critic' : 'closing')) die(`not time for that (turn: ${turn(m)})`);
  if (!arg || !fs.existsSync(arg)) die('give a text file containing your words');
  const text = fs.readFileSync(arg, 'utf8').trim();
  if (!text) die('the file is empty');
  if (cmd === 'comment') lastPage(m).p.critic = text; else m.closing = text;
  save(m);
  console.log(`recorded. turn is now: ${turn(m)}`);
} else if (cmd === 'wait') {
  if (arg !== 'writer' && arg !== 'critic') die('wait <writer|critic>');
  const mine = (t) => (arg === 'writer' ? t !== 'critic' : t !== 'writer');
  const deadline = Date.now() + 9 * 60 * 1000;
  for (;;) {
    const cur = load(bookId);
    if (mine(turn(cur))) { console.log(status(cur, arg)); break; }
    if (Date.now() > deadline) { console.log('STILL_WAITING: run the same wait command again.'); break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  die('usage: pencil.mjs [--book <id>] status | preview <draft.json> | commit <draft.json> | comment <file> | closing <file> | wait <writer|critic>   (or: init <config.json>)');
}
