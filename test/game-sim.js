// Headless fairness/physics simulation for the mini-game embedded in
// live/matrix-runner.html (the only theme that ships a game).
//
// It extracts the actual game-logic section straight out of the theme file
// (no reimplementation, so it can never drift from what ships), stubs out
// the DOM/canvas/rAF, and runs it for a simulated ~25 minutes against a bot
// that jumps using time-to-contact (how a human actually reacts, not
// "distance < magic number"). It reports whether any death was effectively
// unavoidable.
//
// Usage: node test/game-sim.js
//
// Run this after touching anything under the "AGENT RUNNER" section of
// the theme file (agent/bullet spawn logic, speeds, hitboxes) BEFORE deploying.
// It has caught real bugs during development:
//   - frame-rate-coupled speed (2x on 120Hz phones vs 60Hz monitors)
//   - a shooter agent stacking with a fast-follower agent (unavoidable death)
//   - a shooter that never actually got picked because its spawn condition
//     was never true in practice

const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'live', 'matrix-runner.html'), 'utf8');

const START_MARK = '// === AGENT RUNNER';
const END_MARK = '// === TYPING CONSOLE';
const start = html.indexOf(START_MARK);
const end = html.indexOf(END_MARK);
if (start < 0 || end < 0) {
  console.error('Could not locate the game-logic section in live/matrix-runner.html (markers moved?).');
  process.exit(1);
}
let chunk = html.slice(start, end);

// --- minimal stubs so the extracted browser code can run under plain Node ---
const noop = () => {};
const ctxStub = new Proxy({}, {
  get: (_, k) => (k === 'createLinearGradient' ? () => ({ addColorStop: noop }) : noop),
  set: () => true,
});
const elStub = { textContent: 0, style: {}, setAttribute: noop, getContext: () => ctxStub, addEventListener: noop };
global.document = { getElementById: () => elStub, querySelectorAll: () => [], documentElement: { lang: 'en' } };
global.addEventListener = noop;
global.requestAnimationFrame = noop; // we drive update() manually, frame by frame
global.STR = { score: 'SCORE:', best: 'BEST:', dead: 'caught', shot: 'shot' };
global.CH = 'X';

chunk += '\n;globalThis.__sim = { update: () => update(), jump: () => jump(), ' +
  'state: () => ({ obs, bullets, score, dead, p, deathBy }) };';
eval(chunk);
const sim = globalThis.__sim;

// --- bot: jumps based on time-to-contact, i.e. "when would this hit me if I
//     don't move", which is close to how a person actually times a jump ---
function botStep() {
  const st = sim.state();
  if (st.dead) { sim.jump(); return; } // restart
  if (st.p.y < 99.5) return; // already airborne, nothing to decide
  const speed = 3.3 + Math.min(2.4, st.score / 28);
  let shouldJump = false;
  for (const o of st.obs) {
    const closureSpeed = speed * (o.slow ? 0.45 : 1);
    const gap = o.x - (st.p.x + st.p.w);
    if (o.x + 20 > st.p.x && gap > 0 && gap / closureSpeed <= 12) shouldJump = true;
  }
  for (const b of st.bullets) {
    const closureSpeed = speed + 2.3;
    const gap = b.x - (st.p.x + st.p.w);
    if (b.x > st.p.x && gap > 0 && gap / closureSpeed <= 10) shouldJump = true;
  }
  if (shouldJump) sim.jump();
}

const FRAMES = 90000; // 90000 / 60fps ≈ 25 minutes of play
let shooterCount = 0, shotsFired = 0, deaths = {}, scores = [], maxScore = 0;
let seenShooters = new Set(), prevBulletCount = 0, minGapAfterDodge = Infinity;

for (let f = 0; f < FRAMES; f++) {
  const before = sim.state();
  const scoreBeforeDeath = before.score;
  botStep();
  sim.update();
  const st = sim.state();

  for (const o of st.obs) {
    if (o.shooter && !seenShooters.has(o)) { seenShooters.add(o); shooterCount++; }
  }
  if (st.bullets.length > prevBulletCount) shotsFired += st.bullets.length - prevBulletCount;
  if (prevBulletCount > 0 && st.bullets.length < prevBulletCount && !st.dead) {
    let nearest = Infinity;
    for (const o of st.obs) { const d = o.x - st.p.x; if (d > 0 && d < nearest) nearest = d; }
    if (nearest < minGapAfterDodge) minGapAfterDodge = nearest;
  }
  prevBulletCount = st.bullets.length;
  if (st.score > maxScore) maxScore = st.score;
  if (st.dead && !before.dead) {
    scores.push(scoreBeforeDeath);
    deaths[st.deathBy] = (deaths[st.deathBy] || 0) + 1;
  }
}

const avgScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 'n/a';
console.log('frames simulated:', FRAMES, `(~${Math.round(FRAMES / 60 / 60)} min)`);
console.log('shooter agents spawned:', shooterCount, '| bullets fired:', shotsFired);
console.log('deaths:', scores.length, JSON.stringify(deaths), '| avg score:', avgScore, '| best run:', maxScore);
console.log('closest agent right after dodging a bullet (min):',
  minGapAfterDodge === Infinity ? 'n/a (no data)' : Math.round(minGapAfterDodge) + 'px',
  '— a very small number here means bullet+agent combos are effectively undodgeable');
