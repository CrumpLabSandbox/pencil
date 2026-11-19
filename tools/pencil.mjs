#!/usr/bin/env node
// The notepad's back office: the writer and critic agents fill the notepad through this CLI.
//   node tools/pencil.mjs status
//   node tools/pencil.mjs preview <draft.json>      dry run, renders renders/preview.png
//   node tools/pencil.mjs commit <draft.json>       writer: put the page in the notepad
//   node tools/pencil.mjs comment <comment.txt>     critic: respond to the latest page
//   node tools/pencil.mjs closing <closing.txt>     writer: last words once the pencil is half gone
//   node tools/pencil.mjs wait <writer|critic>      block until it is that role's turn
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGE, PENCIL, newPencil, runPage, tipWidth, sharpness } from '../js/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data'), RENDERS = path.join(ROOT, 'renders');
const MANIFEST = path.join(DATA, 'manifest.json');
const PAGES_PER_NOTEBOOK = 100;
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const pad = (n) => String(n).padStart(3, '0');
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2);
const die = (msg) => { console.error(`ERROR: ${msg}`); process.exit(1); };

function load() {
  if (!fs.existsSync(MANIFEST)) return { title: 'Half a Pencil', pencil: newPencil(), done: false, closing: null, notebooks: [{ id: 'nb1', title: 'Notebook 1', pages: [] }] };
  return JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
}
function save(m) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(`${MANIFEST}.tmp`, JSON.stringify(m, null, 1));
  fs.renameSync(`${MANIFEST}.tmp`, MANIFEST);
}
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
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { die(`could not read draft: ${e.message}`); }
  if (typeof d.says !== 'string' || !d.says.trim()) die('draft needs "says": what you intend to write or draw, in your own words');
  if (!Array.isArray(d.ops) || !d.ops.length) die('draft needs a non-empty "ops" array');
  return d;
}

function report(sim, warnings, before) {
  const s = sim.s, st = sim.stats;
  const lines = [
    `strokes drawn:    ${f2(st.strokeMm / 1000)} m`,
    `graphite laid:    ${f2(st.graphite)} mm3  (page tooth ${f1(sim.coverage() * 100)}% full)`,
    `pencil length:    ${f2(before.length)} -> ${f2(s.length)} mm  (this page used ${f2(before.length - s.length)} mm)`,
    `sharpenings:      ${st.sharpenings} this page (${st.autoSharpenings} forced by a tip worn to the wood), ${s.sharpenings} total`,
    `tip now:          ${f2(tipWidth(s))} mm wide (${Math.round(sharpness(s) * 100)}% sharp)`,
    `eraser:           ${f2(s.eraser)} mm left (rubbed ${st.erasedMm2} mm2 this page)`,
    `to the halfway mark: ${f2(Math.max(0, s.length - PENCIL.half))} mm of pencil still to use (started at ${PENCIL.length}, stops at ${PENCIL.half})`
  ];
  if (sim.stopped) lines.push('*** THE PENCIL REACHED ITS HALFWAY MARK ON THIS PAGE. It stopped mid-stroke; anything after that was not drawn. ***');
  for (const w of warnings) lines.push(`warning: ${w}`);
  return lines.join('\n');
}

function status(m, role) {
  const t = turn(m), last = lastPage(m), s = m.pencil;
  const out = [
    `turn: ${t}`,
    `pages filled: ${allPages(m).length} (notebook ${m.notebooks.length}, ${PAGES_PER_NOTEBOOK} pages per notebook)`,
    `pencil: ${f2(s.length)} mm long; ${f2(Math.max(0, s.length - PENCIL.half))} mm left to use before the halfway mark; tip ${f2(tipWidth(s))} mm (${Math.round(sharpness(s) * 100)}% sharp); eraser ${f2(s.eraser)} mm; ${s.sharpenings} sharpenings so far`
  ];
  if (last) {
    const { nb, p } = last;
    out.push(`latest page: ${nb.id} page ${p.n} -> image ${path.join(RENDERS, `${nb.id}-${pad(p.n)}.png`)}`);
    out.push(`latest page stats: ${f2(p.stats.strokeM)} m of strokes, ${f2(p.stats.graphite)} mm3 graphite, ${f2(p.stats.used)} mm of pencil, ${p.stats.sharpenings} sharpenings, tooth ${f1(p.stats.coverage * 100)}% full`);
    if (role !== 'writer') out.push(`writer said (before page ${p.n}): ${p.writer}`);
    if (p.critic && role !== 'critic') out.push(`critic said (after page ${p.n}): ${p.critic}`);
  }
  if (t === 'closing') out.push('The pencil is half gone and the critic has had the last look. Writer: give your closing words with `closing <file>`.');
  if (t === 'done') out.push('FINISHED: the notepad is closed.');
  return out.join('\n');
}

const [cmd, arg] = process.argv.slice(2);
const m = load();

if (cmd === 'status') {
  console.log(status(m));
} else if (cmd === 'preview') {
  const d = readDraft(arg);
  const { sim, warnings } = runPage(d.ops, m.pencil, allPages(m).length + 1);
  console.log(`PREVIEW ONLY (nothing committed)\n${report(sim, warnings, m.pencil)}\nimage: ${render(sim, 'preview')}`);
} else if (cmd === 'commit') {
  if (turn(m) !== 'writer') die(`not the writer's turn (turn: ${turn(m)})`);
  const d = readDraft(arg);
  let nb = m.notebooks.at(-1);
  if (nb.pages.length >= PAGES_PER_NOTEBOOK) {
    nb = { id: `nb${m.notebooks.length + 1}`, title: `Notebook ${m.notebooks.length + 1}`, pages: [] };
    m.notebooks.push(nb);
  }
  const n = nb.pages.length + 1, seed = allPages(m).length + 1, before = { ...m.pencil };
  const { sim, warnings } = runPage(d.ops, before, seed);
  const st = sim.stats;
  const stats = { strokeM: st.strokeMm / 1000, graphite: st.graphite, used: before.length - sim.s.length, sharpenings: st.sharpenings, erasedMm2: st.erasedMm2, coverage: sim.coverage(), stopped: sim.stopped };
  fs.mkdirSync(path.join(DATA, nb.id), { recursive: true });
  fs.writeFileSync(path.join(DATA, nb.id, `${pad(n)}.json`), JSON.stringify({ notebook: nb.id, page: n, seed, says: d.says.trim(), before, after: sim.s, stats, warnings, ops: d.ops }));
  nb.pages.push({ n, writer: d.says.trim(), critic: null, stats, before: before.length, after: sim.s.length });
  m.pencil = sim.s;
  m.done = sim.stopped;
  save(m);
  console.log(`COMMITTED ${nb.id} page ${n}\n${report(sim, warnings, before)}\nimage: ${render(sim, `${nb.id}-${pad(n)}`)}`);
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
    const cur = load();
    if (mine(turn(cur))) { console.log(status(cur, arg)); break; }
    if (Date.now() > deadline) { console.log('STILL_WAITING: run the same wait command again.'); break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
} else {
  die('usage: pencil.mjs status | preview <draft.json> | commit <draft.json> | comment <file> | closing <file> | wait <writer|critic>');
}
