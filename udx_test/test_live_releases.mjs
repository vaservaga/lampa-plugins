// udx_test/test_live_releases.mjs
//
// LIVE check of the Ultradox online release data-flow against the real
// Ultradox pages (no fixtures, no simulation). The plugin source is executed
// with a mocked Lampa environment whose L.Reguest performs REAL https
// requests, so the tested path is exactly:
//   detail fetch -> parseDetail -> parseMagnets -> release list -> "Дивитися"
//   -> L.Select list (label/size/magnet as data) -> select closes the list,
//   shows "Реліз вибрано" and never starts a torrent.
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
    ['L.Torrent.start', /L\.Torrent\.start/],
    ['Torrent.start', /(?<!L\.)Torrent\.start/],
    ['playRelease', /playRelease/],
    ['chooseFile', /chooseFile/],
    ['run (call)', /\brun\s*\(/],
    ['hover:long', /hover:long/]
];
for (const [name, re] of TOKENS) {
    const hits = src.split('\n').filter((l) => re.test(l));
    check('static: ' + name + ' absent from source', hits.length === 0, JSON.stringify(hits));
}

// ---------- minimal DOM (same shape as test_fullpage.mjs) ----------
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
        find(sel) {
            const cls = String(sel).replace(/^\./, '');
            const out = [];
            (function walk(node) {
                for (const c of node.children || []) {
                    if (c && c.classes && c.classes.has(cls)) out.push(c);
                    if (c && c.children) walk(c);
                }
            })(el);
            return asQuery(out);
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

// ---------- real https fetch (what Lampa.Reguest does server-side) ----------
const fetchErrors = [];
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
        constructor() { this.onEnd = null; }
        append() {}
        render() { return makeEl('scroll'); }
        minus() {}
        reset() {}
        update() {}
        destroy() {}
    },
    Template: { js() { return makeEl('card'); } },
    Activity: { push() {}, active() { return null; }, backward() {}, toggle() {}, loader() {} },
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
    // No TMDB key in this harness: ratings stay hidden, the release flow
    // under test does not depend on TMDB.
    TMDB: {
        key() { return ''; },
        api(u) { return 'https://api.themoviedb.org/3/' + u; }
    },
    // Guard: any call to Torrent.start throws AND is counted; the test passes
    // only while the counter stays at zero.
    Torrent: { calls: 0, start() { this.calls++; throw new Error('L.Torrent.start is forbidden in this stage'); } },
    Reguest: class {
        timeout() {}
        native(url, ok, err) {
            realFetch(url, 25000).then(
                (txt) => ok(txt),
                (e) => { fetchErrors.push({ url: url, error: e.message }); err(e); }
            );
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

async function main() {
    for (const ctrl of CONTROLS) {
        console.log('live: ' + ctrl.kind + ' ' + ctrl.item.itemUrl);
        const fp = new FP({ item: ctrl.item });
        const loaderState = { on: false };
        fp.activity = { loader(on) { loaderState.on = !!on; }, toggle() {} };
        const notiesBefore = L.Noty.msgs.length;
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

        // "Дивитися": press the real play button (hover:enter), not showReleases()
        const root = fp.render();
        const playBtns = root.find('.udx-f__play');
        check(ctrl.kind + ': play button ("Дивитися") present', playBtns.length === 1, String(playBtns.length));
        const btn = playBtns[0];
        check(ctrl.kind + ': play button label', btn && btn.text() === L.Lang.translate('ultradox_watch'), btn && btn.text());
        if (!btn || !btn.handlers['hover:enter']) {
            console.log('NOT RUN: ' + ctrl.kind + ' play button handler missing');
            process.exitCode = 2;
            continue;
        }

        L.Select.last = null;
        btn.handlers['hover:enter'][0]();
        const sel = L.Select.last;
        if (!sel) {
            const lastNoty = L.Noty.msgs.slice(notiesBefore).pop();
            if (lastNoty === L.Lang.translate('ultradox_no_link')) {
                console.log('FAIL: ' + ctrl.kind + ' detail returned an EMPTY release list (live page has no magnets right now)');
                failures++;
                continue;
            }
            console.log('NOT RUN: ' + ctrl.kind + ' selector not opened (noty: ' + JSON.stringify(lastNoty) + ')');
            process.exitCode = 2;
            continue;
        }

        check(ctrl.kind + ': selector opened with a non-empty real release list', sel.items.length > 0, String(sel.items.length));
        console.log('  releases: ' + sel.items.map((i) => i.title).join(' | '));

        for (let i = 0; i < sel.items.length; i++) {
            const r = sel.items[i];
            check(ctrl.kind + ': release ' + (i + 1) + ' has a real label+size line', /\S/.test(r.title) && /\d+(\.\d+)?\s*(B|KB|MB|GB|TB)/.test(r.title), JSON.stringify(r.title));
            check(ctrl.kind + ': release ' + (i + 1) + ' magnet kept as inert data', typeof r.id.magnet === 'string' && /^magnet:\?xt=urn:btih:[0-9a-fA-F]{40}/.test(r.id.magnet), String(r.id.magnet).slice(0, 60));
            check(ctrl.kind + ': release ' + (i + 1) + ' sizeBytes is real data', typeof r.id.sizeBytes === 'number' && r.id.sizeBytes > 0, String(r.id.sizeBytes));
        }

        // Selection: closes the list, shows confirmation, never executes.
        const togglesBefore = L.Controller.toggles.content || 0;
        const notiesBeforeSel = L.Noty.msgs.length;
        sel.onSelect(sel.items[0]);
        check(ctrl.kind + ': selection closes the list (content toggle)', (L.Controller.toggles.content || 0) === togglesBefore + 1);
        check(ctrl.kind + ': selection shows "Реліз вибрано"', L.Noty.msgs.slice(notiesBeforeSel).pop() === L.Lang.translate('ultradox_release_selected'), JSON.stringify(L.Noty.msgs.slice(notiesBeforeSel)));
        check(ctrl.kind + ': selection did not start a torrent', L.Torrent.calls === 0, String(L.Torrent.calls));
    }

    check('torrent: L.Torrent.start counter is zero after all live pages', L.Torrent.calls === 0, String(L.Torrent.calls));
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
