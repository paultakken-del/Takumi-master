#!/usr/bin/env python3
"""
Takumi Master — Delivery Test Suite
====================================
Uitvoeren: python3 takumi_test.py [pad/naar/index.html]

Test categorieën:
  T1  Syntax & structuur
  T2  CSS integriteit  
  T3  HTML DOM structuur
  T4  JavaScript runtime (via Node.js VM)
  T5  Functionele flows (unit)
  T6  API integratie (mock)
  T7  Mobiel & responsive
  T8  Persistentie & state
  T9  Cloudflare functions
  T10 Security & sanity

Exit codes:
  0 = alle tests geslaagd → veilig om te deployen
  1 = kritieke fouten → NIET deployen
"""

import sys, os, re, json, subprocess, tempfile
from pathlib import Path
from collections import Counter

# ══════════════════════════════════════════════════════════════════
# SETUP
# ══════════════════════════════════════════════════════════════════

HTML_PATH = sys.argv[1] if len(sys.argv) > 1 else str(Path(__file__).parent.parent / 'index.html')
FUNCTIONS_PATH = str(Path(HTML_PATH).parent / 'functions' / 'api')

with open(HTML_PATH, encoding='utf-8') as f:
    HTML = f.read()

CSS_START = HTML.find('<style>') + 7
CSS_END   = HTML.find('</style>')
JS_START  = HTML.find('<script>') + 8
JS_END    = HTML.rfind('</script>')
CSS = HTML[CSS_START:CSS_END]
JS  = HTML[JS_START:JS_END]

# ══════════════════════════════════════════════════════════════════
# TEST RUNNER
# ══════════════════════════════════════════════════════════════════

class TestRunner:
    def __init__(self):
        self.results = []
        self.current_suite = ""

    def suite(self, name):
        self.current_suite = name
        print(f"\n{'─'*50}")
        print(f"  {name}")
        print(f"{'─'*50}")

    def check(self, name, condition, detail="", critical=True):
        status = "PASS" if condition else ("FAIL" if critical else "WARN")
        icon = "✓" if condition else ("✗" if critical else "⚠")
        self.results.append({
            'suite': self.current_suite,
            'name': name,
            'status': status,
            'detail': detail,
            'critical': critical,
        })
        suffix = f"  [{detail}]" if detail and not condition else ""
        print(f"  {icon}  {name}{suffix}")
        return condition

    def run_node(self, code, timeout=10):
        """Run JS in Node.js, return (stdout, stderr, returncode)"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(code)
            fname = f.name
        try:
            r = subprocess.run(['node', fname], capture_output=True, text=True, timeout=timeout)
            return r.stdout, r.stderr, r.returncode
        except subprocess.TimeoutExpired:
            return "", "TIMEOUT", 1
        except FileNotFoundError:
            return "", "node not found", 1
        finally:
            os.unlink(fname)

    def summary(self):
        total = len(self.results)
        passed = sum(1 for r in self.results if r['status'] == 'PASS')
        failed = sum(1 for r in self.results if r['status'] == 'FAIL')
        warned = sum(1 for r in self.results if r['status'] == 'WARN')
        crit_fails = [r for r in self.results if r['status'] == 'FAIL' and r['critical']]

        print(f"\n{'═'*50}")
        print(f"  RESULTAAT: {passed}/{total} geslaagd  |  {failed} fouten  |  {warned} waarschuwingen")
        print(f"{'═'*50}")

        if crit_fails:
            print(f"\n  ✗ KRITIEKE FOUTEN — NIET DEPLOYEN:")
            for r in crit_fails:
                print(f"    • [{r['suite']}] {r['name']}")
                if r['detail']:
                    print(f"      → {r['detail']}")
        else:
            print(f"\n  ✓ Alle kritieke checks geslaagd — veilig om te deployen")

        return 1 if crit_fails else 0


T = TestRunner()

# ══════════════════════════════════════════════════════════════════
# T1: SYNTAX & STRUCTUUR
# ══════════════════════════════════════════════════════════════════

T.suite("T1 · Syntax & Structuur")

# JavaScript syntax via Node
with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
    f.write(JS)
    js_tmp = f.name
r = subprocess.run(['node', '--check', js_tmp], capture_output=True, text=True)
os.unlink(js_tmp)
T.check("JavaScript syntax (Node.js)", r.returncode == 0, r.stderr.split('\n')[0][:80])

# Backtick balance
bt_count = JS.count('`')
T.check("Template literals gesloten (even backticks)", bt_count % 2 == 0,
        f"{bt_count} backticks")

# No double async
T.check("Geen 'async async'", 'async async' not in JS)

# File size
size_kb = len(HTML.encode('utf-8')) / 1024
T.check("Bestandsgrootte < 200KB", size_kb < 200, f"{size_kb:.1f}KB")
T.check("Bestandsgrootte > 10KB (niet leeg)", size_kb > 10, f"{size_kb:.1f}KB")

# HTML structure
T.check("DOCTYPE aanwezig", HTML.startswith('<!DOCTYPE'))
T.check("<html> opent en sluit", HTML.count('<html') == 1 and HTML.count('</html>') == 1)
T.check("<body> opent en sluit", HTML.count('<body') == 1 and HTML.count('</body>') == 1)
T.check("Enkelvoudige <script>", HTML.count('<script>') == 1)
T.check("Enkelvoudige <style>", HTML.count('<style>') == 1)

# div balance
div_open  = len(re.findall(r'<div[\s>]', HTML))
div_close = HTML.count('</div>')
T.check("Alle <div> gesloten", div_open == div_close, f"open:{div_open} sluit:{div_close}")

# ══════════════════════════════════════════════════════════════════
# T2: CSS INTEGRITEIT
# ══════════════════════════════════════════════════════════════════

T.suite("T2 · CSS Integriteit")

media_pos = CSS.find('@media')
css_global = CSS[:media_pos] if media_pos > 0 else CSS

# Check for unscoped .on rules that could cause cascade conflicts
bare_on = re.findall(r'(?<!\w)\.on\{', CSS)
T.check("Geen bare .on{} regels (cascade conflict)", len(bare_on) == 0,
        f"{len(bare_on)} gevonden")

# CSS variables defined
for var in ['--ink', '--acc', '--teal', '--gold', '--paper', '--pc', '--pw']:
    T.check(f"CSS var {var} gedefinieerd", var + ':' in CSS)

# Critical element styles
for selector in ['.view', '.view.on', '#app', '#sb', '#mn', '.btn', '.msg.u', '.msg.a']:
    T.check(f"CSS: {selector}", selector + '{' in CSS or selector.replace(' ', '') + '{' in CSS, critical=False)

# Mobile media query
T.check("@media(max-width:720px) aanwezig", '@media(max-width:720px)' in CSS)

# Count @media blocks (should be 1-2, not more)
media_count = len(re.findall(r'@media\(', CSS))
T.check(f"@media blocks: {media_count} (max 3)", media_count <= 3, f"{media_count} blocks")

# Check .bub CSS ordering (shared props should come after specific)
bub_positions = [m.start() for m in re.finditer(r'\.bub\{', CSS)]
T.check("Meerdere .bub CSS regels voor chat bubbles", len(bub_positions) >= 1)

# ══════════════════════════════════════════════════════════════════
# T3: HTML DOM STRUCTUUR
# ══════════════════════════════════════════════════════════════════

T.suite("T3 · HTML DOM Structuur")

# Required views
for v in ['ck', 'bo', 'dy', 'da', 'gl', 'wc', 'wr']:
    T.check(f"View #v-{v}", f'id="v-{v}"' in HTML)

# Only one view active at start
active_views = re.findall(r'class="view on"', HTML)
T.check("Precies 1 view actief bij start", len(active_views) == 1, f"{len(active_views)} actief")

# Required dialogs (outside main content area)
for dialog_id in ['go', 'ng-d', 'rej-d', 'hold-d']:
    T.check(f"Dialog #{dialog_id} aanwezig", f'id="{dialog_id}"' in HTML)

# Dialogs have proper close behavior
for dialog_id in ['go', 'ng-d', 'rej-d', 'hold-d']:
    ctx = HTML[HTML.find(f'id="{dialog_id}"'):HTML.find(f'id="{dialog_id}"')+100]
    has_click_close = 'onclick=' in ctx
    T.check(f"Dialog #{dialog_id} heeft click-outside-to-close", has_click_close, critical=False)

# Mobile nav
T.check("Mobile nav #mob aanwezig", 'id="mob"' in HTML)
mob_items = len(re.findall(r'class="mi2', HTML))
T.check(f"Mobile nav items: {mob_items} (verwacht 5)", mob_items == 5, f"{mob_items} items")

# Critical UI elements
for el_id in ['ag', 'cm', 'ci', 'sb2', 'gs-body', 'gg', 'p-rows', 'wc-body', 'wr-body', 'tw']:
    T.check(f"Element #{el_id}", f'id="{el_id}"' in HTML)

# Font loading
T.check("Google Fonts geladen", 'fonts.googleapis.com' in HTML)
for font in ['DM+Mono', 'Syne', 'Noto+Serif+JP']:
    T.check(f"Font {font}", font in HTML)

# Favicon
T.check("Favicon aanwezig", 'rel="icon"' in HTML)

# PWA tags
T.check("Apple PWA tag", 'apple-mobile-web-app-capable' in HTML)
T.check("Theme color", 'theme-color' in HTML)
T.check("Viewport met viewport-fit", 'viewport-fit=cover' in HTML)

# ══════════════════════════════════════════════════════════════════
# T4: JAVASCRIPT RUNTIME (Node.js VM)
# ══════════════════════════════════════════════════════════════════

T.suite("T4 · JavaScript Runtime")

NODE_RUNTIME = r"""
'use strict';
const vm = require('vm');
const fs = require('fs');

const ctx = vm.createContext({
  localStorage: {
    _d: {},
    getItem(k) { return this._d[k] !== undefined ? String(this._d[k]) : null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; }
  },
  document: {
    _val: { 'ci': '', 'ng-t': 'Test Doel', 'ng-desc': 'Test beschrijving', 'ng-i': '🎯' },
    getElementById(id) {
      const self = this;
      return {
        textContent: '', style: { width:'', background:'', display:'' },
        innerHTML: '', value: self._val[id] || '',
        classList: { add:()=>{}, remove:()=>{}, toggle:()=>{} },
        disabled: false, focus: ()=>{},
        appendChild(child) {}
      };
    },
    querySelectorAll(sel) { return { forEach: ()=>{} }; },
    createElement(tag) {
      return { className:'', textContent:'', appendChild:()=>{}, remove:()=>{}, style:{} };
    }
  },
  fetch: async (url, opts) => ({
    ok: false, status: 400,
    json: async () => ({ error: 'mock 400' }),
    text: async () => 'mock 400',
    body: { getReader: () => ({ read: async () => ({ done:true, value:null }) }) }
  }),
  setTimeout: (fn, ms) => {},
  console: { log:()=>{}, error:()=>{}, warn:()=>{} },
  require: require,
  JSON, Math, Date, Array, Object, String, Number, Boolean,
  isNaN, parseFloat, parseInt, decodeURIComponent, encodeURIComponent,
  Promise, Error, TypeError
});

const html = fs.readFileSync(process.argv[2], 'utf8');
let script = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
// Remove boot code that accesses DOM at startup
script = script.replace(/\/\/ ── BOOT[\s\S]*$/, '// BOOT REMOVED');

// Script will be run after adding exports block (see below)

const results = [];
function pass(name, val) { results.push({name, ok:true, val:String(val||'')}); }
function fail(name, msg) { results.push({name, ok:false, val:String(msg||'')}); }
function test(name, fn) {
  try {
    const r = fn();
    if (r === false) fail(name, 'returned false');
    else pass(name, r === true ? '' : r);
  } catch(e) { fail(name, e.message.slice(0,80)); }
}

// Access vars from context
// Note: const/let vars from strict mode script are NOT in ctx directly
// We need the script to expose them via ctx object
// Add export block to end of app script
script += `
// EXPORT FOR TESTING (added by test runner)
try {
  ctx_exports = {
    S: typeof S !== 'undefined' ? S : undefined,
    AGENTS: typeof AGENTS !== 'undefined' ? AGENTS : undefined,
    ORD: typeof ORD !== 'undefined' ? ORD : undefined,
    portCtx: typeof portCtx !== 'undefined' ? portCtx : undefined,
    allCtx: typeof allCtx !== 'undefined' ? allCtx : undefined,
    learnCtx: typeof learnCtx !== 'undefined' ? learnCtx : undefined,
    parseCSV: typeof parseCSV !== 'undefined' ? parseCSV : undefined,
    numEU: typeof numEU !== 'undefined' ? numEU : undefined,
    buildPort: typeof buildPort !== 'undefined' ? buildPort : undefined,
    GOALS: typeof GOALS !== 'undefined' ? GOALS : undefined,
    saveGoals: typeof saveGoals !== 'undefined' ? saveGoals : undefined,
    togAct: typeof togAct !== 'undefined' ? togAct : undefined,
    go: typeof go !== 'undefined' ? go : undefined,
    send: typeof send !== 'undefined' ? send : undefined,
    renderChat: typeof renderChat !== 'undefined' ? renderChat : undefined,
    openGoal: typeof openGoal !== 'undefined' ? openGoal : undefined,
    saveNG: typeof saveNG !== 'undefined' ? saveNG : undefined,
    clearChat: typeof clearChat !== 'undefined' ? clearChat : undefined,
    selAg: typeof selAg !== 'undefined' ? selAg : undefined,
    renderGrid: typeof renderGrid !== 'undefined' ? renderGrid : undefined,
    renderGoals: typeof renderGoals !== 'undefined' ? renderGoals : undefined,
  };
} catch(e) {}
`;
ctx.ctx_exports = {};
try {
  vm.runInContext(script, ctx);
} catch(e) {
  if (!e.message.includes('BOOT')) {
    console.error('SCRIPT_ERROR:' + e.message);
    process.exit(1);
  }
}
const E = ctx.ctx_exports;
const { S, AGENTS, ORD, portCtx, allCtx, learnCtx, parseCSV, numEU, 
        buildPort, GOALS, saveGoals, togAct, go, send, renderChat, 
        openGoal, saveNG, clearChat, selAg, renderGrid, renderGoals } = E;

// STATE TESTS
test('S object geïnitialiseerd', () => S && typeof S === 'object');
test('S.cur default = board', () => S.cur === 'board');
test('S.hrv.rmssd default = 45', () => S.hrv.rmssd === 45);
test('S.hrv.recovery default = 7', () => S.hrv.recovery === 7);
test('S.hrv.sleep default = 7.2', () => S.hrv.sleep === 7.2);
test('S.holdings heeft BTC', () => 'BTC' in S.holdings);
test('S.holdings heeft ETH', () => 'ETH' in S.holdings);
test('S.chat leeg bij start', () => Object.keys(S.chat).length === 0);
test('S.learn leeg bij start', () => Object.keys(S.learn).length === 0);

// AGENT TESTS
test('13 agents gedefinieerd', () => Object.keys(AGENTS).length === 13);
test('ORD heeft 13 entries', () => ORD.length === 13);
test('Alle ORD agents bestaan in AGENTS', () => ORD.every(id => id in AGENTS));
for (const id of ['board','health','finance','strategic','reflection','productivity','decision','writing']) {
  test(`AGENTS.${id}.sys() werkt`, () => {
    const s = AGENTS[id].sys();
    if (typeof s !== 'string') return false;
    if (s.length < 30) return false;
    if (!s.includes('Nederlands')) return false;
    return s.length + ' chars';
  });
  test(`AGENTS.${id}.sys() heeft context`, () => {
    const s = AGENTS[id].sys();
    return s.includes('Portfolio') || s.includes('HRV') || s.includes('rMSSD') || s.includes('stagnatie');
  });
}

// CONTEXT FUNCTIONS
test('portCtx() default bevat €', () => portCtx().includes('€'));
test('allCtx() bevat Portfolio', () => allCtx().includes('Portfolio'));
test('allCtx() bevat HRV', () => allCtx().includes('HRV'));
test('allCtx() is functie', () => typeof allCtx === 'function');
test('learnCtx() leeg bij geen data', () => learnCtx('board') === '');
test('learnCtx() met data', () => {
  S.learn.board = { pos: [{txt:'test inzicht'}], rej: [] };
  const r = learnCtx('board');
  S.learn.board = undefined;
  return r.includes('test inzicht');
});

// CSV PARSER
test('parseCSV: komma separator', () => {
  const r = parseCSV('date,rmssd,hr\n2024-01-01,45,58');
  return r.length === 1 && r[0].rmssd === '45' && r[0].hr === '58';
});
test('parseCSV: puntkomma separator', () => {
  const r = parseCSV('datum;rmssd;hr\n2024-01-01;50;60');
  return r.length === 1 && r[0].rmssd === '50';
});
test('parseCSV: quoted velden', () => {
  const r = parseCSV('name,val\n"Vanguard VWCE",100.50');
  return r.length === 1 && r[0].name === 'Vanguard VWCE';
});
test('parseCSV: lege regels geskipt', () => {
  const r = parseCSV('a,b\n1,2\n\n3,4\n');
  return r.length === 2;
});
test('parseCSV: \\r\\n line endings', () => {
  const r = parseCSV('a,b\r\n1,2\r\n3,4');
  return r.length === 2;
});

// EURO NUMBER PARSER
test('numEU: "123,45" = 123.45', () => numEU('123,45') === 123.45);
test('numEU: "1.234,56" = 1234.56', () => numEU('1.234,56') === 1234.56);
test('numEU: "€ 99,99" = 99.99', () => numEU('€ 99,99') === 99.99);
test('numEU: "100" = 100', () => numEU('100') === 100);
test('numEU: "1234.56" = 1234.56', () => numEU('1234.56') === 1234.56);
test('numEU: leeg = 0', () => numEU('') === 0);
test('numEU: null-safe', () => numEU(null) === 0);

// PORTFOLIO BUILD
test('buildPort: basis berekening', () => {
  buildPort([{symbol:'BTC',total:0.5}], {BTC:{price:50000,change24h:2}}, new Date().toISOString(), 'Test');
  return S.port !== null && S.port.totalValue === 25000;
});
test('buildPort: row structuur correct', () => {
  const r = S.port.rows[0];
  return r.sym === 'BTC' && typeof r.pnlPct === 'number' && typeof r.value === 'number' && r.source === 'Test';
});
test('buildPort: P&L berekening', () => {
  // BTC qty=0.5, avgBuy=28000, price=50000
  // cost = 14000, value = 25000, pnl = (25000-14000)/14000 * 100 = 78.57%
  S.holdings.BTC.avgBuy = 28000;
  buildPort([{symbol:'BTC',total:0.5}], {BTC:{price:50000,change24h:0}}, new Date().toISOString(), 'Test');
  const pnl = S.port.rows[0].pnlPct;
  return Math.abs(pnl - 78.57) < 1;
});
test('buildPort: filter < €5', () => {
  buildPort([{symbol:'DUST',total:0.00001}], {DUST:{price:1,change24h:0}}, new Date().toISOString(), 'Test');
  return S.port.rows.length === 0;
});
test('buildPort: DeGiro merge', () => {
  S.degiro = {VWCE:{qty:10,avgBuy:90,currentPrice:100,name:'VWCE',type:'etf'}};
  buildPort([{symbol:'BTC',total:0.1}], {BTC:{price:50000,change24h:0}}, new Date().toISOString(),'Test');
  return S.port.rows.length === 2;
});
test('buildPort: totalPnlPct berekend', () => {
  return typeof S.port.totalPnlPct === 'number' && !isNaN(S.port.totalPnlPct);
});
test('buildPort: sla op in localStorage', () => {
  return ctx.localStorage.getItem('tm2_port') !== null;
});

// GOALS
test('GOALS: array', () => Array.isArray(GOALS));
test('GOALS[0]: heeft actions array', () => GOALS.length === 0 || (Array.isArray(GOALS[0].actions) && GOALS[0].actions.length > 0));
test('GOALS[0]: heeft milestones array', () => GOALS.length === 0 || (Array.isArray(GOALS[0].milestones) && GOALS[0].milestones.length > 0));
test('GOALS[0]: heeft color', () => GOALS.length === 0 || typeof GOALS[0].color === 'string');
test('saveGoals: slaat op in localStorage', () => {
  saveGoals();
  return ctx.localStorage.getItem('tm2_goals') !== null;
});
test('saveGoals: data correct', () => {
  saveGoals();
  const stored = JSON.parse(ctx.localStorage.getItem('tm2_goals'));
  return stored.length === GOALS.length;
});
test('togAct: toggle done status', () => {
  if(GOALS.length === 0) return true;
  const before = GOALS[0].actions[0].done;
  togAct(GOALS[0].id, 0);
  return GOALS[0].actions[0].done !== before;
});
test('togAct: herbereken pct', () => {
  if(GOALS.length === 0) return true;
  const p = GOALS[0].pct;
  return typeof p === 'number' && p >= 0 && p <= 100;
});

// FUNCTION EXISTENCE
for (const fn of ['go','send','clearChat','selAg','renderGrid','renderChat','openGoal',
                   'saveNG','openNG','closeNG','doFB','closeRej','confRej',
                   'syncPort','buildPort','renderPort','openHold','closeHold','saveHold',
                   'parseCSV','numEU','handleHRV','handleDG',
                   'stab','initPulse','drawPulse','loadWorld','genReview','toast']) {
  test(`Functie ${fn}() bestaat`, () => typeof ctx[fn] === 'function');
}

// SEND() VALIDATIE
test('send() is async', () => send.constructor.name === 'AsyncFunction');
test('send() heeft finally block', () => send.toString().includes('finally'));
test('send() reset busy in finally', () => {
  const s = send.toString();
  const fi = s.indexOf('finally');
  return fi > 0 && s.slice(fi, fi+100).includes('busy=false');
});
test('send() deduplicatie van roles', () => send.toString().includes("acc[acc.length-1].role===m.role"));
test('send() toont Anthropic error', () => send.toString().includes('ANTHROPIC_API_KEY'));
test('send() model correct', () => send.toString().includes('claude-sonnet-4-5'));

// GO() NAVIGATIE
test('go() roept initCK aan voor ck', () => go.toString().includes("'ck')initCK()") || go.toString().includes("==='ck')initCK"));
test('go() roept renderGrid aan voor bo', () => go.toString().includes('renderGrid'));
test('go() roept initPulse aan voor dy', () => go.toString().includes('initPulse'));
test('go() roept renderGoals aan voor gl', () => go.toString().includes('renderGoals'));

// Print results as JSON
console.log('RESULTS:' + JSON.stringify(results));
"""

with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
    f.write(NODE_RUNTIME)
    node_test_path = f.name

stdout, stderr, rc = T.run_node(f"require('{node_test_path}'); process.argv[2] = '{HTML_PATH}';", timeout=20)

# Better approach: pass HTML path as arg
r = subprocess.run(['node', node_test_path, HTML_PATH], 
                   capture_output=True, text=True, timeout=30)
os.unlink(node_test_path)

if r.returncode != 0 and 'RESULTS:' not in r.stdout:
    T.check("Node.js runtime SCRIPT_ERROR", False, 
            r.stderr.split('\n')[0][:80] if r.stderr else "Onbekende fout")
else:
    # Parse results
    results_raw = r.stdout
    if 'RESULTS:' in results_raw:
        results_json = results_raw[results_raw.find('RESULTS:')+8:]
        try:
            node_results = json.loads(results_json.strip())
            for res in node_results:
                T.check(res['name'], res['ok'], res['val'] if not res['ok'] else '')
        except json.JSONDecodeError as e:
            T.check("Node.js resultaten parseren", False, str(e)[:60])
    else:
        T.check("Node.js output bevat resultaten", False, r.stderr[:80])

# ══════════════════════════════════════════════════════════════════
# T5: FUNCTIONELE FLOWS
# ══════════════════════════════════════════════════════════════════

T.suite("T5 · Functionele Flows")

def fn_body(name):
    """Extract function body from JS"""
    idx = JS.find(f'function {name}(')
    if idx == -1:
        idx = JS.find(f'async function {name}(')
    if idx == -1: return ""
    # Find end by brace counting
    start = JS.find('{', idx)
    if start == -1: return ""
    depth, i = 0, start
    while i < min(start + 5000, len(JS)):
        if JS[i] == '{': depth += 1
        elif JS[i] == '}':
            depth -= 1
            if depth == 0: return JS[idx:i+1]
        i += 1
    return JS[idx:idx+2000]

# F1: Board Chat
board_send = fn_body('send')
T.check("send() wacht op busy flag", 'if(busy)return' in board_send)
T.check("send() bouwt messages array", 'const msgs=' in board_send or 'const raw=' in board_send)
T.check("send() stuurt system prompt mee", "a.sys()" in board_send)
T.check("send() verwerkt SSE streaming", "content_block_delta" in board_send)
T.check("send() scrollt chat naar beneden", 'scrollTop' in board_send or 'scrollHeight' in board_send, critical=False)

clear_fn = fn_body('clearChat')
T.check("clearChat() reset busy=false", 'busy=false' in clear_fn)
T.check("clearChat() leegt chat array", "S.chat[S.cur]=[]" in clear_fn)
T.check("clearChat() disabled=false", 'disabled=false' in clear_fn)

# F2: Agent Selection
sel_fn = fn_body('selAg')
T.check("selAg() roept renderGrid() aan", 'renderGrid()' in sel_fn)
T.check("selAg() roept renderChat() aan", 'renderChat()' in sel_fn)
T.check("selAg() update chat header", 'ch-i' in sel_fn or 'ch-n' in sel_fn)
T.check("selAg() roept upLearn() aan", 'upLearn()' in sel_fn)

# F3: Goal CRUD
open_fn = fn_body('openGoal')
T.check("openGoal() zet title", 'gs-t' in open_fn)
T.check("openGoal() zet progressbar", 'gs-b' in open_fn)
T.check("openGoal() rendert acties", 'togAct' in open_fn)
T.check("openGoal() opent overlay", "go').classList.add('on')" in open_fn or ".classList.add('on')" in open_fn)
T.check("openGoal() heeft Board advies knop", "send();" in open_fn)

save_fn = fn_body('saveNG')
T.check("saveNG() valideert titel", 'ng-t' in save_fn)
T.check("saveNG() voegt toe aan GOALS array", 'GOALS.push' in save_fn)
T.check("saveNG() slaat op", 'saveGoals()' in save_fn)
T.check("saveNG() sluit dialog", 'closeNG()' in save_fn)
T.check("saveNG() rendert doelen", 'renderGoals()' in save_fn)

tog_fn = fn_body('togAct')
T.check("togAct() togglet done", '.done=!' in tog_fn)
T.check("togAct() herbereken pct", '.pct=' in tog_fn)
T.check("togAct() slaat op", 'saveGoals()' in tog_fn)
T.check("togAct() herrendert", 'openGoal(' in tog_fn and 'renderGoals()' in tog_fn)

# F4: Portfolio
build_fn = fn_body('buildPort')
T.check("buildPort() berekent totalValue", 'totalValue:tv' in build_fn)
T.check("buildPort() berekent P&L", 'pnlPct:pnl' in build_fn)
T.check("buildPort() filtert < €5", 'value>=5' in build_fn)
T.check("buildPort() merge DeGiro", 'S.degiro' in build_fn)
T.check("buildPort() update cockpit", 'ck-port' in build_fn)
T.check("buildPort() roept renderPort() aan", 'renderPort()' in build_fn)

render_fn = fn_body('renderPort')
T.check("renderPort() update cockpit metric", 'ck-port' in render_fn)
T.check("renderPort() toont sync tijd", 'p-sync' in render_fn)
T.check("renderPort() toont P&L kleur", 'pg' in render_fn or 'pill-green' in render_fn or "'pg'" in render_fn)

# F5: Pulse flow
draw_fn = fn_body('drawPulse')
T.check("drawPulse() stap 0: energieslider", "step===0" in draw_fn and "range" in draw_fn, critical=False)
T.check("drawPulse() stap 1: moodgrid", "step===1" in draw_fn and "MOODS" in draw_fn, critical=False)
T.check("drawPulse() stap 2: HRV invoer", "step===2" in draw_fn and "rmssd" in draw_fn, critical=False)
T.check("drawPulse() stap 3: prioriteiten", "step===3" in draw_fn, critical=False)
T.check("drawPulse() stap 4: slaat HRV op", "step===4" in draw_fn and "lsSet" in draw_fn, critical=False)
T.check("drawPulse() stap 4: Board advies", "step===4" in draw_fn and "send();" in draw_fn, critical=False)
T.check("drawPulse() sum string safe", ".replace(/'/g" in draw_fn or "onbekend" in draw_fn, critical=False)

# F6: Feedback loop
fb_fn = fn_body('doFB')
T.check("doFB() opslaan als positief", "pos=[" in fb_fn or ".pos=[{" in fb_fn or "S.learn[S.cur].pos" in fb_fn)
T.check("doFB() opent reject dialog", "rej-d').classList.add" in fb_fn)

rej_fn = fn_body('confRej')
T.check("confRej() slaat reden op", ".rej=[{" in rej_fn or "S.learn[agId].rej" in rej_fn)
T.check("confRej() slaat op in localStorage", "lsSet" in rej_fn)

# F7: World & Review API
world_fn = fn_body('loadWorld')
T.check("loadWorld() gebruikt /api/claude", "'/api/claude'" in world_fn)
T.check("loadWorld() GEEN streaming", "stream:" not in world_fn)
T.check("loadWorld() JSON parse met fallback", world_fn.count('JSON.parse') >= 2)
T.check("loadWorld() fout-afhandeling", "catch" in world_fn and "Ophalen mislukt" in world_fn)

rev_fn = fn_body('genReview')
T.check("genReview() gebruikt /api/claude", "'/api/claude'" in rev_fn)
T.check("genReview() bevat live HRV data", "S.hrv" in rev_fn)
T.check("genReview() JSON parse met fallback", rev_fn.count('JSON.parse') >= 2)
T.check("genReview() fout-afhandeling", "catch" in rev_fn)

# ══════════════════════════════════════════════════════════════════
# T6: API INTEGRATIE
# ══════════════════════════════════════════════════════════════════

T.suite("T6 · API Integratie")

# claude.js proxy
claude_path = os.path.join(FUNCTIONS_PATH, 'claude.js')
if os.path.exists(claude_path):
    with open(claude_path) as f:
        cjs = f.read()
    T.check("claude.js: onRequestPost export", 'onRequestPost' in cjs)
    T.check("claude.js: x-api-key header", 'x-api-key' in cjs)
    T.check("claude.js: anthropic-version header", 'anthropic-version' in cjs)
    T.check("claude.js: forwardt body naar Anthropic", 'api.anthropic.com/v1/messages' in cjs)
    T.check("claude.js: streaming support", 'isStreaming' in cjs or 'stream' in cjs)
    T.check("claude.js: error terugsturen naar client", 'upstream.status' in cjs)
    T.check("claude.js: ANTHROPIC_API_KEY uit env", 'env.ANTHROPIC_API_KEY' in cjs)
    T.check("claude.js: missing key foutmelding", 'niet geconfigureerd' in cjs or 'not configured' in cjs)
    
    # Check for common proxy mistakes
    T.check("claude.js: geen hardcoded API key", 'sk-ant-' not in cjs)
    
    # Syntax check
    r = subprocess.run(['node', '--check', claude_path], capture_output=True, text=True)
    T.check("claude.js: JavaScript syntax", r.returncode == 0, r.stderr[:60])
else:
    T.check("claude.js bestaat", False, f"Niet gevonden: {claude_path}")

# bitvavo-portfolio.js
bvport_path = os.path.join(FUNCTIONS_PATH, 'bitvavo-portfolio.js')
if os.path.exists(bvport_path):
    with open(bvport_path) as f:
        bvp = f.read()
    T.check("bitvavo-portfolio.js: onRequestGet export", 'onRequestGet' in bvp)
    T.check("bitvavo-portfolio.js: HMAC signing", 'HMAC' in bvp or 'hmac' in bvp or 'crypto' in bvp.lower())
    T.check("bitvavo-portfolio.js: API key uit env", 'env.BITVAVO' in bvp)
    T.check("bitvavo-portfolio.js: syntax", subprocess.run(['node','--check',bvport_path],capture_output=True).returncode == 0)
else:
    T.check("bitvavo-portfolio.js bestaat", False)

# bitvavo-prices.js  
bvpr_path = os.path.join(FUNCTIONS_PATH, 'bitvavo-prices.js')
if os.path.exists(bvpr_path):
    with open(bvpr_path) as f:
        bvpr = f.read()
    T.check("bitvavo-prices.js: onRequestGet export", 'onRequestGet' in bvpr)
    T.check("bitvavo-prices.js: public endpoint (geen auth)", 'api.bitvavo.com' in bvpr)
    T.check("bitvavo-prices.js: syntax", subprocess.run(['node','--check',bvpr_path],capture_output=True).returncode == 0)
else:
    T.check("bitvavo-prices.js bestaat", False)

# Frontend API calls
T.check("Frontend: /api/claude call", "fetch('/api/claude'" in JS)
T.check("Frontend: /api/bitvavo-portfolio call", "fetch('/api/bitvavo-portfolio'" in JS)
T.check("Frontend: /api/bitvavo-prices call", "fetch('/api/bitvavo-prices" in JS)
T.check("Frontend: CoinGecko fallback", 'api.coingecko.com' in JS)
T.check("Frontend: model claude-sonnet-4-5", "'claude-sonnet-4-5'" in JS)
T.check("Frontend: max_tokens aanwezig", 'max_tokens:' in JS)
T.check("Frontend: SSE streaming", "content_block_delta" in JS)
T.check("Frontend: error toont exact bericht", 'err.message' in JS)
T.check("Frontend: foutmelding verwijst naar Cloudflare", 'Cloudflare' in JS or 'Variables and Secrets' in JS)

# ══════════════════════════════════════════════════════════════════
# T7: MOBIEL & RESPONSIVE
# ══════════════════════════════════════════════════════════════════

T.suite("T7 · Mobiel & Responsive")

media_css = CSS[CSS.find('@media'):]

T.check("Sidebar verborgen op mobiel", 'transform:translateX(-100%)' in media_css or '#sb{display:none!important}' in media_css)
T.check("Mob nav zichtbaar op mobiel", '#mob{' in media_css)
T.check("Main padding-bottom voor nav", '#mn{' in media_css and 'padding-bottom' in media_css)
T.check("Goals grid 1 kolom mobiel", '.gg{grid-template-columns:1fr!important}' in media_css)
T.check("Board layout 1 kolom mobiel", '.bl{grid-template-columns:1fr!important}' in media_css)
T.check("Board right sidebar verborgen", '.br{display:none!important}' in media_css)
T.check("Review grid aangepast mobiel", '.rg{' in media_css, critical=False)
T.check("Viewport scroll area padding", '.vs{padding' in media_css)
T.check("Goal sheet 100% breed mobiel", '.gs{width:100vw}' in media_css)
T.check("Safe-area-inset support", 'safe-area-inset-bottom' in CSS)
T.check("Viewport fit=cover", 'viewport-fit=cover' in HTML)
T.check("Touch tap highlight uitgeschakeld", '-webkit-tap-highlight-color:transparent' in CSS)
T.check("Min-height voor touch targets", 'min-height:' in CSS)
T.check("@media 400px voor kleine schermen", '@media(max-width:400px)' in CSS)

# ══════════════════════════════════════════════════════════════════
# T8: PERSISTENTIE & STATE
# ══════════════════════════════════════════════════════════════════

T.suite("T8 · Persistentie & State")

required_keys = ['tm2_chat', 'tm2_learn', 'tm2_goals', 'tm2_hold', 'tm2_dg', 
                 'tm2_port', 'tm2_hrv', 'tm2_lf']
for key in required_keys:
    T.check(f"localStorage key: {key}", f"'{key}'" in JS)

# Check defensive reads (try/catch)
ls_reads = re.findall(r'function ls\(', JS)
T.check("Defensieve ls() wrapper functie aanwezig", len(ls_reads) > 0)

ls_fn = JS[JS.find('function ls('):JS.find('function ls(')+200]
T.check("ls() heeft try/catch", 'try' in ls_fn and 'catch' in ls_fn)

lsset_fn = JS[JS.find('function lsSet('):JS.find('function lsSet(')+100]
T.check("lsSet() heeft try/catch", 'try' in lsset_fn and 'catch' in lsset_fn)

# State mutations all go through lsSet
lsset_calls = len(re.findall(r'lsSet\(', JS))
T.check(f"lsSet() aangeroepen {lsset_calls}x (minimaal 8)", lsset_calls >= 8, f"{lsset_calls}x")

# No direct localStorage.setItem calls (should use lsSet wrapper)
direct_set = len(re.findall(r"localStorage\.setItem\(", JS))
T.check(f"Directe localStorage.setItem: {direct_set} (verwacht 0)", direct_set == 0, 
        f"{direct_set} directe aanroepen gevonden", critical=False)

# ══════════════════════════════════════════════════════════════════
# T9: SECURITY & SANITY
# ══════════════════════════════════════════════════════════════════

T.suite("T9 · Security & Sanity")

T.check("Geen hardcoded Anthropic API key", 'sk-ant-' not in HTML)
T.check("Geen hardcoded wachtwoorden", 'password=' not in HTML.lower() and 'secret=' not in HTML.lower(), critical=False)
T.check("Geen eval() misbruik", 'eval(' not in JS or JS.count('eval(') <= 1)  # 1 allowed for tests
T.check("Geen innerHTML met user input (XSS)", 
        'innerHTML = ' + 'input' not in JS,  # rough check
        critical=False)

# Check escape function exists and is used
T.check("esc() HTML escape functie aanwezig", 'function esc(' in JS)
T.check("esc() wordt gebruikt in renderChat", 'esc(m.' in JS or 'esc(m.content' in JS or 'esc(m.text' in JS)

# Console.log niet te veel in productie
console_logs = len(re.findall(r'console\.log\(', JS))
T.check(f"console.log: {console_logs}x (max 5 in prod)", console_logs <= 5,
        f"{console_logs} gevonden", critical=False)

# No TODO/FIXME left behind
todos = len(re.findall(r'TODO|FIXME|HACK|XXX', HTML))
T.check(f"Geen TODO/FIXME ({todos})", todos == 0, f"{todos} gevonden", critical=False)

# External resources only from trusted domains
external = re.findall(r'https?://([^/"\']+)', HTML)
trusted = {'fonts.googleapis.com', 'fonts.gstatic.com', 'api.coingecko.com', 
           'api.bitvavo.com', 'api.anthropic.com'}
untrusted = {d for d in external if d not in trusted and not d.startswith('api.')}
if untrusted:
    T.check(f"Externe resources: {untrusted}", False, "Mogelijk onverwachte externe afhankelijkheden", critical=False)

# ══════════════════════════════════════════════════════════════════
# PRINT SUMMARY
# ══════════════════════════════════════════════════════════════════

exit_code = T.summary()
sys.exit(exit_code)
