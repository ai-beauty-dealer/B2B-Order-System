import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'app.js'), 'utf8');

const start = source.indexOf('async function processLoginResult(result, username)');
const end = source.indexOf('// --- Login (API) ---', start);
const flow = source.slice(start, end);

assert.ok(start >= 0 && end > start, 'processLoginResult block must exist');

const tokenAssignment = flow.indexOf("sessionToken = result.sessionToken || '';");
const save = flow.indexOf('saveResumeSession(username, resumeName);');
const accountBranch = flow.indexOf('if (result.isMaster || result.isGroup)');
const earlyReturn = flow.indexOf('return;');

assert.ok(tokenAssignment >= 0, 'session token assignment must exist');
assert.ok(save > tokenAssignment, 'resume session must be saved after receiving the token');
assert.ok(save < accountBranch, 'resume session must be saved before master/group branching');
assert.ok(save < earlyReturn, 'resume session must be saved before the master/group early return');
assert.equal(
  (flow.match(/saveResumeSession\(username, resumeName\);/g) || []).length,
  1,
  'all account types must share exactly one persistence path',
);

assert.match(source, /window\.addEventListener\('load', attemptAutoLogin\)/);
assert.match(source, /body: JSON\.stringify\(\{ action: 'login', token: session\.tk \}\)/);
assert.match(source, /clearResumeSession\(\); \/\/ 明示ログアウト/);

console.log('PWA persistent login regression checks passed');
