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
//      playRelease tokens remain (no executable playback path left) and no
//      executable external-metadata tokens remain (no core metadata object
//      access, no external API host, no key parameter, no request helpers).
//   2. The detail page builds from the fetched page: backdrop, title, metadata
//      lines, overview; the real release list keeps label/size/magnet as UI data.
//   3. Selecting a series release and a film release closes the selector
//      (content controller toggle) and shows a short confirmation via L.Noty.
//   4. L.Torrent.start is NEVER called: the mock throws on any call AND a
//      counter must stay at zero for this test to PASS.
//   5. Catalog card still renders and opens the FullPage on hover:enter; the
//      old long-press playback trigger (hover:long) is gone.
//   6. All network fetches go to the public mirrors only (no external metadata
//      service, no TorrServer/LAN); the core metadata object is never touched.
//   7. NUM-parity card: type badge top-left (.udx-kind), year under the title
//      (release_year; the age row is removed when there is no year — no empty
//      row rendered); no rating element is rendered on the card at all.
//   8. Detail page carries no rating row (no rating markup left); a page
//      rating GIF without a text value produces no rating text.
//   9. Detail action strip: the old single "Дивитися" button is gone; exactly
//      one quality selector + one "Торенти" button; both open the same existing
//      release selector; a chosen release's normalized quality shows on the left
//      button (in-memory only); re-opening does not duplicate strip/listeners;
//      an empty release list keeps the placeholder and shows the existing message.
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

// ---------- 1. static scan: no executable launch / external-metadata tokens left ----------
for (const token of [/(?:L\.)?Torrent\.start/, /MagnetUri/, /playRelease/, /chooseFile/, /hover:long/, /window\.Lampa\.TMDB/, /L\.TMDB/, /Tmdb\./, /tmdbKey/, /tmdbGet/, /api\.themoviedb\.org/, /api_key=/]) {
    check('static: source has no ' + token, !token.test(src));
}
check('static: old single "Дивитися" button markup is gone', src.indexOf('.udx-f__play') === -1, '.udx-f__play still in source');
check('static: old watch lang key removed', src.indexOf('ultradox_watch') === -1, 'ultradox_watch still in source');
check('static: no play-triangle glyph introduced in the action strip', src.indexOf('polygon') === -1 && /svg/.test(src) && src.indexOf('ICON_QUALITY') !== -1 && src.indexOf('ICON_RELEASES') !== -1, 'unexpected icon markup');

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

// Full subtree text (assertion helper; the plugin itself never needs it).
function allText(node) {
    let out = node._text || '';
    for (const c of node.children || []) out += ' ' + allText(c);
    return out;
}

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
    '<li itemprop="director"><span>Режиссерский состав:</span> Кацуо Фукудзава, Акико Като, Ёхэй Миядзаки</li>' +
    '<li itemprop="actor"><span>В Ролях:</span> Сакай Масато, Абэ Хироси, Никайдо Фуми, Ниномия Кадзунари, Тори Мацузака, Рё Рюсэй, Кенто Хаяси, Рин Таканаси, Рей Дан, Кодзи Якушо</li>' +
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
    '<li itemprop="director"><span>Режиссерский состав:</span> Мар Олид</li>' +
    '<li itemprop="actor"><span>В Ролях:</span> Кира Миро, Сальва Рейна, Луна Фульхенсио, Ян Кортегосо, Адриана Биде, Антонио Пагудо, Марта Хазас</li>' +
    '</ul>' +
    '<div class="full-story__ratings"><p><img src="https://www.kinopoisk.ru/rating/6588327.gif" alt="Great Movie"></p></div>' +
    '<a href="magnet:?xt=urn:btih:aaaa1111bbbb2222cccc3333dddd4444eeee5555&amp;dn=Great.Movie.2023.2160p.WEB-DL.H265.mkv&amp;xl=21474836480"></a>' +
    '</body></html>';

const ROUTES = new Map([
    ['https://045.ultradox.click/serial/', CATALOG_HTML],
    [SERIES_URL, SERIES_HTML],
    [FILM_URL, FILM_HTML]
]);

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
            const ch = makeEl('div'); ch.classes.add(cls); ch._setParent(c); c.children.push(ch);
        });
        const img = makeEl('img'); img.classes.add('card__img'); img._setParent(c); c.children.push(img);
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
    // Guard: any access to the core metadata object throws AND is counted;
    // the test passes only while the counter stays at zero.
    TMDB: { touches: 0, key() { this.touches++; throw new Error('core metadata key access is forbidden in this stage'); }, api(u) { this.touches++; throw new Error('core metadata api access is forbidden in this stage'); } },
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

// Image preload mock: setting src never auto-loads; the test fires
// _fireLoad()/_fireError() explicitly to control async ordering (race guard).
const images = [];
globalThis.Image = class {
    constructor() { this._src = ''; images.push(this); }
    get src() { return this._src; }
    set src(v) { this._src = String(v); }
    _fireLoad() { if (this.onload) this.onload(); }
    _fireError() { if (this.onerror) this.onerror(); }
};

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
check('catalog: no rating element rendered on the card (external ratings removed)', findAll(card, 'udx-rate').length === 0 && card.find('.udx-rate') === null, String(findAll(card, 'udx-rate').length));

// ---------- card grid contract: chip containment, single quality, year line, stable title ----------
console.log('card grid: chip/year/title contracts');

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
check('grid: movie з роком показує рік один раз', (function () { const t = filmCard.find('.card__title').text() + ' ' + filmCard.find('.card__age').text(); return (t.match(/\b(19|20)\d{2}\b/g) || []).length === 1; })(), 'year count != 1');
check('grid: age line present and holds the year', findAll(filmCard, 'card__age').length === 1 && filmCard.find('.card__age').text() === '2024', txt(filmCard, '.card__age'));

// Serial whose LIST title really carries (YYYY) — the only way parse() fills
// item.year (it reads the year out of the list title). The age line carries
// it, shown exactly once; same contract as a film card. No invented year.
const serialYearCard = appendItem({ title: 'Вивант (2025)', serial: true, itemUrl: 'https://045.ultradox.click/serial-hd/56756-vivant-2-sezon.html', poster: 'https://045.ultradox.click/upload/d.jpg', type: 'WEB-DL/WEB-DLRip', year: '2025' });
check('grid: serial із роком у list-назві показує рік один раз', (function () { const t = serialYearCard.find('.card__title').text() + ' ' + serialYearCard.find('.card__age').text(); return (t.match(/\b(19|20)\d{2}\b/g) || []).length === 1; })(), 'year count != 1');
check('grid: serial year held by the age line, title stripped', serialYearCard.find('.card__age').text() === '2025' && serialYearCard.find('.card__title').text() === 'Вивант', txt(serialYearCard, '.card__age') + ' / ' + txt(serialYearCard, '.card__title'));
check('grid: serial-with-year labeled "Серіал", no "Фільм" text', findAll(serialYearCard, 'udx-kind').length === 1 && serialYearCard.find('.udx-kind').text() === 'Серіал' && !/Фільм/.test(allText(serialYearCard)), findAll(serialYearCard, 'udx-kind').length + ':' + txt(serialYearCard, '.udx-kind'));

// /serial-hd/ series without a year: the year row is not rendered at all
// (element removed, not an empty reserved line); no fabricated year
const serialCard = appendItem({ title: 'Американский заложник (1 сезон)', serial: true, itemUrl: 'https://045.ultradox.click/serial-hd/56755-zhivoj-2-sezon.html', poster: 'https://045.ultradox.click/upload/b.jpg', type: 'WEB-DL/WEB-DLRip' });
check('grid: /serial-hd/ item labeled "Серіал"', findAll(serialCard, 'udx-kind').length === 1 && serialCard.find('.udx-kind').text() === 'Серіал', findAll(serialCard, 'udx-kind').length + ':' + txt(serialCard, '.udx-kind'));
check('grid: serial card carries no "Фільм" text anywhere', !/Фільм/.test(allText(serialCard)), allText(serialCard));
check('grid: serial без року не рендерить порожній year-row', findAll(serialCard, 'card__age').length === 0 && serialCard.find('.card__age') === null, String(findAll(serialCard, 'card__age').length));
check('grid: no fabricated year anywhere on the card', !/\b(19|20)\d{2}\b/.test(allText(serialCard)), 'year found');
check('grid: yearless card keeps chips, title and focus/enter handlers intact', serialCard.find('.udx-kind').text() === 'Серіал' && findAll(serialCard, 'udx-chip__quality').length === 1 && serialCard.find('.udx-chip__quality').text() === 'WEB-DL' && serialCard.find('.card__title').text() === 'Американский заложник (1 сезон)' && !!serialCard.handlers['hover:focus'] && !!serialCard.handlers['hover:enter'], JSON.stringify({ chip: txt(serialCard, '.udx-chip__quality'), title: txt(serialCard, '.card__title'), focus: !!serialCard.handlers['hover:focus'], enter: !!serialCard.handlers['hover:enter'] }));

// undetermined type -> no kind chip; quality still a single real token
const unknownCard = appendItem({ title: 'Тайны больницы Милосердия', itemUrl: 'https://045.ultradox.click/page/1/', type: 'HDTVRip 1080p' });
check('grid: undetermined type -> no kind chip', unknownCard.find('.udx-kind') === null, String(unknownCard.find('.udx-kind')));
check('grid: quality token HDTVRIP (single, upper)', findAll(unknownCard, 'udx-chip__quality').length === 1 && unknownCard.find('.udx-chip__quality').text() === 'HDTVRIP', txt(unknownCard, '.udx-chip__quality'));

// /film/ item without a type word: label from the section, no quality chip
const sharkCard = appendItem({ title: 'Любитель акул встречает девушку', itemUrl: 'https://045.ultradox.click/film/l-1.html', poster: 'https://045.ultradox.click/upload/c.jpg' });
check('grid: /film/ item labeled "Фільм" without a type word', findAll(sharkCard, 'udx-kind').length === 1 && sharkCard.find('.udx-kind').text() === 'Фільм', findAll(sharkCard, 'udx-kind').length + ':' + txt(sharkCard, '.udx-kind'));
check('grid: no quality in data -> no quality chip', sharkCard.find('.udx-chip') === null, String(sharkCard.find('.udx-chip')));

// Real /hd//webrips/ card shape (the live film lists point every card at a
// /nerufilm/ detail page): that section must still yield the "Фільм" badge,
// the single quality token and the year exactly once.
const neruCard = appendItem({ title: 'Двойная игра (2026)', serial: false, itemUrl: 'https://045.ultradox.click/nerufilm/58680-dvojnaja-igra-2026.html', poster: 'https://045.ultradox.click/upload/e.jpg', type: 'BDRip/HDRip', year: '2026' });
check('grid: /nerufilm/ item (real film section) labeled "Фільм"', findAll(neruCard, 'udx-kind').length === 1 && neruCard.find('.udx-kind').text() === 'Фільм', findAll(neruCard, 'udx-kind').length + ':' + txt(neruCard, '.udx-kind'));
check('grid: /nerufilm/ item year shown exactly once under the title', (function () { const t = neruCard.find('.card__title').text() + ' ' + neruCard.find('.card__age').text(); return (t.match(/\b(19|20)\d{2}\b/g) || []).length === 1 && neruCard.find('.card__age').text() === '2026'; })(), txt(neruCard, '.card__age'));
check('grid: /nerufilm/ item quality chip is a single token (BDRIP)', findAll(neruCard, 'udx-chip__quality').length === 1 && neruCard.find('.udx-chip__quality').text() === 'BDRIP', txt(neruCard, '.udx-chip__quality'));

// static CSS contract (the plugin owns its card geometry; core CSS untouched)
check('css: .card__view self-contained (position:relative + overflow:hidden)', /\.udx-content \.card__view\{[^}]*position:relative[^}]*overflow:hidden/.test(src), 'missing containment rule');
check('css: title clamped to two lines with a reserved title area', /\.udx-content \.card__title\{[^}]*-webkit-line-clamp:2[^}]*min-height:2\.5em/.test(src), 'missing clamp rule');
check('css: age line keeps its reserved height when present', /\.udx-content \.card__age\{[^}]*min-height:1\.4em/.test(src), 'missing reserved line rule');
check('css: no dead second kind-chip implementation (.udx-chip__kind)', src.indexOf('.udx-chip__kind') === -1, 'dead selector present');
check('css: .udx-kind pinned inside the poster (left/top 10px, no negative offset) and clipped to it', /\.udx-kind\{position:absolute;left:10px;top:10px;[^}]*max-width:calc\(100% - 20px\);[^}]*overflow:hidden;[^}]*white-space:nowrap/.test(src), 'missing .udx-kind containment rule');
check('css: poster fallback modifier scales + blurs the backdrop node', /\.udxf__backdrop--poster\{[^}]*transform:scale\(1\.1\)[^}]*filter:blur\(22px\)[^}]*brightness\(\.72\)[^}]*saturate\(\.82\)/.test(src), 'missing .udxf__backdrop--poster rule');
check('css: catalog backdrop layers scale + blur + crossfade duration', /\.udx-bg\{[^}]*transform:scale\(1\.10\)[^}]*filter:blur\(20px\)[^}]*brightness\(\.55\)[^}]*saturate\(\.78\)[^}]*transition:opacity \.32s ease/.test(src), 'missing .udx-bg rule');
check('css: single permanent veil overlay (left+bottom gradients)', /\.udx-bg__veil\{[^}]*z-index:1[^}]*linear-gradient\(90deg,rgba\(6,28,41,\.78\),rgba\(6,28,41,\.30\) 60%\),linear-gradient\(to top,rgba\(6,28,41,\.70\),rgba\(6,28,41,0\) 42%\)/.test(src), 'missing .udx-bg__veil rule');

// ---------- catalog dynamic backdrop: two permanent layers + crossfade ----------
console.log('catalog backdrop: two-layer crossfade');
const croot = cat.render();
const bgAll = findAll(croot, 'udx-bg');
check('catbg: exactly two permanent background layers + one veil', bgAll.length === 2 && findAll(croot, 'udx-bg__veil').length === 1, bgAll.length + ':' + findAll(croot, 'udx-bg__veil').length);
check('catbg: start neutral (both layers off, no image set)', bgAll.every((l) => !l.classes.has('udx-bg--on') && l.style.backgroundImage === undefined));

// the catalog smoke hover:focus above already requested the first poster;
// nothing may be applied before its onload succeeds
check('catbg: first poster preloaded via Image, not applied before onload', images.length === 1 && images[0].src === 'https://045.ultradox.click/upload/show.jpg' && bgAll.every((l) => l.style.backgroundImage === undefined), images.map((i) => i.src).join('|'));

images[0]._fireLoad();
check('catbg: first valid poster activates exactly one layer', (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/show.jpg")';
})(), JSON.stringify(bgAll.map((l) => [String(l.classes), l.style.backgroundImage])));

const imgNext = images.length;
filmCard.handlers['hover:focus'].forEach((f) => f());
check('catbg: next poster preloads into the inactive layer, current stays', images.length === imgNext + 1 && images[imgNext].src === 'https://045.ultradox.click/upload/a.jpg' && (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/show.jpg")';
})(), images.map((i) => i.src).join('|'));

images[imgNext]._fireLoad();
check('catbg: crossfade swapped the active layer on the same two nodes', (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/a.jpg")' && findAll(croot, 'udx-bg').length === 2;
})(), JSON.stringify(bgAll.map((l) => [String(l.classes), l.style.backgroundImage])));

const imgSame = images.length;
filmCard.handlers['hover:focus'].forEach((f) => f());
check('catbg: same URL -> no new preload, no state change', images.length === imgSame && (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/a.jpg")';
})());

serialCard.handlers['hover:focus'].forEach((f) => f());
const staleImg = images[images.length - 1];
sharkCard.handlers['hover:focus'].forEach((f) => f());
const freshImg = images[images.length - 1];
staleImg._fireLoad();
check('catbg: stale onload ignored by the generation guard', staleImg.src === 'https://045.ultradox.click/upload/b.jpg' && (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/a.jpg")';
})(), staleImg.src);
freshImg._fireLoad();
check('catbg: newer poster lands after the stale one drops', (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/c.jpg")';
})(), JSON.stringify(bgAll.map((l) => [String(l.classes), l.style.backgroundImage])));

const imgNoPoster = images.length;
unknownCard.handlers['hover:focus'].forEach((f) => f());
check('catbg: missing poster -> current background untouched', images.length === imgNoPoster && (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/c.jpg")';
})());

serialCard.handlers['hover:focus'].forEach((f) => f());
const failImg = images[images.length - 1];
check('catbg: retry after a failed load preloads again', failImg.src === 'https://045.ultradox.click/upload/b.jpg', failImg.src);
failImg._fireError();
check('catbg: failed load does not erase the current background', (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/c.jpg")';
})());

const fetchesBeforeBg = fetches.length;
card.handlers['hover:focus'].forEach((f) => f());
check('catbg: hover:focus causes no fetch / loadMore / torrent', fetches.length === fetchesBeforeBg && L.Torrent.calls === 0, String(fetches.length - fetchesBeforeBg) + ' new fetches');

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
check('fullpage: poster fallback not active for a valid backdrop', !sh.find('.udxf__backdrop').classes.has('udxf__backdrop--poster'));
check('fullpage: poster src equals the expected URL', sh.find('.udxf__poster') && sh.find('.udxf__poster').src === 'https://045.ultradox.click/upload/show.jpg', sh.find('.udxf__poster') ? sh.find('.udxf__poster').src : 'no poster element');
check('fullpage: top line', sh.find('.udxf__top').text() === 'США • 2021', txt(sh, '.udxf__top'));
check('fullpage: meta line', sh.find('.udxf__line').text() === 'Детектив, Драма • 45 мин. • Многоголосый', txt(sh, '.udxf__line'));
check('fullpage: overview (technical tail cut)', sh.find('.udxf__overview').text() === 'Детективний серіал про агентку.');
check('fullpage: director line with the exact source value', txt(sh, '.udxf__fact--director') === 'Режисер: Кацуо Фукудзава, Акико Като, Ёхэй Миядзаки', txt(sh, '.udxf__fact--director'));
check('fullpage: cast line truncated to 5 names + neat ellipsis', txt(sh, '.udxf__fact--cast') === 'У ролях: Сакай Масато, Абэ Хироси, Никайдо Фуми, Ниномия Кадзунари, Тори Мацузака …', txt(sh, '.udxf__fact--cast'));
check('fullpage: fact rows rendered exactly once each', findAll(sh, 'udxf__fact--director').length === 1 && findAll(sh, 'udxf__fact--cast').length === 1, findAll(sh, 'udxf__fact--director').length + ':' + findAll(sh, 'udxf__fact--cast').length);
// ---------- detail action strip: two controls, one shared path ----------
check('fullpage: old single "Дивитися" button removed', sh.find('.udx-f__play') === null && findAll(sh, 'udx-f__play').length === 0, String(findAll(sh, 'udx-f__play').length));
check('fullpage: exactly one action strip after the facts', findAll(sh, 'udxf__actions').length === 1, String(findAll(sh, 'udxf__actions').length));
check('fullpage: exactly one quality selector and one "Торенти" button', findAll(sh, 'udxf__act--quality').length === 1 && findAll(sh, 'udxf__act--torrents').length === 1, findAll(sh, 'udxf__act--quality').length + ':' + findAll(sh, 'udxf__act--torrents').length);
const qBtn = sh.find('.udxf__act--quality');
const tBtn = sh.find('.udxf__act--torrents');
check('fullpage: quality selector shows the placeholder label first', qBtn !== null && qBtn.find('.udxf__act__label').text() === L.Lang.translate('ultradox_quality_pick'), qBtn ? qBtn.find('.udxf__act__label').text() : 'no button');
check('fullpage: "Торенти" button label', tBtn !== null && tBtn.find('.udxf__act__label').text() === L.Lang.translate('ultradox_torrents'), tBtn ? tBtn.find('.udxf__act__label').text() : 'no button');
check('fullpage: both controls wired to hover:enter exactly once', qBtn && tBtn && qBtn.handlers['hover:enter'] && tBtn.handlers['hover:enter'] && qBtn.handlers['hover:enter'].length === 1 && tBtn.handlers['hover:enter'].length === 1, JSON.stringify({ q: qBtn && qBtn.handlers['hover:enter'] && qBtn.handlers['hover:enter'].length, t: tBtn && tBtn.handlers['hover:enter'] && tBtn.handlers['hover:enter'].length }));
check('fullpage: no rating row in the detail page (no rating markup left)', findAll(sh, 'udxf__rating').length === 0 && sh.find('.udxf__rating') === null, String(findAll(sh, 'udxf__rating').length));

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
check('fullpage: selected quality appears on the left button', qBtn.find('.udxf__act__label').text() === 'WEB-DL 1080p', qBtn.find('.udxf__act__label').text());

series.showReleases();
toggles = L.Controller.toggles.content || 0;
noties = L.Noty.msgs.length;
L.Select.last.onBack();
check('fullpage: onBack closes selector too', (L.Controller.toggles.content || 0) === toggles + 1 && L.Noty.msgs.length === noties);

// ---------- action strip controls: both open the same existing selector ----------
console.log('fullpage: action strip controls');
L.Select.last = null;
qBtn.handlers['hover:enter'].forEach((f) => f());
const selFromQuality = L.Select.last;
check('strip: quality selector opens the existing release selector', !!selFromQuality && selFromQuality.title === 'Show Name (2021)' && selFromQuality.items.length === 2, selFromQuality ? selFromQuality.title + ':' + selFromQuality.items.length : 'no selector');
selFromQuality.onBack();

L.Select.last = null;
tBtn.handlers['hover:enter'].forEach((f) => f());
const selFromTorrents = L.Select.last;
check('strip: "Торенти" opens the same selector with the same releases', !!selFromTorrents && selFromTorrents.items.length === selFromQuality.items.length && selFromTorrents.items.every((it, i) => it.id === selFromQuality.items[i].id && it.title === selFromQuality.items[i].title), selFromTorrents ? JSON.stringify(selFromTorrents.items.map((i) => i.title)) : 'no selector');

// choosing the second release through the list: in-memory choice, label update
selFromTorrents.onSelect(selFromTorrents.items[1]);
check('strip: chosen release quality rendered on the left button', qBtn.find('.udxf__act__label').text() === 'WEB-DL 1080p', qBtn.find('.udxf__act__label').text());
check('strip: selection stays informational (no execution)', L.Torrent.calls === 0);

// re-opening through either control must not duplicate strip/controls/listeners
const stripCount = findAll(sh, 'udxf__actions').length;
const qCount = findAll(sh, 'udxf__act--quality').length;
const tCount = findAll(sh, 'udxf__act--torrents').length;
const qHandlers = qBtn.handlers['hover:enter'].length;
const tHandlers = tBtn.handlers['hover:enter'].length;
qBtn.handlers['hover:enter'].forEach((f) => f());
tBtn.handlers['hover:enter'].forEach((f) => f());
check('strip: re-opening does not duplicate strip, controls or listeners', findAll(sh, 'udxf__actions').length === stripCount && findAll(sh, 'udxf__act--quality').length === qCount && findAll(sh, 'udxf__act--torrents').length === tCount && qBtn.handlers['hover:enter'].length === qHandlers && tBtn.handlers['hover:enter'].length === tHandlers, JSON.stringify({ s: findAll(sh, 'udxf__actions').length, q: qCount, t: tCount, h: [qHandlers, tHandlers] }));
check('strip: quality label persists across re-opens', qBtn.find('.udxf__act__label').text() === 'WEB-DL 1080p', qBtn.find('.udxf__act__label').text());

// ---------- 2/3/4. FullPage: film release selection ----------
console.log('fullpage: film detail + release selection');
const film = new FP({ item: { title: 'Great Movie (2023)', serial: false, itemUrl: FILM_URL, poster: '' } });
film.activity = { loader() {}, toggle() {} };
film.create();

const fm = film.render();
check('fullpage(film): top line', fm.find('.udxf__top').text() === 'Франція • 2023', txt(fm, '.udxf__top'));
check('fullpage(film): overview', fm.find('.udxf__overview').text() === 'Епічна історія космічної одесьи.');
check('fullpage(film): director line (single name, no ellipsis)', txt(fm, '.udxf__fact--director') === 'Режисер: Мар Олид', txt(fm, '.udxf__fact--director'));
check('fullpage(film): cast line truncated to 5 names + neat ellipsis', txt(fm, '.udxf__fact--cast') === 'У ролях: Кира Миро, Сальва Рейна, Луна Фульхенсио, Ян Кортегосо, Адриана Биде …', txt(fm, '.udxf__fact--cast'));
check('fullpage(film): page rating gif produces no rating text (no value in HTML)', !/рейтинг/i.test(allText(fm)), allText(fm).slice(0, 160));
check('fullpage(film): no poster -> element removed (no undefined src)', findAll(fm, 'udxf__poster').length === 0, String(findAll(fm, 'udxf__poster').length));
check('fullpage(film): no rating row in the detail page (no rating markup left)', findAll(fm, 'udxf__rating').length === 0 && fm.find('.udxf__rating') === null, String(findAll(fm, 'udxf__rating').length));
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
check('fullpage(no backdrop): element present but stays off (neutral fallback)', nf.find('.udxf__backdrop') !== null && !nf.find('.udxf__backdrop').classes.has('udxf__backdrop--on') && !nf.find('.udxf__backdrop').classes.has('udxf__backdrop--poster') && nf.find('.udxf__backdrop').style.backgroundImage === undefined);
check('fullpage(no backdrop): no undefined/broken image left', (function () {
    const imgs = [];
    (function walk(n) { for (const c of n.children || []) { if (c && c.tagName === 'IMG') imgs.push(c); if (c && c.children) walk(c); } })(nf);
    return imgs.every((i) => typeof i.src === 'string' && i.src.length > 0);
})());
check('fullpage(no backdrop): detail still shows title and meta', nf.find('.udxf__title').text() === 'No Fanart' && nf.find('.udxf__line').text() === 'Трилер', txt(nf, '.udxf__line'));
check('fullpage(no facts): no fact rows or empty containers rendered', nf.find('.udxf__fact--director') === null && nf.find('.udxf__fact--cast') === null && findAll(nf, 'udxf__fact').length === 0, String(findAll(nf, 'udxf__fact').length));
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
check('fullpage(pixhost): placeholder URL not applied; poster URL set on the same single node', sp.find('.udxf__backdrop') !== null && /url\("https:\/\/045\.ultradox\.click\/upload\/c\.jpg"\)/.test(sp.find('.udxf__backdrop').style.backgroundImage) && sp.find('.udxf__backdrop').style.backgroundImage.indexOf('pixhost') === -1, sp.find('.udxf__backdrop') ? String(sp.find('.udxf__backdrop').style.backgroundImage) : 'no backdrop element');
check('fullpage(pixhost): only the poster fallback modifier applied', sp.find('.udxf__backdrop').classes.has('udxf__backdrop--poster') && !sp.find('.udxf__backdrop').classes.has('udxf__backdrop--on'));
check('fullpage(pixhost): exactly one backdrop element (no second node)', findAll(sp, 'udxf__backdrop').length === 1, String(findAll(sp, 'udxf__backdrop').length));
check('fullpage(pixhost): poster kept', sp.find('.udxf__poster') && sp.find('.udxf__poster').src === 'https://045.ultradox.click/upload/c.jpg', sp.find('.udxf__poster') ? sp.find('.udxf__poster').src : 'no poster element');
check('fullpage(pixhost): title kept', txt(sp, '.udxf__title') === 'Любитель акул встречает девушку', txt(sp, '.udxf__title'));
check('fullpage(pixhost): overview kept', txt(sp, '.udxf__overview') === 'Детектив про любителля акул.', txt(sp, '.udxf__overview'));
check('fullpage(pixhost): action strip kept (quality + "Торенти"), old button gone', sp.find('.udxf__act--quality') !== null && sp.find('.udxf__act--torrents') !== null && sp.find('.udx-f__play') === null, String(!!(sp.find('.udxf__act--quality') && sp.find('.udxf__act--torrents'))));
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
check('fullpage: rating row absent from the detail markup', missing.render().find('.udxf__rating') === null, String(missing.render().find('.udxf__rating')));
check('fullpage: failed fetch (empty model) -> no fact rows rendered', missing.render().find('.udxf__fact--director') === null && missing.render().find('.udxf__fact--cast') === null, String(findAll(missing.render(), 'udxf__fact').length));

// both strip controls on an empty release list: existing "no link" message,
// placeholder quality state kept, no selector, no error, no execution
const mRoot = missing.render();
const mQ = mRoot.find('.udxf__act--quality');
const mT = mRoot.find('.udxf__act--torrents');
let mErr = null;
try {
    const mNoties = L.Noty.msgs.length;
    mQ.handlers['hover:enter'].forEach((f) => f());
    mT.handlers['hover:enter'].forEach((f) => f());
    check('fullpage(empty): both controls show the existing "no link" message', L.Noty.msgs.length === mNoties + 2 && L.Noty.msgs[L.Noty.msgs.length - 1] === L.Lang.translate('ultradox_no_link'), String(L.Noty.msgs.length - mNoties));
    check('fullpage(empty): no selector opened from the strip', L.Select.last === selBefore, String(!!L.Select.last));
    check('fullpage(empty): quality state unchanged (placeholder kept)', mQ.find('.udxf__act__label').text() === L.Lang.translate('ultradox_quality_pick'), mQ.find('.udxf__act__label').text());
    check('fullpage(empty): no torrent started', L.Torrent.calls === 0);
} catch (e) { mErr = e; }
check('fullpage(empty): strip controls did not throw', mErr === null, mErr && mErr.constructor.name + ': ' + mErr.message);

// ---------- no external metadata transport: a repeated detail page fetches nothing beyond the mirror ----------
console.log('metadata: no external metadata transport');
const series2 = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: '' } });
series2.activity = { loader() {}, toggle() {} };
series2.create();
check('metadata: the core metadata object was never touched', L.TMDB.touches === 0, String(L.TMDB.touches));
check('metadata: repeated detail renders without a rating row', series2.render().find('.udxf__rating') === null, String(series2.render().find('.udxf__rating')));

// ---------- 6. network: public mirrors only ----------
check('network: only public mirrors requested (no external metadata service)', fetches.every((u) => MIRRORS.some((m) => u.indexOf(m) === 0)), JSON.stringify(fetches));

check('catbg: last valid catalog background survives the detail round-trip', (function () {
    const on = bgAll.filter((l) => l.classes.has('udx-bg--on'));
    return on.length === 1 && on[0].style.backgroundImage === 'url("https://045.ultradox.click/upload/c.jpg")';
})(), JSON.stringify(bgAll.map((l) => [String(l.classes), l.style.backgroundImage])));

// ---------- type badge under repeated focus: no duplicate, no shift ----------
for (const f of filmCard.handlers['hover:focus']) f();
for (const f of serialCard.handlers['hover:focus']) f();
for (const f of filmCard.handlers['hover:focus']) f();
for (const f of serialCard.handlers['hover:focus']) f();
check('grid: repeated focus does not duplicate the type badge', findAll(filmCard, 'udx-kind').length === 1 && findAll(serialCard, 'udx-kind').length === 1, findAll(filmCard, 'udx-kind').length + ':' + findAll(serialCard, 'udx-kind').length);
check('grid: repeated focus keeps the badge inside the poster container', inPoster(filmCard, 'udx-kind') && inPoster(serialCard, 'udx-kind'), 'badge moved out of .card__view');
check('grid: repeated focus keeps the badge text intact', filmCard.find('.udx-kind').text() === 'Фільм' && serialCard.find('.udx-kind').text() === 'Серіал', txt(filmCard, '.udx-kind') + ':' + txt(serialCard, '.udx-kind'));

// ---------- final verdict ----------
check('torrent: L.Torrent.start counter is zero', L.Torrent.calls === 0);
console.log(failures ? 'FAIL (' + failures + ' check(s) failed)' : 'PASS');
process.exitCode = failures ? 1 : 0;
