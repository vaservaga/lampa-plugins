// udx_test/test_fullpage.mjs
//
// Contract test for the Ultradox FullPage (detail page -> release selection)
// plus a catalog-card smoke test, run against a mocked Lampa environment.
//
// The DOM mock follows the real Lampa core (app.min.js): Element.prototype.find
// returns a SINGLE node (querySelector) or null, Element.prototype.append
// unwraps jQuery-like collections via child[0], and Template.js returns a raw
// HTMLElement. The previous harness returned an array-like collection from
// find(), which masked the poster[0].src TypeError seen on the real Shield.
//
// Verifies:
//   1. Static scan of the plugin source: no Torrent.start / MagnetUri /
//      playRelease tokens remain (no executable playback path left).
//   2. The detail page builds from the fetched page: backdrop, title, metadata
//      lines, overview; the real release list keeps label/size/magnet as UI data.
//   3. Selecting a series release and a film release closes the selector
//      (content controller toggle) and shows a short confirmation via L.Noty.
//   4. L.Torrent.start is NEVER called: the mock throws on any call AND a
//      counter must stay at zero for this test to PASS.
//   5. Catalog card still renders and opens the FullPage on hover:enter; the
//      old long-press playback trigger (hover:long) is gone.
//   6. All network fetches go to the public mirrors or the TMDB API only
//      (no TorrServer/LAN).
//   7. NUM-parity card: type badge top-left (.udx-kind), year under the title
//      (release_year), TMDB rating badge bottom-right (.udx-rate); no rating
//      badge when there is no resolvable match.
//   8. Detail rating line (.udxf__rating): TMDB value + age rating + status;
//      hidden without a match; repeated work uses the TMDB cache (no refetch).
//
// Run from the lampa-plugins root:  node udx_test/test_fullpage.mjs

import { readFileSync } from 'node:fs';
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

// ---------- 1. static scan: no executable torrent launch left in the source ----------
for (const token of [/(?:L\.)?Torrent\.start/, /MagnetUri/, /playRelease/, /chooseFile/, /hover:long/]) {
    check('static: source has no ' + token, !token.test(src));
}

// ---------- DOM contract, modeled on the real Lampa core (app.min.js) ----------
// Lampa patches raw DOM nodes:
//   Element.prototype.append = (child) =>
//       Array.isArray-ish child ? each appendChild : appendChild(child instanceof jQuery ? child[0] : child)
//   Element.prototype.find = (query) => this.querySelector(query)   // SINGLE node or null
//   Template.js(name) returns a RAW HTMLElement (cloneNode), not a jQuery object.
// The plugin therefore must treat node.find(sel) as a single element; the old
// harness returned an array-like collection here, which masked the poster[0] bug.
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
        append(child) {
            const put = (c) => { if (c && c._setParent) c._setParent(el); el.children.push(c); };
            if (child && child._q) put(child[0]);              // jQuery-like -> appendChild(child[0])
            else if (Array.isArray(child)) child.forEach(put); // native array branch
            else put(child);
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

// All matches in a subtree (assertion helper; the plugin itself never needs it).
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

// Null-safe text of a single-node find result.
const txt = (n, sel) => { const e = n.find(sel); return e ? e.text() : ''; };

// jQuery-like collection ($(...) results). Lampa's Element.prototype.append
// unwraps such a collection via child[0]; the _q flag models that check.
function asQuery(list) {
    const q = list.slice();
    q._q = true;
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

// ---------- fixtures (shape mirrors the live Ultradox pages) ----------
const MIRRORS = ['https://045.ultradox.click', 'https://010.ultadox.space'];
const SERIES_URL = 'https://045.ultradox.click/serial/show-name-2021/';
const FILM_URL = 'https://045.ultradox.click/film/great-movie-2023/';

const CATALOG_HTML =
    '<html><body>' +
    '<div class="top__slider">' +
    '<div class="top__slider_div__item"><a href="/serial/show-name-2021/"><img src="/upload/show.jpg"></a>' +
    '<span>Show Name (2021)</span><span class="short-quality">Сериал</span></div></div>' +
    '</body></html>';

const SERIES_HTML =
    '<html><head>' +
    '<meta name="description" content="Детективний серіал про агентку. Формат: MKV.">' +
    '<meta property="og:image" content="https://045.ultradox.click/upload/show-fanart.jpg">' +
    '</head><body><ul>' +
    '<li><span>Жанр:</span> Детектив, Драма</li>' +
    '<li itemprop="contributor"><span> Страна: </span> США</li>' +
    '<li><span>Год:</span> 2021</li>' +
    '<li><span>Время:</span> 45 мин.</li>' +
    '<li><span>Перевод:</span> Многоголосый</li>' +
    '<li><span>Качество:</span> WEB-DLRip</li>' +
    '</ul>' +
    '<img src="https://045.ultradox.click/imdb/pic/15468572.gif">' +
    '<a href="magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&amp;dn=Show.Name.S01.E01.1080p.WEB-DLRip.mkv&amp;xl=10737418240"></a>' +
    '<a href="magnet:?xt=urn:btih:fedcba9876543210fedcba9876543210fedcba98&amp;dn=Show.Name.S01.E02.1080p.WEB-DLRip.mkv&amp;xl=10737418240"></a>' +
    '</body></html>';

const FILM_HTML =
    '<html><head>' +
    '<meta name="description" content="Епічна історія космічної одесьи. Формат: MP4.">' +
    '<meta property="og:image" content="https://045.ultradox.click/upload/movie-fanart.jpg">' +
    '</head><body><ul>' +
    '<li><span>Жанр:</span> Фантастика</li>' +
    '<li itemprop="contributor"><span> Страна: </span> Франція</li>' +
    '<li><span>Год:</span> 2023</li>' +
    '<li><span>Время:</span> 128 мин.</li>' +
    '<li><span>Перевод:</span> Дубляж</li>' +
    '</ul>' +
    '<a href="magnet:?xt=urn:btih:aaaa1111bbbb2222cccc3333dddd4444eeee5555&amp;dn=Great.Movie.2023.2160p.WEB-DL.H265.mkv&amp;xl=21474836480"></a>' +
    '</body></html>';

const ROUTES = new Map([
    ['https://045.ultradox.click/serial/', CATALOG_HTML],
    [SERIES_URL, SERIES_HTML],
    [FILM_URL, FILM_HTML]
]);

// TMDB API routes (deterministic query strings the plugin builds; see
// specs/001-ultradox-num-parity/contracts/tmdb-api.md).
const TMDB_BASE = 'https://api.themoviedb.org/3/';
ROUTES.set(TMDB_BASE + 'search/tv?api_key=test-key&query=Show%20Name&language=ru&first_air_date_year=2021', JSON.stringify({ success: true, results: [{ id: 1, name: 'Show Name', first_air_date: '2021-01-15', vote_average: 8.7 }] }));
ROUTES.set(TMDB_BASE + 'search/tv?api_key=test-key&query=Show%20Name&language=ru', JSON.stringify({ success: true, results: [{ id: 1, name: 'Show Name', first_air_date: '2021-01-15', vote_average: 8.7 }] }));
ROUTES.set(TMDB_BASE + 'search/movie?api_key=test-key&query=Great%20Movie&language=ru', JSON.stringify({ success: true, results: [{ id: 2, title: 'Great Movie', release_date: '2023-05-10', vote_average: 7.9 }] }));
ROUTES.set(TMDB_BASE + 'search/movie?api_key=test-key&query=Missing&language=ru', JSON.stringify({ success: true, results: [] }));
ROUTES.set(TMDB_BASE + 'search/movie?api_key=test-key&query=No%20Fanart&language=ru', JSON.stringify({ success: true, results: [] }));
ROUTES.set(TMDB_BASE + 'tv/1?api_key=test-key&language=ru', JSON.stringify({ success: true, status: 'Returning Series', release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'TV-14' }] }] } }));
ROUTES.set(TMDB_BASE + 'movie/2?api_key=test-key&language=ru', JSON.stringify({ success: true, status: 'Released', release_dates: { results: [{ iso_3166_1: 'US', release_dates: [{ certification: 'PG-13' }] }] } }));

// ---------- Lampa mock ----------
const fetches = [];
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
    Template: { calls: [], lastParams: null, js(name, params) {
        this.lastParams = params || null;
        const c = makeEl('card');
        ['card__title', 'card__age', 'card__view'].forEach((cls) => {
            const ch = makeEl('div'); ch.classes.add(cls); c.children.push(ch);
        });
        const img = makeEl('img'); img.classes.add('card__img'); c.children.push(img);
        // Mirror the real Template.js replaceVars(): substitute {title} /
        // {release_year} into the text nodes (an empty value leaves the
        // element present with empty text).
        if (params) {
            const t = c.children.find((x) => x.classes.has('card__title'));
            const a = c.children.find((x) => x.classes.has('card__age'));
            if (t) t.text(params.title !== undefined && params.title !== null ? String(params.title) : '');
            if (a) a.text(params.release_year !== undefined && params.release_year !== null ? String(params.release_year) : '');
        }
        L.Template.calls.push(c);
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
    TMDB: {
        key() { return 'test-key'; },
        api(u) { return 'https://api.themoviedb.org/3/' + u; }
    },
    // Guard: any call to Torrent.start throws AND is counted; the test passes
    // only while the counter stays at zero.
    Torrent: { calls: 0, start() { this.calls++; throw new Error('L.Torrent.start is forbidden in this stage'); } },
    Reguest: class {
        timeout() {}
        native(url, ok, err) {
            fetches.push(url);
            const h = ROUTES.get(url);
            if (h !== undefined) ok(h);
            else err(new Error('no route: ' + url));
        }
    }
};

globalThis.window = { Lampa: L, appready: true, plugin_ultradox_ready: false };
globalThis.Lampa = L; // in the browser window.Lampa is the global binding
globalThis.document = { addEventListener() {}, createElement: (t) => makeEl(t) };
globalThis.$ = (arg) => (typeof arg === 'string' ? asQuery(parseHtml(arg)) : (arg && arg.tagName ? asQuery([arg]) : arg));
globalThis.atob = (s) => Buffer.from(s, 'base64').toString('binary');

console.log('boot: loading plugin source');
vm.runInThisContext(src, { filename: 'ultradox.js' });
check('boot: ultradox_full component registered', typeof L.Component.get('ultradox_full') === 'function');
check('boot: ultradox component registered', typeof L.Component.get('ultradox') === 'function');

// ---------- 5. catalog card smoke (the card -> FullPage transition must survive) ----------
console.log('catalog: card render + navigation');
const Comp = L.Component.get('ultradox');
const cat = new Comp({ category: 'serial' });
cat.activity = { loader() {}, toggle() {} };
cat.create();

check('catalog: exactly one card rendered', L.Template.calls.length === 1);
const card = L.Template.calls[0];
check('catalog: card title (trailing year stripped)', card && card.find('.card__title').text() === 'Show Name', card && card.find('.card__title').text());
check('catalog: long-press playback trigger removed', card && !card.handlers['hover:long']);
card.handlers['hover:focus'].forEach((f) => f());
check('catalog: hover:focus does not throw', true);
card.handlers['hover:enter'].forEach((f) => f());
const pushed = L.Activity.pushes[L.Activity.pushes.length - 1];
check('catalog: enter opens FullPage with item', pushed && pushed.component === 'ultradox_full' && pushed.item && pushed.item.itemUrl === SERIES_URL);
check('catalog: no Torrent.start', L.Torrent.calls === 0);

// ---------- NUM-parity card: badges + year + rating ----------
check('catalog: release_year under the title', L.Template.lastParams && L.Template.lastParams.release_year === '2021', JSON.stringify(L.Template.lastParams));
check('catalog: type badge top-left', findAll(card, 'udx-kind').length === 1 && card.find('.udx-kind').text() === 'Серіал', findAll(card, 'udx-kind').length + ':' + txt(card, '.udx-kind'));
check('catalog: quality chip only for real quality tokens', card.find('.udx-chip') === null, String(card.find('.udx-chip')));
check('catalog: TMDB rating badge bottom-right', findAll(card, 'udx-rate').length === 1 && card.find('.udx-rate').text() === '8.7', findAll(card, 'udx-rate').length + ':' + txt(card, '.udx-rate'));

// ---------- card grid contract: chip containment, single quality, year line, stable title ----------
console.log('card grid: chip/year/title contracts');

const movieSearch = (t) => TMDB_BASE + 'search/movie?api_key=test-key&query=' + encodeURIComponent(t) + '&language=ru';
ROUTES.set(movieSearch('Черновик, написанный кровью'), '{"success":true,"results":[]}');
ROUTES.set(movieSearch('Любитель акул встречает девушку'), '{"success":true,"results":[]}');
ROUTES.set(movieSearch('Тайны больницы Милосердия'), '{"success":true,"results":[]}');
ROUTES.set(TMDB_BASE + 'search/tv?api_key=test-key&query=' + encodeURIComponent('Американский заложник') + '&language=ru', '{"success":true,"results":[]}');

function appendItem(o) {
    cat.appendCard(Object.assign({ title: '', serial: false, type: '', itemUrl: '', poster: '', size: '', year: '' }, o));
    return L.Template.calls[L.Template.calls.length - 1];
}

function inPoster(elCard, cls) {
    const e = elCard.find('.' + cls);
    const v = elCard.find('.card__view');
    return !!(e && v && e._parent === v);
}

// real /hd/ film row: long title with (YYYY), raw quality "WEB-DL/WEB-DLRip"
const filmCard = appendItem({ title: 'Черновик, написанный кровью (2024)', serial: false, itemUrl: 'https://045.ultradox.click/hd/x-1.html', poster: 'https://045.ultradox.click/upload/a.jpg', type: 'WEB-DL/WEB-DLRip', year: '2024' });
check('grid: exactly one .udx-kind ("Фільм")', findAll(filmCard, 'udx-kind').length === 1 && filmCard.find('.udx-kind').text() === 'Фільм', findAll(filmCard, 'udx-kind').length + ':' + txt(filmCard, '.udx-kind'));
check('grid: kind chip is a child of .card__view (poster container)', inPoster(filmCard, 'udx-kind'), 'not in poster container');
check('grid: at most one quality chip with a single token (no slash/repeats)', findAll(filmCard, 'udx-chip').length === 1 && findAll(filmCard, 'udx-chip__quality').length === 1 && filmCard.find('.udx-chip__quality').text() === 'WEB-DL', findAll(filmCard, 'udx-chip').length + ':' + txt(filmCard, '.udx-chip__quality'));
check('grid: quality chip is a child of .card__view (poster container)', inPoster(filmCard, 'udx-chip'), 'not in poster container');
check('grid: year rendered at most once across title+age line', (function () { const t = filmCard.find('.card__title').text() + ' ' + filmCard.find('.card__age').text(); return (t.match(/\b(19|20)\d{2}\b/g) || []).length <= 1; })(), 'year count > 1');
check('grid: age line present and holds the year', findAll(filmCard, 'card__age').length === 1 && filmCard.find('.card__age').text() === '2024', txt(filmCard, '.card__age'));

// /serial-hd/ series: title has no (YYYY) -> no fabricated year, reserved empty line
const serialCard = appendItem({ title: 'Американский заложник (1 сезон)', serial: true, itemUrl: 'https://045.ultradox.click/serial-hd/56755-zhivoj-2-sezon.html', poster: 'https://045.ultradox.click/upload/b.jpg', type: 'WEB-DL/WEB-DLRip' });
check('grid: /serial-hd/ item labeled "Серіал"', findAll(serialCard, 'udx-kind').length === 1 && serialCard.find('.udx-kind').text() === 'Серіал', findAll(serialCard, 'udx-kind').length + ':' + txt(serialCard, '.udx-kind'));
check('grid: no year in data -> empty reserved age row (not removed)', findAll(serialCard, 'card__age').length === 1 && serialCard.find('.card__age').text() === '', String(findAll(serialCard, 'card__age').length) + ':' + JSON.stringify(txt(serialCard, '.card__age')));
check('grid: no fabricated year anywhere on the card', !/\b(19|20)\d{2}\b/.test(serialCard.find('.card__title').text() + ' ' + serialCard.find('.card__age').text()), 'year found');

// undetermined type -> no kind chip; quality still a single real token
const unknownCard = appendItem({ title: 'Тайны больницы Милосердия', itemUrl: 'https://045.ultradox.click/page/1/', type: 'HDTVRip 1080p' });
check('grid: undetermined type -> no kind chip', unknownCard.find('.udx-kind') === null, String(unknownCard.find('.udx-kind')));
check('grid: quality token HDTVRIP (single, upper)', findAll(unknownCard, 'udx-chip__quality').length === 1 && unknownCard.find('.udx-chip__quality').text() === 'HDTVRIP', txt(unknownCard, '.udx-chip__quality'));

// /film/ item without a type word: label from the section, no quality chip
const sharkCard = appendItem({ title: 'Любитель акул встречает девушку', itemUrl: 'https://045.ultradox.click/film/l-1.html', poster: 'https://045.ultradox.click/upload/c.jpg' });
check('grid: /film/ item labeled "Фільм" without a type word', findAll(sharkCard, 'udx-kind').length === 1 && sharkCard.find('.udx-kind').text() === 'Фільм', findAll(sharkCard, 'udx-kind').length + ':' + txt(sharkCard, '.udx-kind'));
check('grid: no quality in data -> no quality chip', sharkCard.find('.udx-chip') === null, String(sharkCard.find('.udx-chip')));

// static CSS contract (the plugin owns its card geometry; core CSS untouched)
check('css: .card__view self-contained (position:relative + overflow:hidden)', /\.udx-content \.card__view\{[^}]*position:relative[^}]*overflow:hidden/.test(src), 'missing containment rule');
check('css: title clamped to two lines with a reserved title area', /\.udx-content \.card__title\{[^}]*-webkit-line-clamp:2[^}]*min-height:2\.5em/.test(src), 'missing clamp rule');
check('css: year/age line reserved on every card', /\.udx-content \.card__age\{[^}]*min-height:1\.4em/.test(src), 'missing reserved line rule');
check('css: no dead second kind-chip implementation (.udx-chip__kind)', src.indexOf('.udx-chip__kind') === -1, 'dead selector present');

// ---------- 2/3/4. FullPage: detail build + series release selection ----------
// The exact Shield crash case: an item WITH a poster (item.poster truthy), so
// build() took the poster branch that crashed on poster[0].src.
console.log('fullpage: series detail + release selection');
const FP = L.Component.get('ultradox_full');
const series = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: 'https://045.ultradox.click/upload/show.jpg' } });
series.activity = { loader() {}, toggle() {} };
let buildErr = null;
try { series.create(); } catch (e) { buildErr = e; }
check('fullpage: build() completed without TypeError (Shield crash case)', buildErr === null, buildErr && buildErr.constructor.name + ': ' + buildErr.message);

const sh = series.render();
check('fullpage: title text (year suffix stripped)', sh.find('.udxf__title').text() === 'Show Name', txt(sh, '.udxf__title'));
check('fullpage: exactly one backdrop element', findAll(sh, 'udxf__backdrop').length === 1, String(findAll(sh, 'udxf__backdrop').length));
check('fullpage: backdrop image set', sh.find('.udxf__backdrop').style.backgroundImage === 'url("https://045.ultradox.click/upload/show-fanart.jpg")', sh.find('.udxf__backdrop') ? sh.find('.udxf__backdrop').style.backgroundImage : 'no backdrop element');
check('fullpage: backdrop visible', sh.find('.udxf__backdrop').classes.has('udxf__backdrop--on'));
check('fullpage: poster src equals the expected URL', sh.find('.udxf__poster') && sh.find('.udxf__poster').src === 'https://045.ultradox.click/upload/show.jpg', sh.find('.udxf__poster') ? sh.find('.udxf__poster').src : 'no poster element');
check('fullpage: top line', sh.find('.udxf__top').text() === 'США • 2021', txt(sh, '.udxf__top'));
check('fullpage: meta line', sh.find('.udxf__line').text() === 'Детектив, Драма • 45 мин. • Многоголосый', txt(sh, '.udxf__line'));
check('fullpage: overview (technical tail cut)', sh.find('.udxf__overview').text() === 'Детективний серіал про агентку.');
check('fullpage: watch button present with label', sh.find('.udx-f__play') !== null && sh.find('.udx-f__play').text() === 'Дивитися', txt(sh, '.udx-f__play'));
check('fullpage: TMDB rating line (value + cert + status)', findAll(sh, 'udxf__rating').length === 1 && sh.find('.udxf__rating').text() === 'TMDB 8.7 • TV-14 • Returning Series', txt(sh, '.udxf__rating'));

series.showReleases();
let sel = L.Select.last;
check('fullpage: selector titled by item', sel && sel.title === 'Show Name (2021)');
check('fullpage: two real releases listed', sel && sel.items.length === 2, sel && String(sel.items.length));
check('fullpage: release 1 label+size as UI data', sel && sel.items[0].title === 'С01.01 WEB-DLRIP 1080P • 10 GB', sel && sel.items[0].title);
check('fullpage: release 1 magnet kept as UI data', sel && /^magnet:\?xt=urn:btih:0123456789abcdef/.test(sel.items[0].id.magnet));
check('fullpage: release 2 label+size as UI data', sel && sel.items[1].title === 'С01.02 WEB-DLRIP 1080P • 10 GB', sel && sel.items[1].title);

let toggles = L.Controller.toggles.content || 0;
let noties = L.Noty.msgs.length;
sel.onSelect(sel.items[0]);
check('fullpage: series select closes selector (content toggle)', (L.Controller.toggles.content || 0) === toggles + 1);
check('fullpage: series select confirmation shown', L.Noty.msgs[L.Noty.msgs.length - 1] === L.Lang.translate('ultradox_release_selected'), L.Noty.msgs[L.Noty.msgs.length - 1]);
check('fullpage: series select did not start a torrent', L.Torrent.calls === 0);

series.showReleases();
toggles = L.Controller.toggles.content || 0;
noties = L.Noty.msgs.length;
L.Select.last.onBack();
check('fullpage: onBack closes selector too', (L.Controller.toggles.content || 0) === toggles + 1 && L.Noty.msgs.length === noties);

// ---------- 2/3/4. FullPage: film release selection ----------
console.log('fullpage: film detail + release selection');
const film = new FP({ item: { title: 'Great Movie (2023)', serial: false, itemUrl: FILM_URL, poster: '' } });
film.activity = { loader() {}, toggle() {} };
film.create();

const fm = film.render();
check('fullpage(film): top line', fm.find('.udxf__top').text() === 'Франція • 2023', txt(fm, '.udxf__top'));
check('fullpage(film): overview', fm.find('.udxf__overview').text() === 'Епічна історія космічної одесьи.');
check('fullpage(film): no poster -> element removed (no undefined src)', findAll(fm, 'udxf__poster').length === 0, String(findAll(fm, 'udxf__poster').length));
check('fullpage(film): TMDB rating line', findAll(fm, 'udxf__rating').length === 1 && fm.find('.udxf__rating').text() === 'TMDB 7.9 • PG-13 • Released', txt(fm, '.udxf__rating'));
check('fullpage(film): valid backdrop set exactly once (no duplicate node)', findAll(fm, 'udxf__backdrop').length === 1 && fm.find('.udxf__backdrop').style.backgroundImage === 'url("https://045.ultradox.click/upload/movie-fanart.jpg")' && fm.find('.udxf__backdrop').classes.has('udxf__backdrop--on'), fm.find('.udxf__backdrop') ? fm.find('.udxf__backdrop').style.backgroundImage : 'no backdrop element');

film.showReleases();
sel = L.Select.last;
check('fullpage(film): one real release listed', sel && sel.items.length === 1, sel && String(sel.items.length));
check('fullpage(film): release label+size as UI data', sel && sel.items[0].title === 'WEB-DL 2160P • 20 GB', sel && sel.items[0].title);
check('fullpage(film): magnet kept as UI data', sel && /^magnet:\?xt=urn:btih:aaaa1111bbbb2222/.test(sel.items[0].id.magnet));

toggles = L.Controller.toggles.content || 0;
sel.onSelect(sel.items[0]);
check('fullpage(film): select closes selector (content toggle)', (L.Controller.toggles.content || 0) === toggles + 1);
check('fullpage(film): confirmation shown', L.Noty.msgs[L.Noty.msgs.length - 1] === L.Lang.translate('ultradox_release_selected'));
check('fullpage(film): did not start a torrent', L.Torrent.calls === 0);

// ---------- FullPage: missing backdrop -> stable neutral fallback ----------
console.log('fullpage: missing backdrop fallback');
const NOBG_URL = 'https://045.ultradox.click/film/no-fanart-2020/';
ROUTES.set(NOBG_URL,
    '<html><head></head><body><ul>' +
    '<li><span>Жанр:</span> Трилер</li>' +
    '<li itemprop="contributor"><span> Страна: </span> Німеччина</li>' +
    '<li><span>Год:</span> 2020</li>' +
    '</ul>' +
    '<a href="magnet:?xt=urn:btih:beefcafebeefcafebeefcafebeefcafebeefcafe&amp;dn=No.Fanart.2020.mkv"></a>' +
    '</body></html>');
const nobg = new FP({ item: { title: 'No Fanart (2020)', serial: false, itemUrl: NOBG_URL, poster: '' } });
nobg.activity = { loader() {}, toggle() {} };
let nobgErr = null;
try { nobg.create(); } catch (e) { nobgErr = e; }
const nf = nobg.render();
check('fullpage(no backdrop): build() did not throw', nobgErr === null, nobgErr && nobgErr.constructor.name + ': ' + nobgErr.message);
check('fullpage(no backdrop): element present but stays off (neutral fallback)', nf.find('.udxf__backdrop') !== null && !nf.find('.udxf__backdrop').classes.has('udxf__backdrop--on') && nf.find('.udxf__backdrop').style.backgroundImage === undefined);
check('fullpage(no backdrop): no undefined/broken image left', (function () {
    const imgs = [];
    (function walk(n) { for (const c of n.children || []) { if (c && c.tagName === 'IMG') imgs.push(c); if (c && c.children) walk(c); } })(nf);
    return imgs.every((i) => typeof i.src === 'string' && i.src.length > 0);
})());
check('fullpage(no backdrop): detail still shows title and meta', nf.find('.udxf__title').text() === 'No Fanart' && nf.find('.udxf__line').text() === 'Трилер', txt(nf, '.udxf__line'));
check('fullpage(no backdrop): no torrent started', L.Torrent.calls === 0);

// ---------- FullPage: confirmed pixhost "Picture removed" placeholder (real Shield case) ----------
// The live detail page of "Любитель акул встречает девушку" carries this og:image;
// the host answers 302 -> https://pixhost.cc/image/removed.png ("Picture removed"),
// which the old URL-only check accepted and stretched over the whole screen.
console.log('fullpage: pixhost removed-image placeholder rejected');
const SHARK_URL = 'https://045.ultradox.click/nerufilm/58717-ljubitel-akul-vstrechaet-devushku-2025.html';
ROUTES.set(SHARK_URL,
    '<html><head>' +
    '<meta name="description" content="Детектив про любителля акул.">' +
    '<meta property="og:image" content="https://t3.pixhost.cc/6852/796602997_shark-boy-meets-girl-2025-pk-web-dlrip-avi_20261101_110746-311.jpg">' +
    '</head><body><ul>' +
    '<li><span>Жанр:</span> Детектив</li>' +
    '<li itemprop="contributor"><span> Страна: </span> США</li>' +
    '<li><span>Год:</span> 2025</li>' +
    '</ul>' +
    '<a href="magnet:?xt=urn:btih:deadbeefdeadbeefdeadbeefdeadbeefdeadbeef&amp;dn=Shark.Boy.Meets.Girl.2025.WEB-DLRip.mkv&amp;xl=7340032000"></a>' +
    '</body></html>');
const shark = new FP({ item: { title: 'Любитель акул встречает девушку (2025)', serial: false, itemUrl: SHARK_URL, poster: 'https://045.ultradox.click/upload/c.jpg' } });
shark.activity = { loader() {}, toggle() {} };
let sharkErr = null;
try { shark.create(); } catch (e) { sharkErr = e; }
const sp = shark.render();
check('fullpage(pixhost): build() did not throw', sharkErr === null, sharkErr && sharkErr.constructor.name + ': ' + sharkErr.message);
check('fullpage(pixhost): placeholder URL not applied to .udxf__backdrop', sp.find('.udxf__backdrop') !== null && sp.find('.udxf__backdrop').style.backgroundImage === undefined, sp.find('.udxf__backdrop') ? String(sp.find('.udxf__backdrop').style.backgroundImage) : 'no backdrop element');
check('fullpage(pixhost): backdrop stays off (neutral gradient fallback)', !sp.find('.udxf__backdrop').classes.has('udxf__backdrop--on'));
check('fullpage(pixhost): exactly one backdrop element (no second node)', findAll(sp, 'udxf__backdrop').length === 1, String(findAll(sp, 'udxf__backdrop').length));
check('fullpage(pixhost): poster kept', sp.find('.udxf__poster') && sp.find('.udxf__poster').src === 'https://045.ultradox.click/upload/c.jpg', sp.find('.udxf__poster') ? sp.find('.udxf__poster').src : 'no poster element');
check('fullpage(pixhost): title kept', txt(sp, '.udxf__title') === 'Любитель акул встречает девушку', txt(sp, '.udxf__title'));
check('fullpage(pixhost): overview kept', txt(sp, '.udxf__overview') === 'Детектив про любителля акул.', txt(sp, '.udxf__overview'));
check('fullpage(pixhost): watch button kept', sp.find('.udx-f__play') !== null && sp.find('.udx-f__play').text() === 'Дивитися', txt(sp, '.udx-f__play'));
shark.showReleases();
sel = L.Select.last;
check('fullpage(pixhost): release listed without execution', sel && sel.items.length === 1 && /^magnet:\?xt=urn:btih:deadbeef/.test(sel.items[0].id.magnet) && L.Torrent.calls === 0, sel && JSON.stringify(sel.items.map((i) => i.title)));

// ---------- empty detail: no releases -> noty, selector untouched ----------
console.log('fullpage: empty detail');
const missing = new FP({ item: { title: 'Missing (1999)', serial: false, itemUrl: 'https://045.ultradox.click/serial/missing-1999/', poster: '' } });
missing.activity = { loader() {}, toggle() {} };
missing.create();
const selBefore = L.Select.last;
missing.showReleases();
check('fullpage: no releases -> noty, no new selector', L.Select.last === selBefore && L.Noty.msgs[L.Noty.msgs.length - 1] === L.Lang.translate('ultradox_no_link'));
check('fullpage: no TMDB match -> rating line hidden', missing.render().find('.udxf__rating') === null, String(missing.render().find('.udxf__rating')));

// ---------- TMDB cache: a repeated work must not refetch ----------
console.log('tmdb cache: repeated work does not refetch');
const tmdbFetchesBefore = fetches.filter((u) => u.indexOf('https://api.themoviedb.org/') === 0).length;
const series2 = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: '' } });
series2.activity = { loader() {}, toggle() {} };
series2.create();
const tmdbFetchesAfter = fetches.filter((u) => u.indexOf('https://api.themoviedb.org/') === 0).length;
check('tmdb: repeated work uses cache (no new requests)', tmdbFetchesAfter === tmdbFetchesBefore, tmdbFetchesBefore + ' -> ' + tmdbFetchesAfter);
check('tmdb: repeated detail rating line still correct', txt(series2.render(), '.udxf__rating') === 'TMDB 8.7 • TV-14 • Returning Series', txt(series2.render(), '.udxf__rating'));

// ---------- 6. network: public mirrors only ----------
check('network: only public mirrors + TMDB API requested', fetches.every((u) => MIRRORS.some((m) => u.indexOf(m) === 0) || u.indexOf('https://api.themoviedb.org/') === 0), JSON.stringify(fetches));

// ---------- final verdict ----------
check('torrent: L.Torrent.start counter is zero', L.Torrent.calls === 0);
console.log(failures ? 'FAIL (' + failures + ' check(s) failed)' : 'PASS');
process.exitCode = failures ? 1 : 0;
