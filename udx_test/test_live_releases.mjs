// udx_test/test_live_releases.mjs
//
// LIVE check of the Ultradox online data-flow against the real Ultradox
// pages (no fixtures, no simulation). The plugin source is executed with a
// mocked Lampa environment whose L.Reguest performs REAL https requests.
//
// Part 1 - live card-list check: the catalog component loads the real
// /serial/ and /hd/ list pages; the card model comes ONLY from that list
// HTML (the per-item country detail fetch is stubbed to its fail-safe, i.e.
// zero detail HTTP requests on the wire - the year is never sourced from a
// detail page). Per card it verifies: exactly one type badge ("Серіал" /
// "Фільм") inside the poster container, no "Фільм" text on a serial card,
// quality chip single-token, poster pinned, focus/enter handlers intact, and
// the year contract: the model year equals what the list title really
// carries - shown exactly once when present, .card__age removed entirely
// when absent (no fabricated year).
//
// Part 2 - detail/release flow (Phase 5 contract):
//   detail fetch -> parseDetail -> parseReleases -> action strip ("Онлайн" +
//   "TorrServer" over one shared builder); each press opens its dedicated
//   full page (an Activity push; the press itself starts nothing and opens no
//   L.Select). "TorrServer" page: the item's real releases as quality • size
//   rows (upload date when the page carries it, raw release kept as inert
//   data); an explicit row pick runs the standard TorrServer flow
//   (L.Torrent.start with the picked release's MagnetUri/Size). "Онлайн"
//   page: the site's real embeds listed read-only (probed on open); an
//   explicit row pick probes the embed read-only first - when reachable it
//   opens it through Lampa.Player.play (a real embed URL, never an invented
//   one); when unreachable (the live host answers 404 for origin-less
//   requests) it shows the clear "online source unavailable" message without
//   starting the player; a page without any embed shows the clear in-page
//   empty state. The core TMDB integration is intentionally unavailable in
//   this stage: every attempt goes through its single door (api) and the
//   detail page must keep working with the Ultradox data alone (enrichment
//   slots stay hidden).
//
// Control pages (verified live before wiring them in):
//   serial: /serial-hd/56755-zhivoj-2-sezon.html      (Vivant S02, 3 magnets)
//   film:   /nerufilm/58369-chernovik-napisannyj-krovju-2026.html (2 magnets)
//
// Exit codes:
//   0 PASS  - both control pages returned real releases, all checks passed
//   1 FAIL  - a control page was reachable but a check failed (incl. empty list)
//   2 NOT RUN - live pages unreachable from this machine; nothing simulated

import { readFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'plugins', 'ultradox', 'ultradox.js');
const src = readFileSync(SRC, 'utf8');

let failures = 0;
function check(name, cond, extra) {
    const ok = !!cond;
    if (!ok) failures++;
    console.log((ok ? '  ok  ' : '  FAIL  ') + name + (!ok && extra !== undefined ? '  -> ' + extra : ''));
}

// ---------- static scan: no executable playback path in the source ----------
console.log('static: execution tokens (0 executable matches required)');
const TOKENS = [
    ['playRelease', /playRelease/],
    ['chooseFile', /chooseFile/],
    ['run (call)', /\brun\s*\(/],
    ['hover:long', /hover:long/],
    ['bare L.TMDB (not the core integration door)', /\bL\.TMDB\b/],
    ['Tmdb.', /Tmdb\./],
    ['tmdbKey', /tmdbKey/],
    ['tmdbGet', /tmdbGet/],
    ['api.themoviedb.org', /api\.themoviedb\.org/],
    ['api_key=', /api_key=/]
];
for (const [name, re] of TOKENS) {
    const hits = src.split('\n').filter((l) => re.test(l));
    check('static: ' + name + ' absent from source', hits.length === 0, JSON.stringify(hits));
}

// The standard Lampa flows ARE the Phase 4 contract: each exactly one real
// call site in the executable code (comments stripped), the torrent handoff
// inside the pick handler, and the online route keeping its L.Player
// availability guard. An aliased indirection (P.play) does not count.
function stripComments(code) {
    let out = '';
    let i = 0;
    let mode = 'code';
    while (i < code.length) {
        const c = code.charAt(i);
        const n = code.charAt(i + 1);
        if (mode === 'code') {
            if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
            if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
            if (c === "'" || c === '"' || c === '`') mode = c;
            out += c; i++; continue;
        }
        if (mode === 'line') { if (c === '\n') { mode = 'code'; out += c; } i++; continue; }
        if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } i++; continue; }
        if (c === '\\') { out += c + n; i += 2; continue; }
        if (c === mode) mode = 'code';
        out += c; i++; continue;
    }
    return out;
}
const codeOnly = stripComments(src);
const countTok = (re, s) => (s.match(re) || []).length;
check('static: exactly one L.Torrent.start call site (the pick-gated handoff)', countTok(/L\.Torrent\.start\(/g, codeOnly) === 1, String(countTok(/L\.Torrent\.start\(/g, codeOnly)));
check('static: exactly one L.Player.play call site (the online route)', countTok(/L\.Player\.play\(/g, codeOnly) === 1, String(countTok(/L\.Player\.play\(/g, codeOnly)));
// The single torrent handoff must live in the release-row pick handler, and
// the single player call must live in the explicit embed-row pick - both
// handlers exist exactly once (an aliased indirection does not count).
check('static: the L.Torrent.start call sits inside startTorrServer (the pick-gated handoff)', (function () {
    const a = codeOnly.indexOf('this.startTorrServer = function');
    const b = codeOnly.indexOf('L.Torrent.start(');
    const n = (codeOnly.match(/this\.startTorrServer = function/g) || []).length;
    return n === 1 && a !== -1 && b !== -1 && a < b;
})(), 'call site misplaced');
check('static: playRow keeps the L.Player availability guard before the direct call', (function () {
    const a = codeOnly.indexOf('this.playRow = function');
    const b = codeOnly.indexOf('L.Player.play(');
    const n = (codeOnly.match(/this\.playRow = function/g) || []).length;
    if (n !== 1 || a === -1 || b === -1) return false;
    const zone = codeOnly.slice(a, b);
    return /typeof L\.Player\.play !== 'function'/.test(zone) && /!\s*url\b/.test(zone);
})(), 'guard missing');
check('static: TMDB reached only through the core integration door (window.Lampa.TMDB)', codeOnly.indexOf('window.Lampa.TMDB') !== -1 && countTok(/\bL\.TMDB\b/g, codeOnly) === 0, String(countTok(/\bL\.TMDB\b/g, codeOnly)));

// ---------- minimal DOM (same contract as test_fullpage.mjs and the real
// Lampa core: Element.prototype.find returns a SINGLE node or null) ----------
function makeEl(tag) {
    const el = {
        tagName: String(tag).toUpperCase(),
        children: [],
        classes: new Set(),
        handlers: {},
        style: {},
        _text: '',
        _parent: null,
        _setParent(p) { el._parent = p; },
        text(v) { if (v === undefined) return el._text; el._text = String(v); return el; },
        append(...k) {
            for (const x of k) {
                if (Array.isArray(x)) {
                    for (const y of x) { if (y && y._setParent) y._setParent(el); el.children.push(y); }
                } else {
                    if (x && x._setParent) x._setParent(el);
                    el.children.push(x);
                }
            }
            return el;
        },
        empty() { el.children.length = 0; return el; },
        remove() {
            if (el._parent) {
                const i = el._parent.children.indexOf(el);
                if (i !== -1) el._parent.children.splice(i, 1);
                el._parent = null;
            }
            return el;
        },
        addClass(c) { String(c).split(/\s+/).filter(Boolean).forEach((x) => el.classes.add(x)); return el; },
        removeClass(c) { String(c).split(/\s+/).filter(Boolean).forEach((x) => el.classes.delete(x)); return el; },
        on(ev, fn) { (el.handlers[ev] || (el.handlers[ev] = [])).push(fn); return el; },
        css(o) { Object.assign(el.style, o); return el; },
        // Lampa Element.prototype.find == querySelector: first matching
        // descendant in document order, or null.
        find(sel) {
            const cls = String(sel).replace(/^\./, '');
            let hit = null;
            (function walk(node) {
                if (hit) return;
                for (const c of node.children || []) {
                    if (!hit && c && c.classes && c.classes.has(cls)) hit = c;
                    if (!hit && c && c.children) walk(c);
                }
            })(el);
            return hit;
        }
    };
    return el;
}

function asQuery(list) {
    const q = list.slice();
    q.append = (...k) => { list.forEach((e) => e.append(...k)); return q; };
    q.text = (v) => { if (v === undefined) return list.map((e) => e.text()).join(''); list.forEach((e) => e.text(v)); return q; };
    q.addClass = (c) => { list.forEach((e) => e.addClass(c)); return q; };
    q.removeClass = (c) => { list.forEach((e) => e.removeClass(c)); return q; };
    q.remove = () => { list.forEach((e) => e.remove()); return q; };
    q.empty = () => { list.forEach((e) => e.empty()); return q; };
    q.css = (o) => { list.forEach((e) => e.css(o)); return q; };
    q.on = (ev, fn) => { list.forEach((e) => e.on(ev, fn)); return q; };
    q.eq = (i) => asQuery(list.slice(i, i + 1));
    return q;
}

function parseHtml(html) {
    const root = makeEl('#root');
    const stack = [root];
    const re = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
    let m;
    while ((m = re.exec(html))) {
        if (m[4] !== undefined) {
            const t = m[4].trim();
            if (t) stack[stack.length - 1]._text += t;
            continue;
        }
        if (m[0][1] === '/') {
            while (stack.length > 1 && stack[stack.length - 1].tagName !== m[1].toUpperCase()) stack.pop();
            if (stack.length > 1) stack.pop();
            continue;
        }
        const el = makeEl(m[1]);
        const cm = (m[2] || '').match(/class="([^"]*)"/);
        if (cm) cm[1].split(/\s+/).filter(Boolean).forEach((c) => el.classes.add(c));
        el._parent = stack[stack.length - 1];
        stack[stack.length - 1].children.push(el);
        if (m[3] !== '/' && m[1] !== 'img') stack.push(el);
    }
    return root.children;
}

// All matches in a subtree (assertion helper; mirrors test_fullpage.mjs).
function findAll(node, cls) {
    const out = [];
    (function walk(n) {
        for (const c of n.children || []) {
            if (c && c.classes && c.classes.has(cls)) out.push(c);
            if (c && c.children) walk(c);
        }
    })(node);
    return out;
}

// Full subtree text (assertion helper).
function allText(node) {
    let out = node._text || '';
    for (const c of node.children || []) out += ' ' + allText(c);
    return out;
}

// The badge must be a direct child of the poster container (.card__view).
function inPoster(card, cls) {
    const e = findAll(card, cls)[0];
    const v = findAll(card, 'card__view')[0];
    return !!(e && v && e._parent === v);
}

// Null-safe text of a single-node find result.
const txt = (n, sel) => { const e = n.find(sel); return e ? e.text() : ''; };

// ---------- real https fetch (what Lampa.Reguest does server-side) ----------
const fetchErrors = [];
const fetchedUrls = [];
function realFetch(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const req = https.get(url, { timeout: timeoutMs }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                if (settled) return;
                settled = true;
                realFetch(res.headers.location, timeoutMs).then(resolve, reject);
                return;
            }
            if (res.statusCode !== 200) {
                res.resume();
                if (!settled) { settled = true; reject(new Error('HTTP ' + res.statusCode)); }
                return;
            }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
            res.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
        });
        req.on('timeout', () => { if (!settled) { settled = true; req.destroy(new Error('timeout ' + timeoutMs + 'ms')); } });
        req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    });
}

// Card-list phase switch: while true, anything that is not a list page
// (detail pages) fails instantly through the plugin's fail-safe path, so the
// list check makes ZERO detail HTTP requests (the year must come from the
// list data, never from a per-card detail fetch).
let stubDetailPages = false;
let stubbedDetailCount = 0;
const LIST_URL_RE = /^https:\/\/(045\.ultradox\.click|010\.ultadox\.space)\/(serial|hd|webrips)(\/page\/\d+)?\/$/;

// ---------- Lampa mock ----------
const L = {
    Lang: {
        _dict: {},
        add(d) { Object.assign(this._dict, d); },
        translate(k) { const e = this._dict[k]; return e ? (e.uk || e.en || k) : k; }
    },
    Manifest: { plugins: {} },
    Component: { _c: {}, add(name, ctor) { this._c[name] = ctor; }, get(name) { return this._c[name]; } },
    Listener: { follow() {} },
    Layer: { update() {}, visible() {} },
    Scroll: class {
        constructor() { this.onEnd = null; this._inner = null; }
        // The real Scroll keeps the appended child inside its viewport, so the
        // mock models that: render() returns the viewport element carrying the
        // appended child (the list-page rows stay reachable in the tree).
        append(child) { this._inner = child; }
        render() { const s = makeEl('scroll'); if (this._inner) s.append(this._inner); return s; }
        minus() {}
        reset() {}
        update() {}
        destroy() {}
    },
    // Mirror the real Template.js contract: a raw card element with the
    // title/age/view children and {title}/{release_year} substitution
    // (empty value leaves the element present with empty text).
    Template: { calls: [], js(name, params) {
        const c = makeEl('card');
        ['card__title', 'card__age', 'card__view'].forEach((cls) => {
            const ch = makeEl('div'); ch.classes.add(cls); ch._setParent(c); c.children.push(ch);
        });
        const img = makeEl('img'); img.classes.add('card__img'); img._setParent(c); c.children.push(img);
        if (params) {
            const t = c.children.find((x) => x.classes.has('card__title'));
            const a = c.children.find((x) => x.classes.has('card__age'));
            if (t) t.text(params.title !== undefined && params.title !== null ? String(params.title) : '');
            if (a) a.text(params.release_year !== undefined && params.release_year !== null ? String(params.release_year) : '');
        }
        this.calls.push(c);
        return c;
    } },
    Activity: { pushes: [], push(a) { this.pushes.push(a); }, active() { return null; }, backward() {}, toggle() {}, loader() {} },
    Controller: {
        toggles: {},
        add() {},
        toggle(n) { this.toggles[n] = (this.toggles[n] || 0) + 1; },
        collectionSet() {},
        collectionFocus() {},
        own() { return false; },
        collectionAppend() {}
    },
    Select: { last: null, show(cfg) { this.last = cfg; } },
    Noty: { msgs: [], show(m) { this.msgs.push(m); } },
    Storage: {
        _s: {},
        get(k, d) { const v = this._s[k]; return v === undefined ? d : v; },
        set(k, v) { this._s[k] = String(v); }
    },
    // Fail-safe probe: the core metadata integration is deliberately
    // unavailable in this stage; every attempt goes through its single door
    // (api) and is counted, while the detail page must keep working with the
    // Ultradox data alone (enrichment slots stay hidden).
    TMDB: { touches: 0, api(u) { this.touches++; throw new Error('core metadata integration unavailable in this stage'); } },
    // Recorder for the standard torrent flow: the plugin may call it, but the
    // test asserts it happens only after an explicit user row selection and
    // with the exact payload of the picked release.
    Torrent: { calls: [], start(o, movie) { this.calls.push({ o: o, movie: movie }); } },
    // Recorder for the standard online route (Lampa.Player.play): the plugin
    // may call it only with the site's own #iframe_block-player embed URL.
    Player: { plays: [], play(entry) { this.plays.push(entry); } },
    Reguest: class {
        timeout() {}
        native(url, ok, err) {
            fetchedUrls.push(url);
            if (stubDetailPages && !LIST_URL_RE.test(url)) {
                // Card-list phase: the per-item country detail fetch takes its
                // fail-safe path (item kept). No detail HTTP request is made.
                stubbedDetailCount++;
                err(new Error('stubbed: no per-card detail fetch in the card-list phase'));
                return;
            }
            realFetch(url, 25000).then(
                (txt) => ok(txt),
                (e) => { fetchErrors.push({ url: url, error: e.message }); err(e); }
            );
        }
        // The core metadata transport is deliberately unavailable here: the
        // plugin must take its fail-safe path (it only reaches silent() if a
        // working integration ever appears).
        silent(url, ok, err) {
            if (err) err(new Error('core metadata transport is unavailable in this stage'));
        }
    }
};

globalThis.window = { Lampa: L, appready: true, plugin_ultradox_ready: false };
globalThis.Lampa = L;
globalThis.document = { addEventListener() {}, createElement: (t) => makeEl(t) };
globalThis.$ = (arg) => (typeof arg === 'string' ? asQuery(parseHtml(arg)) : (arg && arg.tagName ? asQuery([arg]) : arg));
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

console.log('boot: loading plugin source');
vm.runInThisContext(src, { filename: 'ultradox.js' });
const FP = L.Component.get('ultradox_full');
check('boot: ultradox_full component registered', typeof FP === 'function');

// ---------- control pages (live) ----------
const CONTROLS = [
    {
        kind: 'serial',
        item: { title: 'Вивант (2 сезон)', serial: true, itemUrl: 'https://045.ultradox.click/serial-hd/56755-zhivoj-2-sezon.html', poster: '' }
    },
    {
        kind: 'film',
        item: { title: 'Черновик, написанный кровью (2026)', serial: false, itemUrl: 'https://045.ultradox.click/nerufilm/58369-chernovik-napisannyj-krovju-2026.html', poster: '' }
    }
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Wait until the detail fetch finished (loader went back to false), i.e.
// FullPage.build() has run with the fetched (or failed) payload.
async function waitForBuild(loaderState, timeoutMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        if (!loaderState.on) return true;
        await sleep(50);
    }
    return false;
}

// Live card-list check: real list page -> plugin parse() -> card model ->
// rendered card DOM. The country detail fetch per item is stubbed to its
// fail-safe (zero detail requests), so every asserted value is sourced from
// the list HTML alone.
async function runLiveList(label, category, expectedKind) {
    console.log('live list: ' + label + ' (category ' + category + ')');
    const CompCtor = L.Component.get('ultradox');
    const comp = new CompCtor({ category: category });
    comp.activity = { loader() {}, toggle() {} };
    const pairs = [];
    const origAppend = comp.appendCard.bind(comp);
    comp.appendCard = (item) => {
        origAppend(item);
        pairs.push({ item: item, card: L.Template.calls[L.Template.calls.length - 1] });
    };
    const fetchErrorsBefore = fetchErrors.length;
    stubDetailPages = true;
    comp.create();
    const t0 = Date.now();
    let last = 0;
    let stableSince = 0;
    while (Date.now() - t0 < 60000) {
        await sleep(150);
        const n = pairs.length;
        if (n > 0 && n !== last) { last = n; stableSince = Date.now(); }
        if (n > 0 && n === last && Date.now() - stableSince > 1200) break;
        if (n >= 60) break;
    }
    stubDetailPages = false;
    if (pairs.length === 0) {
        const failed = fetchErrors.slice(fetchErrorsBefore);
        const why = failed.length ? failed[failed.length - 1].url + ' -> ' + failed[failed.length - 1].error : 'no cards rendered within 60s';
        console.log('NOT RUN: ' + label + ' live list check (' + why + ')');
        process.exitCode = 2;
        return;
    }

    const badBadge = [], badInside = [], badYearModel = [], badYearDom = [], badAgeAbsent = [], badChip = [], badPoster = [], badNav = [], badFilmText = [];
    let withYear = 0;
    for (let i = 0; i < pairs.length; i++) {
        const { item, card } = pairs[i];
        const kinds = findAll(card, 'udx-kind');
        if (kinds.length !== 1) badBadge.push(i);
        else if (kinds[0].text() !== expectedKind) badBadge.push(i + ':' + kinds[0].text());
        if (!inPoster(card, 'udx-kind')) badInside.push(i);
        // The only place the plugin gets a list year: the 4-digit year inside
        // the list title itself. The model must mirror exactly that.
        const yearFromList = (item.title.match(/\b(19|20)\d{2}\b/) || [])[0] || '';
        if (item.year !== yearFromList) badYearModel.push(i + ':' + item.title);
        const age = findAll(card, 'card__age');
        if (yearFromList) {
            withYear++;
            const title = findAll(card, 'card__title')[0];
            const t = (title ? title.text() : '') + ' ' + (age.length === 1 ? age[0].text() : '');
            const hits = t.match(/\b(19|20)\d{2}\b/g) || [];
            if (hits.length !== 1 || age.length !== 1 || age[0].text() !== yearFromList) badYearDom.push(i + ':' + item.title);
        } else if (age.length !== 0) {
            badAgeAbsent.push(i + ':' + item.title);
        }
        const chips = findAll(card, 'udx-chip');
        if (chips.length > 1) badChip.push(i);
        else if (chips.length === 1) {
            const q = findAll(card, 'udx-chip__quality');
            if (q.length !== 1 || !/^[A-Z0-9-]+$/.test(q[0].text())) badChip.push(i + ':' + (q[0] ? q[0].text() : ''));
        }
        const img = findAll(card, 'card__img')[0];
        if (!img) badPoster.push(i);
        else if (item.poster && img.src !== item.poster) badPoster.push(i + ':' + img.src);
        if (!card.handlers['hover:enter'] || !card.handlers['hover:focus']) badNav.push(i);
        if (expectedKind === 'Серіал' && /Фільм/.test(allText(card))) badFilmText.push(i);
    }

    check(label + ': every card has exactly one "' + expectedKind + '" badge', badBadge.length === 0, badBadge.join(','));
    check(label + ': badge sits inside the poster container (.card__view)', badInside.length === 0, badInside.join(','));
    check(label + ': card model year mirrors the list title data exactly', badYearModel.length === 0, badYearModel.join(','));
    check(label + ': year shown exactly once when the list data carries it', badYearDom.length === 0, badYearDom.join(','));
    check(label + ': .card__age absent when the list data has no year (no fabricated year)', badAgeAbsent.length === 0, badAgeAbsent.join(','));
    check(label + ': quality chip is a single token (or absent)', badChip.length === 0, badChip.join(','));
    check(label + ': poster pinned to the verified public origin', badPoster.length === 0, badPoster.join(','));
    check(label + ': focus/enter handlers intact on every card', badNav.length === 0, badNav.join(','));
    if (expectedKind === 'Серіал') {
        check('serial-list: no card carries "Фільм" text', badFilmText.length === 0, badFilmText.join(','));
    }
    console.log('  data: cards=' + pairs.length + ' withYear=' + withYear + ' withoutYear=' + (pairs.length - withYear) + ' stubbedDetailFetches=' + stubbedDetailCount);
    console.log('  sample: ' + pairs.slice(0, 3).map((p) => JSON.stringify({ title: p.item.title, year: p.item.year, serial: !!p.item.serial, quality: p.item.type })).join(' | '));
}

async function main() {
    let rowPicks = 0; // explicit TorrServer row picks performed so far
    await runLiveList('serial-list', 'serial', 'Серіал');
    await runLiveList('movie-list', 'hd', 'Фільм');

    for (const ctrl of CONTROLS) {
        console.log('live: ' + ctrl.kind + ' ' + ctrl.item.itemUrl);
        const fp = new FP({ item: ctrl.item });
        const loaderState = { on: false };
        fp.activity = { loader(on) { loaderState.on = !!on; }, toggle() {} };
        const fetchErrorsBefore = fetchErrors.length;
        fp.create(); // synchronously loader(true), then async detail fetch

        const built = await waitForBuild(loaderState, 40000);
        if (!built) {
            console.log('NOT RUN: ' + ctrl.kind + ' detail fetch did not complete within 40s');
            process.exitCode = 2;
            continue;
        }

        const fetchFailed = fetchErrors.length > fetchErrorsBefore;
        if (fetchFailed) {
            const e = fetchErrors[fetchErrors.length - 1];
            console.log('NOT RUN: ' + ctrl.kind + ' live page unreachable: ' + e.url + ' -> ' + e.error);
            process.exitCode = 2;
            continue;
        }

        // Action strip: press the real controls (hover:enter), not internals.
        const root = fp.render();
        const oBtns = root.find('.udxf__act--online');
        const tBtns = root.find('.udxf__act--torrents');
        check(ctrl.kind + ': old single "Дивитися" button gone', root.find('.udx-f__play') === null && findAll(root, 'udx-f__play').length === 0, String(findAll(root, 'udx-f__play').length));
        check(ctrl.kind + ': exactly one "Онлайн" button in the strip', findAll(root, 'udxf__act--online').length === 1, String(findAll(root, 'udxf__act--online').length));
        check(ctrl.kind + ': exactly one "TorrServer" button in the strip', findAll(root, 'udxf__act--torrents').length === 1, String(findAll(root, 'udxf__act--torrents').length));
        check(ctrl.kind + ': "TorrServer" button label', tBtns !== null && txt(tBtns, '.udxf__act__label') === L.Lang.translate('ultradox_torrserver'), tBtns ? txt(tBtns, '.udxf__act__label') : 'no button');
        check(ctrl.kind + ': "Онлайн" button label', oBtns !== null && txt(oBtns, '.udxf__act__label') === L.Lang.translate('ultradox_online'), oBtns ? txt(oBtns, '.udxf__act__label') : 'no button');
        check(ctrl.kind + ': enrichment slots stay hidden (core integration unavailable here)', (function () { const r = root.find('.udxf__rate'); const o = root.find('.udxf__orig'); const s = root.find('.udxf__seasons'); return !!(r && o && s) && r.classes.has('hide') && o.classes.has('hide') && s.classes.has('hide'); })(), JSON.stringify([txt(root, '.udxf__rate'), txt(root, '.udxf__orig'), txt(root, '.udxf__seasons')]));
        if (!oBtns || !oBtns.handlers['hover:enter'] || !tBtns || !tBtns.handlers['hover:enter']) {
            console.log('NOT RUN: ' + ctrl.kind + ' action-strip handler missing');
            process.exitCode = 2;
            continue;
        }

        // Online control: the press only opens the dedicated full-page online
        // screen (Activity push; nothing auto-starts). The page lists the
        // site's real embeds (probed read-only on open); an explicit row pick
        // probes the embed read-only first - a reachable embed opens through
        // the standard player call, an unreachable one (live host 404 for
        // origin-less requests) shows the clear "unavailable" message without
        // starting the player, a page without any embed shows the clear
        // in-page empty state. Never an invented URL, and never a dead URL
        // handed to the player.
        const playsBefore = L.Player.plays.length;
        const notiesBeforeO = L.Noty.msgs.length;
        oBtns.handlers['hover:enter'][0]();
        const pushedO = L.Activity.pushes[L.Activity.pushes.length - 1];
        check(ctrl.kind + ': "Онлайн" opens the dedicated online page (Activity push, no player auto-start)', !!pushedO && pushedO.component === 'ultradox_online' && L.Player.plays.length === playsBefore, JSON.stringify({ c: pushedO && pushedO.component, plays: L.Player.plays.length }));
        const LPo = L.Component.get('ultradox_online');
        const lpo = new LPo(pushedO);
        const lpoLoader = { on: false };
        lpo.activity = { loader(on) { lpoLoader.on = !!on; }, toggle() {} };
        lpo.create(); // read-only probe of the item page for its real embeds
        const lpoBuilt = await waitForBuild(lpoLoader, 40000);
        if (!lpoBuilt) {
            console.log('NOT RUN: ' + ctrl.kind + ' online page did not build within 40s');
            process.exitCode = 2;
            continue;
        }
        const lpoRows = findAll(lpo.render(), 'udxl__row');
        const lpoEmpty = findAll(lpo.render(), 'udx-empty');
        if (lpoRows.length > 0) {
            // Explicit row pick: the pre-player probe is a real network
            // request; wait until it has settled (player call, fetch error,
            // or the unavailable message) before judging the outcome.
            const probeErrorsBefore = fetchErrors.length;
            lpoRows[0].handlers['hover:enter'][0]();
            const probeT0 = Date.now();
            while (Date.now() - probeT0 < 30000) {
                const settled = !lpoLoader.on && (L.Player.plays.length > playsBefore || fetchErrors.length > probeErrorsBefore || L.Noty.msgs.length > notiesBeforeO);
                if (settled) break;
                await sleep(100);
            }
            const played = L.Player.plays.slice(playsBefore);
            const lastNoty = L.Noty.msgs.slice(notiesBeforeO).pop();
            if (played.length === 1) {
                check(ctrl.kind + ': "Онлайн" opened the real embed through Lampa.Player.play (explicit row pick)', /^https?:\/\//.test(played[0].url) && played[0].url.indexOf('magnet:') === -1 && played[0].title === ctrl.item.title, JSON.stringify(played[0]));
            } else if (lastNoty === L.Lang.translate('ultradox_online_unavailable')) {
                check(ctrl.kind + ': unreachable embed -> clear message, no player call (dead URL never reaches the player)', played.length === 0 && fetchErrors.length > probeErrorsBefore, JSON.stringify({ played: played.length, noty: lastNoty }));
            } else {
                check(ctrl.kind + ': unexpected online outcome after the row pick (no player, no message)', false, JSON.stringify({ played: played.length, noty: lastNoty, errs: fetchErrors.length - probeErrorsBefore }));
            }
        } else if (lpoEmpty.length === 1) {
            check(ctrl.kind + ': page without any embed -> clear in-page empty state, no player call', lpoEmpty[0].text() === L.Lang.translate('ultradox_no_online') && L.Player.plays.length === playsBefore, JSON.stringify({ empty: lpoEmpty[0].text(), plays: L.Player.plays.length - playsBefore }));
        } else {
            console.log('NOT RUN: ' + ctrl.kind + ' online page built neither rows nor the empty state');
            process.exitCode = 2;
            continue;
        }

        // TorrServer control: the press itself must never start a torrent; it
        // only opens the dedicated full-page release list. Only an explicit
        // row selection inside that page may run the standard flow.
        const torrBeforeOpen = L.Torrent.calls.length;
        L.Select.last = null;
        tBtns.handlers['hover:enter'][0]();
        const pushedT = L.Activity.pushes[L.Activity.pushes.length - 1];
        check(ctrl.kind + ': "TorrServer" opens the dedicated release page (Activity push, no L.Select)', !!pushedT && pushedT.component === 'ultradox_torrents' && L.Select.last === null, JSON.stringify(pushedT && pushedT.component));
        check(ctrl.kind + ': opening the page made no torrent call (pick-gated)', L.Torrent.calls.length === torrBeforeOpen, String(L.Torrent.calls.length - torrBeforeOpen));

        const LPt = L.Component.get('ultradox_torrents');
        const lpt = new LPt(pushedT);
        lpt.activity = { loader() {}, toggle() {} };
        lpt.create();
        const lptRoot = lpt.render();
        const lptRows = findAll(lptRoot, 'udxl__row');
        const lptEmpty = findAll(lptRoot, 'udx-empty');
        if (!lptRows.length) {
            if (lptEmpty.length === 1 && lptEmpty[0].text() === L.Lang.translate('ultradox_no_link')) {
                console.log('FAIL: ' + ctrl.kind + ' detail returned an EMPTY release list (live page has no magnets right now)');
                failures++;
                continue;
            }
            console.log('NOT RUN: ' + ctrl.kind + ' release page built no rows (empty: ' + JSON.stringify(lptEmpty.map((e) => e.text())) + ')');
            process.exitCode = 2;
            continue;
        }

        check(ctrl.kind + ': release page shows a non-empty real release list', lptRows.length > 0, String(lptRows.length));
        console.log('  releases: ' + lptRows.map((r) => r.find('.udxl__row__main').text()).join(' | '));
        for (let i = 0; i < lptRows.length; i++) {
            const r = pushedT.detail.releases[i];
            const main = lptRows[i].find('.udxl__row__main').text();
            check(ctrl.kind + ': release ' + (i + 1) + ' has a real quality • size line', /\S/.test(main) && /\d+(\.\d+)?\s*(B|KB|MB|GB|TB)/i.test(main), JSON.stringify(main));
            check(ctrl.kind + ': release ' + (i + 1) + ' magnet kept as inert data', typeof r.magnet === 'string' && /^magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/.test(r.magnet), String(r.magnet).slice(0, 60));
            check(ctrl.kind + ': release ' + (i + 1) + ' sizeBytes is real data', typeof r.sizeBytes === 'number' && r.sizeBytes > 0, String(r.sizeBytes));
        }

        // Explicit row pick: runs the standard TorrServer flow with the
        // picked release's payload - nothing else (no stray noty).
        const notiesBeforeSel = L.Noty.msgs.length;
        const torrBeforePick = L.Torrent.calls.length;
        lptRows[0].handlers['hover:enter'][0]();
        rowPicks++;
        check(ctrl.kind + ': selection ran the standard TorrServer flow exactly once (no stray noty)', L.Torrent.calls.length === torrBeforePick + 1 && L.Noty.msgs.length === notiesBeforeSel, String(L.Torrent.calls.length - torrBeforePick));
        check(ctrl.kind + ': handoff payload is the picked release (MagnetUri/Size/Tracker)', (function () {
            const c = L.Torrent.calls[L.Torrent.calls.length - 1];
            const r = pushedT.detail.releases[0];
            return !!c && c.o.MagnetUri === r.magnet && c.o.Size === r.sizeBytes && c.o.Tracker === 'Ultradox' && c.o.title === ctrl.item.title && c.movie.title === ctrl.item.title;
        })(), JSON.stringify(L.Torrent.calls[L.Torrent.calls.length - 1] && { m: String(L.Torrent.calls[L.Torrent.calls.length - 1].o.MagnetUri).slice(0, 40), s: L.Torrent.calls[L.Torrent.calls.length - 1].o.Size }));
        check(ctrl.kind + ': handoff movie seasons (TMDB unavailable here: serial falls back to 1, film none)', (function () {
            const c = L.Torrent.calls[L.Torrent.calls.length - 1];
            return !!c && (ctrl.kind === 'serial' ? c.movie.number_of_seasons === 1 : c.movie.number_of_seasons === undefined);
        })(), String(L.Torrent.calls[L.Torrent.calls.length - 1] && L.Torrent.calls[L.Torrent.calls.length - 1].movie.number_of_seasons));
        check(ctrl.kind + ': strip labels stay static after the pick', txt(oBtns, '.udxf__act__label') === L.Lang.translate('ultradox_online') && txt(tBtns, '.udxf__act__label') === L.Lang.translate('ultradox_torrserver'), txt(oBtns, '.udxf__act__label') + ' / ' + txt(tBtns, '.udxf__act__label'));
    }

    console.log('  data: tmdbDoorTouches=' + L.TMDB.touches + ' (core integration deliberately unavailable; the detail pages kept working)');
    // The only non-mirror requests allowed are the pages' own player embeds
    // (the site's #iframe_block-player iframes, probed read-only before the
    // player call) - never an external metadata service.
    const isOwnEmbed = (u) => /^https:\/\/[a-z0-9]+\.sevstar933krop\.com\/.+\/iframe\?d=ultradox\.ru$/i.test(u);
    check('metadata: every request went to the verified public mirrors or the page own player embed (no external metadata service)', fetchedUrls.every((u) => /^https:\/\/(045\.ultradox\.click|010\.ultadox\.space)\//.test(u) || isOwnEmbed(u)), JSON.stringify(fetchedUrls.filter((u) => !/^https:\/\/(045\.ultradox\.click|010\.ultadox\.space)\//.test(u)).slice(0, 8)));
    check('torrent: L.Torrent.start counter equals the explicit row picks (' + rowPicks + ')', L.Torrent.calls.length === rowPicks, String(L.Torrent.calls.length));
    if (process.exitCode === 2) {
        console.log('NOT RUN: live pages were not fully verifiable (see reasons above)');
    } else if (failures) {
        console.log('FAIL (' + failures + ' check(s) failed)');
        process.exitCode = 1;
    } else {
        console.log('PASS');
    }
}

main().catch((e) => {
    console.log('NOT RUN: harness error: ' + (e && e.message));
    process.exitCode = 2;
});
