// Wraps a theme HTML file into a deployable Cloudflare Worker (ES module).
//
// Usage:
//   node build-worker.js                       builds live/matrix-runner.html (the deployed default)
//   node build-worker.js designs/minimal.html   builds any other theme from the gallery instead
//
// The worker passes every request straight to your origin. Only when the
// origin responds with one of the listed failure codes (or doesn't respond
// at all) does it serve the embedded HTML instead.

const fs = require('fs');
const path = require('path');

const DEFAULT_THEME = path.join(__dirname, 'live', 'matrix-runner.html');
const SOURCE = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_THEME;
const OUTPUT = path.join(__dirname, 'worker.js');

// Add/remove status codes here to change which upstream failures trigger
// the maintenance page. 502/521/522/523/530 are Cloudflare's standard
// "origin unreachable" family; a thrown fetch (network-level failure,
// e.g. the origin is completely down) is always caught too.
const TRIGGER_STATUSES = [502, 521, 522, 523, 530];

if (!fs.existsSync(SOURCE)) {
  console.error('Theme file not found:', SOURCE);
  console.error('Pick one from designs/, or add your own single-file HTML page.');
  process.exit(1);
}

const html = fs.readFileSync(SOURCE, 'utf8');

const worker = [
  'const HTML = ' + JSON.stringify(html) + ';',
  '',
  'const TRIGGER_STATUSES = ' + JSON.stringify(TRIGGER_STATUSES) + ';',
  '',
  'export default {',
  '  async fetch(request, env, ctx) {',
  '    try {',
  '      const response = await fetch(request);',
  '      if (TRIGGER_STATUSES.includes(response.status)) {',
  '        return maintenancePage();',
  '      }',
  '      return response;',
  '    } catch (err) {',
  '      return maintenancePage();',
  '    }',
  '  }',
  '};',
  '',
  'function maintenancePage() {',
  '  return new Response(HTML, {',
  '    status: 503,',
  '    headers: {',
  '      "Content-Type": "text/html;charset=UTF-8",',
  '      "Retry-After": "120",',
  '      "Cache-Control": "no-store"',
  '    }',
  '  });',
  '}',
].join('\n');

fs.writeFileSync(OUTPUT, worker);
console.log('worker.js written:', worker.length, 'bytes  (theme:', path.relative(__dirname, SOURCE), ')');
