// Generates the `ducks` branch of database.rules.json FROM src/net/paths.js.
//
// The rules and the client must not be able to drift: a mismatch between them
// produces no error anywhere, it just makes signalling stop working. So the
// rule tree here is keyed by the strings the path helpers actually return -
// rename a path in paths.js and the rules move with it, or this script fails.
//
//   node tools/gen-rules.mjs            rewrite database.rules.json in place
//   node tools/gen-rules.mjs --check    exit 1 if the file has drifted
//   node tools/gen-rules.mjs --scan     exit 1 if src/ builds a path by hand
//   node tools/gen-rules.mjs --print    print just the generated ducks branch
//
// Other games share this Firebase project. Every branch except `ducks` is
// copied through untouched, and --check verifies that too.

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, '..');
const PATHS_FILE = join(PROJECT, 'src', 'net', 'paths.js');
const RULES_FILE = join(PROJECT, 'database.rules.json');

// paths.js is a browser ES module and this project has no package.json, so it
// is loaded as a data: URL rather than by extension guesswork.
const src = readFileSync(PATHS_FILE, 'utf8');
const mod = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
const { paths, limits, ICE_SIDE, ROOT } = mod;

const R = '$roomId';
const S = '$slot';
const authed = 'auth != null';

// A rules expression does NOT substitute $wildcards inside a string literal,
// so a path from paths.js has to be rebuilt as a concatenation before it can
// be handed to root.child(). This is the join between the two worlds.
function rootChild(path) {
  const parts = path.split(/(\$[A-Za-z][A-Za-z0-9]*)/).filter((p) => p !== '');
  const expr = parts.map((p) => (p.startsWith('$') ? p : `'${p}'`)).join(' + ');
  return `root.child(${expr})`;
}

const isHost = `${rootChild(paths.metaField(R, 'hostUid'))}.val() === auth.uid`;
const ownsSlot = `${rootChild(paths.slot(R, S) + '/uid')}.val() === auth.uid`;
const isStale = (node) => `${node}.child('ts').val() < now - ${limits.presenceWindowMs}`;
// Client clocks are not trustworthy to the millisecond, so a timestamp is only
// required to be roughly now. Staleness is still judged by the wider window.
const timestamp = {
  '.validate': `newData.isNumber() && newData.val() <= now + ${limits.clockSkewMs} && newData.val() >= now - ${limits.clockSkewMs}`,
};

// [path, rules] - the path is whatever paths.js returns, never a literal.
const entries = [
  [paths.lobby(), {
    // The room list is public to signed-in players; that is its whole job.
    // It carries a nickname and a count and nothing that identifies anyone.
    '.read': authed,
    [R]: {
      '.write': `${authed} && (${isHost} || (!newData.exists() && !${rootChild(paths.metaField(R, 'hostUid'))}.exists()))`,
      '.validate': "newData.hasChildren(['hostUid','hostNick','players','lastSeen'])",
      hostUid: { '.validate': 'newData.val() === auth.uid' },
      hostNick: { '.validate': `newData.isString() && newData.val().length <= ${limits.maxNickChars}` },
      players: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${limits.maxPlayers}` },
      lastSeen: timestamp,
      $other: { '.validate': false },
    },
  }],

  [paths.room(R), {
    // Deliberately no ".read" here: a read granted at the room would cascade
    // down and hand every signed-in player every other player's SDP.
    '.write': `${authed} && (!data.exists() || data.child('meta/hostUid').val() === auth.uid)`,
  }],

  [paths.meta(R), {
    '.read': authed,
    '.validate': "newData.hasChildren(['hostUid','players','lastSeen'])",
    hostUid: { '.validate': 'newData.isString() && newData.val() === auth.uid' },
    hostPid: { '.validate': `newData.isString() && newData.val().length <= 160 && newData.val().beginsWith(auth.uid)` },
    hostNick: { '.validate': `newData.isString() && newData.val().length <= ${limits.maxNickChars}` },
    players: { '.validate': `newData.isNumber() && newData.val() >= 0 && newData.val() <= ${limits.maxPlayers}` },
    public: { '.validate': 'newData.isBoolean()' },
    createdAt: timestamp,
    lastSeen: timestamp,
    $other: { '.validate': false },
  }],

  // transaction() needs .read on the exact path it writes, which is why the
  // public reservation branch is separate from the private peers branch.
  [paths.slots(R), { '.read': authed }],

  [paths.slot(R, S), {
    // A second tab of the same browser has the same uid, so ownership is by
    // pid. Without that, tab two would evict tab one from its own slot.
    '.write': `${authed} && (!data.exists() || data.child('pid').val() === newData.child('pid').val() || ${isStale('data')} || (!newData.exists() && data.child('uid').val() === auth.uid))`,
    '.validate': "newData.hasChildren(['uid','pid','ts']) && newData.child('uid').val() === auth.uid",
    uid: { '.validate': 'newData.isString() && newData.val() === auth.uid' },
    pid: { '.validate': 'newData.isString() && newData.val().length <= 160 && newData.val().beginsWith(auth.uid)' },
    ts: timestamp,
    $other: { '.validate': false },
  }],

  [paths.peer(R, S), {
    '.read': `${authed} && (${ownsSlot} || ${isHost})`,
    '.write': `${authed} && (${ownsSlot} || ${isHost})`,
    $other: { '.validate': false },
  }],

  [paths.offer(R, S), { '.validate': `newData.isString() && newData.val().length < ${limits.maxSdpChars}` }],
  [paths.answer(R, S), { '.validate': `newData.isString() && newData.val().length < ${limits.maxSdpChars}` }],

  // ICE is split by sender so neither end can clobber the other's list. The
  // side check lives on the leaf, not on its parent: a .validate on a parent
  // is not evaluated when only a child is written.
  [paths.iceFrom(R, S, '$side'), {
    $n: {
      '.validate': `($side === '${ICE_SIDE.host}' || $side === '${ICE_SIDE.client}') && newData.isString() && newData.val().length < ${limits.maxIceChars}`,
    },
  }],
];

function insert(tree, path, rules) {
  const parts = path.split('/');
  let node = tree;
  for (const part of parts) {
    if (!part) throw new Error('empty path segment in ' + path);
    if (node[part] === undefined) node[part] = {};
    if (typeof node[part] !== 'object') throw new Error('path collision at ' + path);
    node = node[part];
  }
  for (const k of Object.keys(rules)) {
    if (node[k] !== undefined) throw new Error('duplicate rule at ' + path + '/' + k);
    node[k] = rules[k];
  }
}

function build() {
  const tree = {};
  for (const [path, rules] of entries) {
    if (!path.startsWith(ROOT + '/') && path !== ROOT) {
      throw new Error(`refusing to generate rules outside the ${ROOT} branch: ${path}`);
    }
    insert(tree, path, rules);
  }
  const branch = tree[ROOT];
  if (!branch) throw new Error('no ' + ROOT + ' branch generated');
  return branch;
}

// --- path scan (gate E-B) ---------------------------------------------------

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function scan() {
  const offenders = [];
  // Both the literal root and the segments it is made of: writing
  // `ROOT + '/rooms/' + id` would evade a check that only looked for 'ducks/'.
  const segments = ['rooms/', 'peers/', 'reservation/', 'lobby/'];
  const patterns = [new RegExp(`['"\`][^'"\`]*\\b${ROOT}/`)]
    .concat(segments.map((s) => new RegExp(`['"\`][^'"\`]*${s.replace('/', '\\/')}`)));
  for (const file of walk(join(PROJECT, 'src'))) {
    if (file === PATHS_FILE) continue;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
      if (patterns.some((rx) => rx.test(line))) {
        offenders.push(`${relative(PROJECT, file)}:${i + 1}: ${trimmed}`);
      }
    });
  }
  return offenders;
}

// --- main -------------------------------------------------------------------

const args = process.argv.slice(2);
const generated = build();

if (args.includes('--print')) {
  console.log(JSON.stringify({ [ROOT]: generated }, null, 2));
  process.exit(0);
}

if (args.includes('--scan')) {
  const bad = scan();
  if (bad.length) {
    console.error('E-B FAIL: RTDB path built outside src/net/paths.js:\n' + bad.join('\n'));
    process.exit(1);
  }
  console.log('E-B ok: every RTDB path in src/ comes from src/net/paths.js');
  process.exit(0);
}

const file = JSON.parse(readFileSync(RULES_FILE, 'utf8'));
if (!file.rules) throw new Error('database.rules.json has no "rules" key');

const current = JSON.stringify(file.rules[ROOT] || null);
const wanted = JSON.stringify(generated);

if (args.includes('--check')) {
  if (current !== wanted) {
    console.error('DRIFT: database.rules.json does not match src/net/paths.js. Run: node tools/gen-rules.mjs');
    process.exit(1);
  }
  const bad = scan();
  if (bad.length) {
    console.error('DRIFT: hand-built RTDB paths in src/:\n' + bad.join('\n'));
    process.exit(1);
  }
  console.log('rules match paths.js, and no path is built by hand in src/');
  process.exit(0);
}

const before = Object.keys(file.rules);
file.rules[ROOT] = generated;
const after = Object.keys(file.rules);
const lost = before.filter((k) => !after.includes(k));
if (lost.length) throw new Error('refusing to write: branches would be lost: ' + lost.join(', '));

writeFileSync(RULES_FILE, JSON.stringify(file, null, 2) + '\n');
console.log(
  current === wanted
    ? 'database.rules.json already up to date (' + after.length + ' top-level branches, only `' + ROOT + '` is ours)'
    : 'database.rules.json regenerated from src/net/paths.js (' + after.length + ' top-level branches preserved)'
);
