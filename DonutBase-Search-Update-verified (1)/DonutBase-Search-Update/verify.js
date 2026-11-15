// Ownership verification for DonutBase.
//
// How it works: to prove they own a Minecraft account, the player lists a cheap item on the DonutSMP
// auction house at an exact random price that only this server knows. The server then reads the
// auction listings through the official DonutSMP API (your key stays on the server) and looks for a
// listing whose seller name and price both match. Only the real account owner can create that listing.
//
// Env vars:
//   DONUT_API_KEY   key from running /api in-game on DonutSMP (required)
//   SESSION_SECRET  long random string used to sign login sessions (set it, or sessions reset on restart)
//   DONUT_API_BASE  optional, defaults to https://api.donutsmp.net  (only change for testing)

const crypto = require('crypto');
const http = require('http');
const https = require('https');

const API_BASE = process.env.DONUT_API_BASE || 'https://api.donutsmp.net';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const NAME_RE = /^\.?[A-Za-z0-9_]{3,16}$/;
const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 3;

const challenges = new Map(); // token -> { user, price, exp }
const hits = new Map();       // ip+bucket -> [timestamps]

function norm(n) { return String(n || '').replace(/^\./, '').toLowerCase(); }

function rateLimited(ip, bucket, max, windowMs) {
  const k = bucket + ':' + ip, now = Date.now();
  const arr = (hits.get(k) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(k, arr);
  return arr.length > max;
}

function sweep() {
  const now = Date.now();
  for (const [t, c] of challenges) if (c.exp < now) challenges.delete(t);
  for (const [k, a] of hits) if (!a.some(t => now - t < 120000)) hits.delete(k);
}
setInterval(sweep, 60000).unref();

// ---- signed sessions (stateless) ----
function b64u(buf) { return Buffer.from(buf).toString('base64url'); }
function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeSession(name, uuid) {
  const payload = b64u(JSON.stringify({ n: name, u: uuid || '', exp: Date.now() + SESSION_TTL_MS }));
  return payload + '.' + sign(payload);
}
function readSession(token) {
  if (typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [payload, sig] = token.split('.');
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return d && d.exp > Date.now() ? d : null;
  } catch (e) { return null; }
}

// ---- DonutSMP API ----
// The auction list endpoint takes its search options in a JSON request body on a GET request.
// Node's fetch() refuses a body on GET, so this uses the low-level http(s) client.
function auctionPage(page, search) {
  return new Promise((resolve, reject) => {
    const u = new URL(API_BASE + '/v1/auction/list/' + page);
    const body = JSON.stringify({ search, sort: 'recently_listed' });
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname, method: 'GET', timeout: 8000,
      headers: {
        Authorization: 'Bearer ' + process.env.DONUT_API_KEY,
        'Content-Type': 'application/json', Accept: 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let d = '';
      res.on('data', c => { d += c; if (d.length > 2e6) req.destroy(new Error('too big')); });
      res.on('end', () => {
        let json = null; try { json = JSON.parse(d); } catch (e) {}
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

function entriesOf(json) {
  const arr = Array.isArray(json) ? json : (json && (json.result || json.results || json.data || json.listings)) || [];
  return Array.isArray(arr) ? arr.filter(x => x && x.seller) : [];
}

async function findListing(user, price) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await auctionPage(page, user);
    if (r.status === 401 || r.status === 403) return { error: 'key' };
    if (r.status === 429) return { error: 'rate' };
    if (r.status < 200 || r.status >= 300) return { error: 'api' };
    const list = entriesOf(r.json);
    const hit = list.find(x => norm(x.seller.name) === norm(user) && Number(x.price) === price);
    if (hit) return { hit };
    if (list.length < 44) break; // last page
  }
  return {};
}

// ---- request handlers: (body, ip) -> { status, body } ----
async function start(body, ip) {
  if (!process.env.DONUT_API_KEY) return { status: 503, body: { ok: false, error: 'Verification is not set up on this server yet (missing DONUT_API_KEY).' } };
  if (rateLimited(ip, 'start', 12, 60000)) return { status: 429, body: { ok: false, error: 'Too many attempts. Wait a minute and try again.' } };
  const user = String((body && body.user) || '').trim();
  if (!NAME_RE.test(user)) return { status: 400, body: { ok: false, error: 'Usernames are 3–16 letters, numbers or underscores.' } };
  // one live challenge per username, so a new attempt replaces the old one
  for (const [t, c] of challenges) if (norm(c.user) === norm(user)) challenges.delete(t);
  const price = 100000 + crypto.randomInt(0, 900000); // 6 digits
  const token = crypto.randomBytes(16).toString('hex');
  challenges.set(token, { user: user, price, exp: Date.now() + CHALLENGE_TTL_MS });
  return { status: 200, body: { ok: true, token, price, expiresIn: CHALLENGE_TTL_MS / 1000 } };
}

async function check(body, ip) {
  if (!process.env.DONUT_API_KEY) return { status: 503, body: { ok: false, error: 'Verification is not set up on this server yet.' } };
  if (rateLimited(ip, 'check', 30, 60000)) return { status: 429, body: { ok: false, error: 'Too many checks. Wait a minute and try again.' } };
  const c = challenges.get(String((body && body.token) || ''));
  if (!c || c.exp < Date.now()) return { status: 410, body: { ok: false, expired: true, error: 'That verification expired. Go back and start again.' } };
  let r;
  try { r = await findListing(c.user, c.price); }
  catch (e) { return { status: 502, body: { ok: false, error: 'Could not reach DonutSMP. Try again in a moment.' } }; }
  if (r.error === 'key') return { status: 502, body: { ok: false, error: 'The server\'s DonutSMP API key is not working. Tell the site owner.' } };
  if (r.error === 'rate') return { status: 429, body: { ok: false, error: 'DonutSMP is rate limiting us. Try again in a minute.' } };
  if (r.error) return { status: 502, body: { ok: false, error: 'DonutSMP returned an error. Try again in a moment.' } };
  if (!r.hit) return { status: 200, body: { ok: false, error: 'No matching listing found yet. Make sure the price is exactly $' + c.price.toLocaleString('en-US') + ', wait a few seconds, and press Verify again.' } };
  challenges.delete(String(body.token));
  const s = r.hit.seller;
  return { status: 200, body: { ok: true, name: s.name || c.user, uuid: s.uuid || '', session: makeSession(s.name || c.user, s.uuid) } };
}

async function session(body) {
  const d = readSession(body && body.session);
  return d ? { status: 200, body: { ok: true, name: d.n, uuid: d.u } } : { status: 200, body: { ok: false } };
}

module.exports = { start, check, session, _test: { readSession, makeSession } };
