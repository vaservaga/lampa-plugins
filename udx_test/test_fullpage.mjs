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
//   1. Static scan of the plugin source: no auto-playback tokens remain
//      (playRelease / chooseFile / hover:long) and no hardcoded TMDB key
//      material (no external API host, no key parameter, no key helpers).
//      The standard Lampa flows are present as exactly one call site each:
//      L.Torrent.start (after an explicit user pick) and L.Player.play (the
//      online route); TMDB is reached only through the core integration
//      (window.Lampa.TMDB.api).
//   2. The detail page builds from the fetched page in the NUM reference
//      layout 1:1: backdrop, the large poster on the left, the meta block
//      (top line, large title, original title, rating badge, runtime • genre
//      line, seasons), the two action pills, then the full-width "Детально"
//      details strip with the complete overview, director and the FULL cast
//      (no name cap, no ellipsis, no line clamp) inside a scroll viewport;
//      the real release list keeps label/size/magnet as UI data.
//   3. The "Онлайн" press opens the dedicated full-page release list; an
//      explicit row pick there runs the standard TorrServer flow
//      (L.Torrent.start with the picked release's MagnetUri/Size). The
//      "TorrServer" press opens the core Lampa torrents search page
//      (component 'torrents', the title+year search, the item's movie
//      metadata). A press itself never starts a torrent.
//   4. L.Torrent.start is called ONLY through an explicit user pick: button
//      presses, catalog navigation and hover events make zero calls; the final
//      counter must equal the number of performed row selections.
//   5. Catalog card still renders and opens the FullPage on hover:enter; the
//      old long-press playback trigger (hover:long) is gone; the scroll
//      viewport is bounded (flex-bounded list + height:100% scroll) and focus
//      drives scroll.update; cards win over the legacy fallback table rows.
//   6. All network fetches go to the public mirrors only (no external metadata
//      service, no TorrServer/LAN); TMDB traffic goes through the core
//      integration mock only.
//   7. NUM-parity card: type badge top-left (.udx-kind), year under the title
//      (release_year; the age row is removed when there is no year — no empty
//      row rendered); no rating element is rendered on the card at all.
//   8. Detail page: TMDB enrichment (rating / original title / seasons)
//      appears when the core integration answers, stays hidden when it
//      fails or is absent (the page keeps working with the Ultradox data);
//      a page rating GIF without a text value produces no rating text.
//   9. Detail action strip (Phase 5): the old single "Дивитися" button and
//      the old quality selector are gone; exactly one "Онлайн" + one
//      "TorrServer" button over one shared builder, each opening its own
//      dedicated page (an Activity push; the press itself starts nothing and
//      opens no L.Select): "Онлайн" -> the item's real releases (quality •
//      size rows, upload date when the page carries it) and the standard
//      TorrServer flow runs only after an explicit row pick; "TorrServer" ->
//      the core Lampa torrents search page (component 'torrents' with the
//      title+year search and the item's movie metadata); re-opening does not
//      duplicate strip/listeners and keeps both routes (release list then
//      core torrents page). The ultradox_online page (the site's real embeds
//      listed read-only; the standard Lampa.Player.play runs only from an
//      explicit row pick, which is probed read-only first - a dead embed
//      shows the clear "unavailable" message and never starts the player; a
//      page without an online source shows a clear in-page empty state) is
//      driven from its own payload; an empty release list shows the clear
//      in-page empty state.
//      Both controls share one base geometry (60-64px tall at the 1080p root
//      font, identical padding/radius/icon container) and the native Lampa
//      button surface: the core .full-start__button glass rgba(0,0,0,.3) at
//      rest and the core .simple-button.focus invert (#fff/#000) on focus -
//      no gradient, no custom glow, no layout shift.
//   10. Backdrop fallbacks: fill() resets the previous image/states first,
//      then applies exactly one state - a valid backdrop stays a plain url()
//      with --on and no .udxf--poster; the poster fallback is a plain url()
//      (no embedded gradient, no pixhost "Picture removed" placeholder) with
//      the .udxf--poster root state (zone veil darkens left+bottom, fades
//      right, no opaque layer); a pixhost-hosted poster URL never reaches the
//      background-image (neutral fallback, left <img> untouched); the neutral
//      case leaves no image and no state classes.
//   11. Russian-productions filter regression: a live country lookup removes
//      a "Россия" item, keeps a non-Russian one, keeps items whose detail
//      fetch fails (fail-safe), and caches successful lookups (a repeat load
//      re-fetches nothing that was already resolved).
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

// ---------- 1. static scan: no auto-playback / hardcoded-key tokens left ----------
// Call-site counts are taken from the executable code only: // and /* */
// comments are stripped (string literals are preserved), so comments that
// describe the standard flows never count as call sites. An aliased
// indirection (var P = L.Player; P.play(...)) does NOT satisfy the direct-call
// contract - exactly one literal L.Player.play( must exist, behind its guard.
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
for (const token of [/playRelease/, /chooseFile/, /hover:long/, /Tmdb\./, /tmdbKey/, /tmdbGet/, /api\.themoviedb\.org/, /api_key=/]) {
    check('static: code has no ' + token, !token.test(codeOnly));
}
// The standard Lampa flows are now intentional - each with exactly one REAL
// call site in the code (comments excluded).
check('static: exactly one L.Torrent.start call site (standard flow after a user pick)', countTok(/L\.Torrent\.start\(/g, codeOnly) === 1, String(countTok(/L\.Torrent\.start\(/g, codeOnly)));
check('static: exactly one L.Player.play call site (standard online route)', countTok(/L\.Player\.play\(/g, codeOnly) === 1, String(countTok(/L\.Player\.play\(/g, codeOnly)));
// The single torrent handoff must live in the release-row pick handler, and
// the single player call must live in the explicit embed-row pick - not in a
// comment, an alias or a stray spot. Both handlers exist exactly once.
const stCount = countTok(/this\.startTorrServer = function/g, codeOnly);
const stDecl = codeOnly.indexOf('this.startTorrServer = function');
const ttCall = codeOnly.indexOf('L.Torrent.start(');
check('static: the L.Torrent.start call sits inside startTorrServer (the pick-gated handoff)', stCount === 1 && stDecl !== -1 && ttCall !== -1 && stDecl < ttCall, JSON.stringify({ stCount: stCount, stDecl: stDecl, ttCall: ttCall }));
const prCount = countTok(/this\.playRow = function/g, codeOnly);
const prDecl = codeOnly.indexOf('this.playRow = function');
const plCall = codeOnly.indexOf('L.Player.play(');
check('static: the L.Player.play call sits inside playRow (the explicit embed-row pick)', prCount === 1 && prDecl !== -1 && plCall !== -1 && prDecl < plCall, JSON.stringify({ prCount: prCount, prDecl: prDecl, plCall: plCall }));
check('static: playRow keeps the L.Player availability guard before the direct call', (function () {
    const zone = codeOnly.slice(prDecl, plCall);
    return /typeof L\.Player\.play !== 'function'/.test(zone) && /!\s*url\b/.test(zone);
})(), 'guard missing before the call');
check('static: MagnetUri payload field present (the TorrServer handoff)', codeOnly.indexOf('MagnetUri') !== -1);
check('static: TMDB only through the core integration, never a direct host', codeOnly.indexOf('window.Lampa.TMDB') !== -1 && codeOnly.indexOf('api.themoviedb.org') === -1);
check('static: no raw themoviedb host or key parameter anywhere', codeOnly.indexOf('themoviedb.org') === -1 && codeOnly.indexOf('api_key') === -1);
check('static: old single "Дивитися" button markup is gone', src.indexOf('.udx-f__play') === -1, '.udx-f__play still in source');
check('static: old watch lang key removed', src.indexOf('ultradox_watch') === -1, 'ultradox_watch still in source');
check('static: old quality selector removed (control + lang key)', src.indexOf('udxf__act--quality') === -1 && src.indexOf('ultradox_quality_pick') === -1, 'quality selector still in source');
check('static: no play-triangle glyph introduced in the action strip', src.indexOf('polygon') === -1 && /svg/.test(src) && src.indexOf('ICON_ONLINE') !== -1 && src.indexOf('ICON_RELEASES') !== -1, 'unexpected icon markup');

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
// The series page's #iframe_block-player embed (the only online source the
// site gives this item): the plugin probes it read-only before the player
// call, so the mock must answer it (a reachable source).
const SERIES_EMBED = 'https://vid1793313812.sevstar933krop.com/movie/a7c3061ee7fefc23786c1356317121b6/iframe?d=ultradox.ru';

// The catalog page also carries the legacy "latest releases" table (rows with
// magnets); the cards are the primary source and must win - the rows only
// appear when a source has no cards at all.
const CATALOG_HTML =
    '<html><body>' +
    '<div class="top__slider">' +
    '<div class="top__slider_div__item"><a href="/serial/show-name-2021/"><img src="/upload/show.jpg"></a>' +
    '<span>Show Name (2021)</span><span class="short-quality">Сериал</span></div></div>' +
    '<table><tr>' +
    '<td>2026-11-01</td><td>WEB-DL</td>' +
    '<td><a href="/film/fallback-only-2020/">Fallback Film (2020)</a></td>' +
    '<td>2 GB</td>' +
    '<td><a href="magnet:?xt=urn:btih:ffffffffffffffffffffffffffffffffffffffff&amp;dn=Fallback.Film.2020.mkv&amp;xl=1073741824"></a></td>' +
    '</tr></table>' +
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
    // The site's own online route ("Смотреть онлайн" embed), shape mirrors
    // the live detail page (#iframe_block-player with a single iframe src).
    '<section class="full-story__player" id="player-block">' +
    '<div class="full-story_iframe">' +
    '<div class="full-story_iframe-block" id="iframe_block-player">' +
    '<iframe src="https://vid1793313812.sevstar933krop.com/movie/a7c3061ee7fefc23786c1356317121b6/iframe?d=ultradox.ru" width="100%" height="480"></iframe>' +
    '</div>' +
    '<div class="full-story_iframe-block" id="iframe_block-trailer"><div id="trailerskp-ajax"></div></div>' +
    '</div>' +
    '</section>' +
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

// The year-less serial card's item page: a real "Год:" field (the release
// year) plus two releases with different "Загрузил" dates (the newest one,
// 12 Окт 2026, is the catalog-addition date).
const SERIALHD_URL = 'https://045.ultradox.click/serial-hd/56755-zhivoj-2-sezon.html';
const SERIALHD_HTML =
    '<html><head><meta name="description" content="Драма про готель. Формат: MKV."></head><body><ul>' +
    '<li><span>Жанр:</span> Драма</li>' +
    '<li itemprop="contributor"><span> Страна: </span> США</li>' +
    '<li><span>Год:</span> 2026</li>' +
    '<li><span>Время:</span> 42 мин.</li>' +
    '<li><span>Перевод:</span> Многоголосый</li>' +
    '<li><span>Качество:</span> WEB-DLRip</li>' +
    '</ul>' +
    '<div id="torrent_1_info">' +
    '<div class="info_d-size">1.4 GB</div>' +
    '<div class="bord_a1">Загрузил: tester (01 Сен 2025)</div>' +
    '<a href="magnet:?xt=urn:btih:0000000000000000000000000000000000000000&amp;dn=Zhivoy.2026.S01E01.720p.WEB-DLRip.mkv&amp;xl=1503238554"></a>' +
    '</div>' +
    '<div id="torrent_2_info">' +
    '<div class="info_d-size">1.5 GB</div>' +
    '<div class="bord_a1">Загрузил: tester (12 Окт 2026)</div>' +
    '<a href="magnet:?xt=urn:btih:1111111111111111111111111111111111111111&amp;dn=Zhivoy.2026.S01E02.720p.WEB-DLRip.mkv&amp;xl=1610612736"></a>' +
    '</div>' +
    '</body></html>';

const ROUTES = new Map([
    ['https://045.ultradox.click/serial/', CATALOG_HTML],
    [SERIES_URL, SERIES_HTML],
    [FILM_URL, FILM_HTML],
    [SERIALHD_URL, SERIALHD_HTML],
    // Reachable embed stub: the pre-player probe gets a 200-shaped answer for
    // the series' real embed URL (the live test covers the dead case against
    // the real host).
    [SERIES_EMBED, '<html><body><div id="player">embed page</div></body></html>']
]);

// ---------- Lampa mock ----------
const fetches = [];
// Canned TMDB documents (the only metadata source the detail page may use;
// everything below is served through the L.TMDB.api -> Reguest.silent chain).
const TMDB_DOCS = new Map([
    ['find/tt15468572?external_sources=imdb_id&language=ru', { results: [{ media_type: 'tv', id: 15468572 }] }],
    ['tv/15468572?language=ru', { vote_average: 8.1, original_title: 'Dokka', number_of_seasons: 4 }],
    ['tv/15468572/credits?language=ru', { cast: [{ name: 'A. Test' }, { name: 'B. Test' }] }]
]);
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
        static last = null;
        constructor() { this.onEnd = null; this.minusCalls = 0; this.lastMinus = null; this.updateCalls = 0; this.lastUpdate = null; this._inner = null; L.Scroll.last = this; }
        // The real Scroll keeps the appended child inside its viewport, so the
        // mock models that: render() returns the viewport element carrying the
        // appended child (the list-page rows stay reachable in the tree).
        append(child) { this._inner = child; }
        render() { const s = makeEl('scroll'); if (this._inner) s.append(this._inner); return s; }
        minus(el) { this.minusCalls++; this.lastMinus = el; }
        reset() {}
        update(el) { this.updateCalls++; this.lastUpdate = el; }
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
    Activity: { pushes: [], backwardCalls: 0, push(a) { this.pushes.push(a); }, active() { return null; }, backward() { this.backwardCalls++; }, toggle() {}, loader() {} },
    Controller: {
        toggles: {},
        configs: {},
        focusCalls: [],
        add(name, cfg) { this.configs[name] = cfg; },
        toggle(n) { this.toggles[n] = (this.toggles[n] || 0) + 1; },
        collectionSet() {},
        collectionFocus(el, root) { this.focusCalls.push({ el: el, root: root }); },
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
    // The core TMDB integration, mode-controlled:
    //   'ok'    -> api() builds the URL, silent() answers canned docs
    //   'fail'  -> api() builds the URL, silent() rejects (network failure)
    //   'throw' -> api() throws (integration missing/broken in the runtime)
    // touches counts every api() call (the only door the plugin may use).
    TMDB: { touches: 0, mode: 'ok', api(u) { this.touches++; if (this.mode === 'throw') throw new Error('core TMDB integration unavailable'); return 'https://mock.tmdb.local/3/' + u; } },
    // Recorder for the standard torrent flow: the plugin may call it, but the
    // test asserts it happens only after an explicit user row selection and
    // with the exact payload of the picked release.
    Torrent: { calls: [], start(o, movie) { this.calls.push({ o: o, movie: movie }); } },
    // Recorder for the standard online route (Lampa.Player.play), used by the
    // local online sources; the plugin may call it only with the site's own
    // #iframe_block-player embed URL.
    Player: { plays: [], play(entry) { this.plays.push(entry); } },
    Reguest: class {
        timeout() {}
        native(url, ok, err) {
            fetches.push(url);
            const h = ROUTES.get(url);
            if (h !== undefined) ok(h);
            else err(new Error('no route: ' + url));
        }
        silent(url, ok, err) {
            if (!/^https:\/\/mock\.tmdb\.local\/3\//.test(url)) { err(new Error('unexpected silent url: ' + url)); return; }
            const path = url.slice('https://mock.tmdb.local/3/'.length);
            if (L.TMDB.mode === 'fail') { err(new Error('tmdb request failed')); return; }
            const doc = TMDB_DOCS.get(path);
            if (!doc) { err(new Error('no canned tmdb doc for ' + path)); return; }
            ok(doc);
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
check('boot: ultradox_online component registered', typeof L.Component.get('ultradox_online') === 'function');
check('boot: ultradox_torrents component registered', typeof L.Component.get('ultradox_torrents') === 'function');

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
check('catalog: no Torrent.start', L.Torrent.calls.length === 0, String(L.Torrent.calls.length));

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
check('css: poster-to-title gap 0.5em (8px at the 16px root font; the 8-12px NUM band at 1920x1080)', /\.udx-content \.card__view\{[^}]*margin-bottom:0\.5em/.test(src), 'missing margin-bottom rule');
check('css: catalog-addition date is dimmer than the (already dimmed) release year', /\.udx-content \.card__age \.udx-ad\{color:rgba\(255,255,255,\.45\);\}/.test(src), 'missing .udx-ad rule');
check('css: no glass panel on top of the content zone (tab zone and core head stay on the plain Lampa background - user correction 2026-11-04)', src.indexOf('.udx-glass') === -1 && src.indexOf('GLASS_COMPONENTS') === -1 && /\.udx-content__head\{flex:0 0 auto;[^}]*\}/.test(src) && !/\.udx-content__head\{[^}]*background/.test(src), 'glass rules must be gone');
check('css: grid row fills the full width with five equal cells (flex-basis 0 + grow - exact division, no rounded-percent wrap; NUM reference, no right band)', /\.udx-content \.category-full \.card\{flex:1 1 0;min-width:0;\}/.test(src), 'missing 5-cell flex rule');
check('css: tab zone is flex flow above the grid (head not an overlay; no poster can be covered by the tabs)', /\.udx-content\{[^}]*display:flex[^}]*flex-direction:column/.test(src) && /\.udx-content__head\{flex:0 0 auto;[^}]*\}/.test(src) && src.indexOf('.udx-content__head{position:absolute') === -1, 'head must stay in flow');
check('css: grid area is the flex remainder with a bounded scroll viewport (TV scroll driver clamps to offsetHeight)', /\.udx-content__list\{flex:1 1 auto;min-height:0;[^}]*\}/.test(src) && /\.udx-content__list>\.scroll\{height:100%;\}/.test(src), 'list/scroll must stay height-bounded');
check('css: small clear band between the tab zone and the first poster row', /\.udx-content \.scroll--mask \.scroll__content\{padding-top:0\.75em;\}/.test(src), 'missing mask top-gap rule');
check('css: card title matches the NUM reference scale and weight (1em regular)', /\.udx-content \.card__title\{[^}]*font-size:1em[^}]*font-weight:400/.test(src), 'missing title scale rule');
check('css: focus is the native core poster ring (NUM DOM: .card__view::after, white; rows stacked without gap - a whole-card ring would reach the next row)', src.indexOf('.udx-content .card.focus::after') === -1 && src.indexOf('.udx-content .card.hover::after') === -1 && src.indexOf('card__view::after{border:none}') === -1, 'custom card-level ring must be gone');
check('css: year line dimmed like the NUM reference (title stays white)', /\.udx-content \.card__age\{[^}]*color:rgba\(255,255,255,\.5\);\}/.test(src) && /\.udx-content \.card__age \.udx-ad\{color:rgba\(255,255,255,\.45\);\}/.test(src), 'missing dim year color');
check('css: no dead second kind-chip implementation (.udx-chip__kind)', src.indexOf('.udx-chip__kind') === -1, 'dead selector present');
check('css: .udx-kind pinned inside the poster (left/top 10px, no negative offset) and clipped to it', /\.udx-kind\{position:absolute;left:10px;top:10px;[^}]*max-width:calc\(100% - 20px\);[^}]*overflow:hidden;[^}]*white-space:nowrap/.test(src), 'missing .udx-kind containment rule');
check('css: poster fallback soft-blurs the stretched poster (hides upscale blocks) and darkens it', /\.udxf__backdrop--poster\{[^}]*transform:scale\(1\.06\)[^}]*filter:blur\(7px\)[^}]*brightness\(\.5\)[^}]*saturate\(\.88\)/.test(src) && src.indexOf('blur(22px)') === -1, 'missing .udxf__backdrop--poster rule');
check('css: list-page poster fallback shares the same soft-blur treatment', /\.udxl__backdrop--poster\{[^}]*transform:scale\(1\.06\)[^}]*filter:blur\(7px\)[^}]*brightness\(\.5\)[^}]*saturate\(\.88\)/.test(src), 'missing .udxl__backdrop--poster rule');
check('css: detail scroll viewport is height-bounded (the TV scroll driver clamps travel to html offsetHeight)', /\.udxf__slot \.scroll\{position:relative;height:100%;overflow:hidden;\}/.test(src), 'missing bounded scroll rule');
check('css: catalog backdrop layers scale + blur + crossfade duration', /\.udx-bg\{[^}]*transform:scale\(1\.10\)[^}]*filter:blur\(20px\)[^}]*brightness\(\.55\)[^}]*saturate\(\.78\)[^}]*transition:opacity \.32s ease/.test(src), 'missing .udx-bg rule');
check('css: single permanent veil overlay (left+bottom gradients, Lampa black-based alphas)', /\.udx-bg__veil\{[^}]*z-index:1[^}]*linear-gradient\(90deg,rgba\(0,0,0,\.78\),rgba\(0,0,0,\.30\) 60%\),linear-gradient\(to top,rgba\(0,0,0,\.70\),rgba\(0,0,0,0\) 42%\)/.test(src), 'missing .udx-bg__veil rule');
check('css: poster-state zone veil darkens left + bottom and fades right/top', /\.udxf--poster \.udxf__gradient\{background:linear-gradient\(90deg,rgba\(0,0,0,\.86\),rgba\(0,0,0,\.58\) 46%,rgba\(0,0,0,\.1\) 80%\),linear-gradient\(to top,rgba\(0,0,0,\.66\),rgba\(0,0,0,0\) 46%\);}/.test(src), 'missing .udxf--poster veil rule');
check('css: poster-state veil has no fully opaque layer (the image stays visible)', (function () {
    const m = src.match(/\.udxf--poster \.udxf__gradient\{([^}]*)\}/);
    return m && !/rgba\(\d+,\s*\d+,\s*\d+,\s*1(?:\.0)?\)/.test(m[1]) && m[1].indexOf('rgba(0,0,0,.1) 80%') !== -1 && m[1].indexOf('rgba(0,0,0,0) 46%') !== -1;
})(), 'opaque layer or missing fade stop');
check('css: poster fallback uses the plain url() only (no embedded gradient)', /bg\.style\.backgroundImage = 'url\("'\s*\+\s*posterBackdrop/.test(src) && src.indexOf('rgba(0,0,0,.78),rgba(0,0,0,0) 42%') === -1, 'gradient still embedded in the poster fallback');
check('css: fill() resets the previous image and all states before applying one', /if \(bg\) \{\s*bg\.style\.backgroundImage = '';\s*bg\.removeClass\('udxf__backdrop--on'\);\s*bg\.removeClass\('udxf__backdrop--poster'\);\s*\}/.test(src) && /if \(udxRoot\) udxRoot\.removeClass\('udxf--poster'\);/.test(src), 'reset-first block missing');
check('css: a pixhost-hosted poster URL is kept out of the backdrop background', src.indexOf('var posterBackdrop = \'\';') !== -1 && src.indexOf('pixhost\\.cc') !== -1, 'pixhost poster guard missing');

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
// Focus fetched the year-less serial's item page: the line under the title now
// carries the real release year (Год) and the newest catalog-addition date
// (latest "Загрузил" upload), the date dimmed and distinct from the year.
check('grid: focused year-less serial gains real year + catalog date (no fabrication)', (function () {
    const age = serialCard.find('.card__age');
    if (!age) return false;
    const kids = age.children;
    return kids.length === 2 && kids[0].text() === '2026' && kids[1].text() === ' \u2022 12.10' && kids[1].classes.has('udx-ad');
})(), (() => { const a = serialCard.find('.card__age'); return a ? JSON.stringify(a.children.map((c) => c.text())) : 'no age line'; })());
// Refocusing an enriched card must not refetch or duplicate the line.
const fetchesAfterEnrich = fetches.length;
serialCard.handlers['hover:focus'].forEach((f) => f());
check('grid: refocus of an enriched card does not refetch or duplicate the line', fetches.length === fetchesAfterEnrich && findAll(serialCard, 'card__age').length === 1, String(fetches.length - fetchesAfterEnrich) + ' new fetches, ' + findAll(serialCard, 'card__age').length + ' age lines');
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
check('catbg: hover:focus causes no fetch / loadMore / torrent', fetches.length === fetchesBeforeBg && L.Torrent.calls.length === 0, String(fetches.length - fetchesBeforeBg) + ' new fetches');

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
check('fullpage: no poster state on the root for a valid backdrop', sh.find('.udxf') !== null && !sh.find('.udxf').classes.has('udxf--poster'), String(sh.find('.udxf') && sh.find('.udxf').classes));
check('fullpage: poster src equals the expected URL', sh.find('.udxf__poster') && sh.find('.udxf__poster').src === 'https://045.ultradox.click/upload/show.jpg', sh.find('.udxf__poster') ? sh.find('.udxf__poster').src : 'no poster element');
check('fullpage: top line', sh.find('.udxf__top').text() === 'США • 2021', txt(sh, '.udxf__top'));
check('fullpage: meta line', sh.find('.udxf__line').text() === 'Детектив, Драма • 45 мин. • Многоголосый', txt(sh, '.udxf__line'));
check('fullpage: overview (technical tail cut)', sh.find('.udxf__overview').text() === 'Детективний серіал про агентку.');
check('fullpage: director line with the exact source value', txt(sh, '.udxf__fact--director') === 'Режисер: Кацуо Фукудзава, Акико Като, Ёхэй Миядзаки', txt(sh, '.udxf__fact--director'));
check('fullpage: cast line shows every name (full list, no cap, no ellipsis truncation)', txt(sh, '.udxf__fact--cast') === 'У ролях: Сакай Масато, Абэ Хироси, Никайдо Фуми, Ниномия Кадзунари, Тори Мацузака, Рё Рюсэй, Кенто Хаяси, Рин Таканаси, Рей Дан, Кодзи Якушо', txt(sh, '.udxf__fact--cast'));
check('fullpage: fact rows rendered exactly once each', findAll(sh, 'udxf__fact--director').length === 1 && findAll(sh, 'udxf__fact--cast').length === 1, findAll(sh, 'udxf__fact--director').length + ':' + findAll(sh, 'udxf__fact--cast').length);
// ---------- detail action strip: two controls, one shared select path ----------
check('fullpage: old single "Дивитися" button removed', sh.find('.udx-f__play') === null && findAll(sh, 'udx-f__play').length === 0, String(findAll(sh, 'udx-f__play').length));
check('fullpage: exactly one action strip after the facts', findAll(sh, 'udxf__actions').length === 1, String(findAll(sh, 'udxf__actions').length));
check('fullpage: exactly one "Онлайн" and one "TorrServer" button', findAll(sh, 'udxf__act--online').length === 1 && findAll(sh, 'udxf__act--torrents').length === 1, findAll(sh, 'udxf__act--online').length + ':' + findAll(sh, 'udxf__act--torrents').length);
check('fullpage: old quality selector absent (no control, no lang key)', sh.find('.udxf__act--quality') === null && src.indexOf('ultradox_quality_pick') === -1, String(!!sh.find('.udxf__act--quality')));
const oBtn = sh.find('.udxf__act--online');
const tBtn = sh.find('.udxf__act--torrents');
check('fullpage: "Онлайн" button label', oBtn !== null && txt(oBtn, '.udxf__act__label') === L.Lang.translate('ultradox_online'), oBtn ? txt(oBtn, '.udxf__act__label') : 'no button');
check('fullpage: "TorrServer" button label', tBtn !== null && txt(tBtn, '.udxf__act__label') === L.Lang.translate('ultradox_torrserver'), tBtn ? txt(tBtn, '.udxf__act__label') : 'no button');
check('fullpage: both controls wired to hover:enter exactly once', oBtn && tBtn && oBtn.handlers['hover:enter'].length === 1 && tBtn.handlers['hover:enter'].length === 1, JSON.stringify({ o: oBtn && oBtn.handlers['hover:enter'] && oBtn.handlers['hover:enter'].length, t: tBtn && tBtn.handlers['hover:enter'] && tBtn.handlers['hover:enter'].length }));
// TMDB enrichment (core integration answers 'ok'): the hidden slots are
// revealed with confirmed values; the page never waits for them.
check('fullpage: TMDB rating revealed through the core integration (NUM badge format "value TMDB")', (function () { const e = sh.find('.udxf__rate'); return !!e && !e.classes.has('hide') && e.text() === '8.1 TMDB'; })(), txt(sh, '.udxf__rate'));
check('fullpage: the details strip carries the "Детально" heading (NUM reference)', sh.find('.udxf__details-head') !== null && txt(sh, '.udxf__details-head') === L.Lang.translate('ultradox_details'), txt(sh, '.udxf__details-head'));
check('fullpage: the details strip is the down-navigation focus target (selector class + one hover:focus)', (function () { const d = sh.find('.udxf__details'); return !!d && d.classes.has('selector') && d.handlers['hover:focus'].length === 1; })());
check('fullpage: details focus drives the page scroll (scroll.update)', (function () { const before = L.Scroll.last.updateCalls; const d = sh.find('.udxf__details'); d.handlers['hover:focus'].forEach((f) => f()); return L.Scroll.last.updateCalls === before + 1 && L.Scroll.last.lastUpdate === d; })());
check('fullpage: TMDB original title revealed', (function () { const e = sh.find('.udxf__orig'); return !!e && !e.classes.has('hide') && e.text() === 'Dokka'; })(), txt(sh, '.udxf__orig'));
check('fullpage: TMDB seasons revealed (series)', (function () { const e = sh.find('.udxf__seasons'); return !!e && !e.classes.has('hide') && e.text() === L.Lang.translate('ultradox_seasons') + ': 4'; })(), txt(sh, '.udxf__seasons'));
check('fullpage: enrichment used the core door exactly 3 times (find + detail + credits)', L.TMDB.touches === 3, String(L.TMDB.touches));

// ---------- action group geometry: one shared base, two roles ----------
// Both controls inherit the single .udxf__act base rule (height/padding/
// radius/font-size); the role modifiers must not override any of them, so
// the pair cannot shift layout. At the 1080p root font (16px) the shared
// 3.7em x 1.05em height lands inside the 60-64px band.
(function () {
    const base = src.match(/\.udxf__act\{([^}]*)\}/);
    const hEm = base && base[1].match(/height:([\d.]+)em/);
    const fEm = base && base[1].match(/font-size:([\d.]+)em/);
    const px = hEm && fEm ? parseFloat(hEm[1]) * parseFloat(fEm[1]) * 16 : 0;
    check('strip: shared base height is in the 60-64px band at the 1080p root font', !!base && px >= 60 && px <= 64, 'height=' + px + 'px');
    const mods = ['.udxf__act--online', '.udxf__act--torrents'];
    check('strip: both controls share the base geometry (no height/padding/radius override in the role rules)', mods.every((m) => {
        const r = src.match(new RegExp(m.replace(/[-.]/g, '\\$&') + '\\{([^}]*)\\}'));
        return !!r && !/height:/.test(r[1]) && !/padding:/.test(r[1]) && !/border-radius:/.test(r[1]);
    }), JSON.stringify(mods));
    // Native Lampa button focus: one shared invert rule (the core
    // .simple-button.focus pattern); no per-role glow/transform rules.
    check('strip: focus is the native Lampa button invert (one shared rule, no glow, no layout shift)', /\.udxf__act\.focus\{background-color:#fff;color:#000;\}/.test(src) && src.indexOf('.udxf__act--online.focus') === -1 && src.indexOf('.udxf__act--torrents.focus') === -1, 'non-native focus rule present');
    // Native Lampa button surface: the core .full-start__button / .simple-button
    // glass at rest (both detail buttons are indistinguishable in core Lampa).
    check('strip: both roles carry the native Lampa button glass (core .full-start__button surface)', /\.udxf__act--online\{background:rgba\(0,0,0,\.3\);color:#fff;\}/.test(src) && /\.udxf__act--torrents\{background:rgba\(0,0,0,\.3\);color:#fff;\}/.test(src), 'role styles missing');
    check('strip: both icon containers are identical 1.3em inline SVGs (own marks)', src.indexOf("ICON_ONLINE = '<svg width=\"1.3em\" height=\"1.3em\"") !== -1 && src.indexOf("ICON_RELEASES = '<svg width=\"1.3em\" height=\"1.3em\"") !== -1, 'icon container mismatch');
})();

// ---------- Online control: dedicated full-page release list, pick-gated handoff ----------
// The button press ONLY pushes the dedicated page (Activity push); the
// standard Lampa torrent flow runs exclusively after an explicit row
// selection inside that page (header contract 3/4).
console.log('fullpage: online control (release list) + pick-gated handoff');
let picks = 0; // explicit TorrServer row picks performed so far
const fetchesBeforeOpen = fetches.length;
const notiesBeforeOpen = L.Noty.msgs.length;
L.Select.last = null;
oBtn.handlers['hover:enter'].forEach((f) => f());
const pushedT = L.Activity.pushes[L.Activity.pushes.length - 1];
check('fullpage: "Онлайн" opens the dedicated full-page release list (Activity push, no L.Select)', !!pushedT && pushedT.component === 'ultradox_torrents' && pushedT.item && pushedT.item.itemUrl === SERIES_URL && L.Select.last === null, JSON.stringify(pushedT && pushedT.component));
check('fullpage: the page carries the item detail payload (releases inert)', !!pushedT && !!pushedT.detail && pushedT.detail.releases.length === 2 && /^magnet:\?xt=urn:btih:0123456789abcdef/.test(pushedT.detail.releases[0].magnet) && pushedT.detail.releases[0].sizeBytes === 10737418240 && /^magnet:\?xt=urn:btih:fedcba9876543210/.test(pushedT.detail.releases[1].magnet), JSON.stringify(pushedT && pushedT.detail && pushedT.detail.releases.map((r) => String(r.magnet).slice(0, 24))));
check('fullpage: opening the list makes no HTTP request', fetches.length === fetchesBeforeOpen, String(fetches.length - fetchesBeforeOpen) + ' new fetches');
check('fullpage: opening the list starts nothing (pick-gated)', L.Torrent.calls.length === 0 && L.Noty.msgs.length === notiesBeforeOpen, String(L.Torrent.calls.length) + '/' + String(L.Noty.msgs.length - notiesBeforeOpen));

// Drive the dedicated page from the exact Activity payload the detail page
// pushed (the real Lampa runtime constructs the component from that payload).
const LP_T = L.Component.get('ultradox_torrents');
const LP_O = L.Component.get('ultradox_online');
const lpT = new LP_T(pushedT);
lpT.activity = { loader() {}, toggle() {} };
lpT.create();
const lpr = lpT.render();
check('fullpage: list page shows the item info card (title + meta)', txt(lpr, '.udxl__title') === 'Show Name' && txt(lpr, '.udxl__meta') === 'США • 2021 • Детектив, Драма', JSON.stringify({ t: txt(lpr, '.udxl__title'), m: txt(lpr, '.udxl__meta') }));
check('fullpage: list page backdrop is the item fanart', lpr.find('.udxl__backdrop') !== null && lpr.find('.udxl__backdrop').style.backgroundImage === 'url("https://045.ultradox.click/upload/show-fanart.jpg")' && lpr.find('.udxl__backdrop').classes.has('udxl__backdrop--on'), lpr.find('.udxl__backdrop') ? String(lpr.find('.udxl__backdrop').style.backgroundImage) : 'no backdrop element');
const rowsT = findAll(lpr, 'udxl__row');
check('fullpage: two real releases listed as quality • size rows', rowsT.length === 2 && rowsT[0].find('.udxl__row__main').text() === 'WEB-DL 1080p • 10 GB' && rowsT[1].find('.udxl__row__main').text() === 'WEB-DL 1080p • 10 GB', rowsT.map((r) => r.find('.udxl__row__main').text()).join('|'));
check('fullpage: release rows carry no separate quality cell (quality already in the main label)', rowsT.length > 0 && rowsT.every((r) => r.find('.udxl__row__q') === null), rowsT.map((r) => String(r.find('.udxl__row__q'))).join('|'));
check('fullpage: row focus drives the list scroll (scroll.update)', (function () {
    const before = L.Scroll.last.updateCalls;
    rowsT[0].handlers['hover:focus'].forEach((f) => f());
    return L.Scroll.last.updateCalls === before + 1 && L.Scroll.last.lastUpdate === rowsT[0];
})());

// An explicit row pick is the ONLY door into the standard torrent flow.
const tBefore = L.Torrent.calls.length;
rowsT[0].handlers['hover:enter'].forEach((f) => f());
picks++;
check('fullpage: pick runs the standard TorrServer handoff exactly once', L.Torrent.calls.length === tBefore + 1, String(L.Torrent.calls.length - tBefore));
(function () {
    const c = L.Torrent.calls[L.Torrent.calls.length - 1];
    const r = pushedT.detail.releases[0];
    check('fullpage: handoff payload is the picked release (MagnetUri/Size/Title)', c && c.o.MagnetUri === r.magnet && c.o.Size === r.sizeBytes && c.o.title === 'Show Name (2021)' && c.o.Tracker === 'Ultradox' && c.movie.title === 'Show Name (2021)', c && JSON.stringify({ m: String(c.o.MagnetUri).slice(0, 30), s: c.o.Size, t: c.o.title }));
    check('fullpage: handoff movie carries the TMDB season count (series)', c && c.movie.number_of_seasons === 4, c && String(c.movie.number_of_seasons));
})();
check('fullpage: the list page registers its content controller and back returns to the detail page', (function () {
    lpT.start();
    const cfg = L.Controller.configs.content;
    if (!cfg) return false;
    cfg.back();
    return L.Activity.backwardCalls === 1;
})());
check('fullpage: strip labels stay static after a pick (no quality state)', txt(oBtn, '.udxf__act__label') === L.Lang.translate('ultradox_online') && txt(tBtn, '.udxf__act__label') === L.Lang.translate('ultradox_torrserver'), txt(oBtn, '.udxf__act__label') + ' / ' + txt(tBtn, '.udxf__act__label'));

// re-opening through either control must not duplicate strip/controls/listeners
const stripCount = findAll(sh, 'udxf__actions').length;
const oCount = findAll(sh, 'udxf__act--online').length;
const tCount = findAll(sh, 'udxf__act--torrents').length;
const oHandlers = oBtn.handlers['hover:enter'].length;
const tHandlers = tBtn.handlers['hover:enter'].length;
oBtn.handlers['hover:enter'].forEach((f) => f());
tBtn.handlers['hover:enter'].forEach((f) => f());
check('strip: re-opening does not duplicate strip, controls or listeners', findAll(sh, 'udxf__actions').length === stripCount && findAll(sh, 'udxf__act--online').length === oCount && findAll(sh, 'udxf__act--torrents').length === tCount && oBtn.handlers['hover:enter'].length === oHandlers && tBtn.handlers['hover:enter'].length === tHandlers, JSON.stringify({ s: findAll(sh, 'udxf__actions').length, o: oCount, t: tCount, h: [oHandlers, tHandlers] }));
check('strip: re-opening keeps both routes (release list then core torrents page)', (function () {
    const a = L.Activity.pushes[L.Activity.pushes.length - 2];
    const b = L.Activity.pushes[L.Activity.pushes.length - 1];
    return a && b && a.component === 'ultradox_torrents' && b.component === 'torrents';
})(), JSON.stringify([L.Activity.pushes[L.Activity.pushes.length - 2] && L.Activity.pushes[L.Activity.pushes.length - 2].component, L.Activity.pushes[L.Activity.pushes.length - 1] && L.Activity.pushes[L.Activity.pushes.length - 1].component]));

// ---------- TorrServer control: the core Lampa torrents search page ----------
// The press ONLY pushes the core screen (component 'torrents': no request, no
// player, no L.Select). The ultradox_online page is no longer a strip route:
// its behavior (the read-only embed probe, the pick-gated Lampa.Player.play)
// is covered from its own payload (the exact shape the detail page pushes).
console.log('fullpage: torrserver route (core torrents page) + online page (own payload)');
const playsBeforeOnline = L.Player.plays.length;
const fetchesBeforeOnline = fetches.length;
const notiesBeforeOnline = L.Noty.msgs.length;
const torrBeforeTorr = L.Torrent.calls.length;
L.Select.last = null;
tBtn.handlers['hover:enter'].forEach((f) => f());
const pushedTS = L.Activity.pushes[L.Activity.pushes.length - 1];
check('fullpage: "TorrServer" opens the core torrents search page (Activity push, no L.Select)', !!pushedTS && pushedTS.component === 'torrents' && pushedTS.title === L.Lang.translate('title_torrents') && L.Select.last === null, JSON.stringify(pushedTS && pushedTS.component));
check('fullpage: the core push carries the title+year search and the item movie metadata', !!pushedTS && pushedTS.url === '' && pushedTS.search === 'Show Name 2021' && pushedTS.search_one === 'Show Name' && pushedTS.search_two === 'Show Name' && pushedTS.page === 1 && !!pushedTS.movie && pushedTS.movie.title === 'Show Name' && pushedTS.movie.original_title === 'Show Name' && pushedTS.movie.img === 'https://045.ultradox.click/upload/show.jpg' && pushedTS.movie.release_date === '2021' && Array.isArray(pushedTS.movie.genres) && pushedTS.movie.genres.length === 0 && pushedTS.movie.number_of_seasons === 1 && pushedTS.movie.source === 'ultradox', JSON.stringify(pushedTS && { s: pushedTS.search, m: pushedTS.movie }));
check('fullpage: the core press starts nothing (no player, no torrent, no request)', L.Player.plays.length === playsBeforeOnline && L.Torrent.calls.length === torrBeforeTorr && L.Noty.msgs.length === notiesBeforeOnline && fetches.length === fetchesBeforeOnline, JSON.stringify({ plays: L.Player.plays.length - playsBeforeOnline, torr: L.Torrent.calls.length - torrBeforeTorr, fetches: fetches.length - fetchesBeforeOnline }));

// The online page from its own payload: the read-only re-probe of the item
// page for its real embeds, then the pick-gated standard player call.
const oPayload = { title: pushedT.title, component: 'ultradox_online', item: pushedT.item, detail: pushedT.detail, seasons: pushedT.seasons };
const lpO = new LP_O(oPayload);
lpO.activity = { loader() {}, toggle() {} };
lpO.create();
const lpo = lpO.render();
const rowsO = findAll(lpo, 'udxl__row');
check('fullpage: the page lists the site\'s real embed (the #iframe_block-player iframe)', rowsO.length === 1 && rowsO[0].find('.udxl__row__main').text() === L.Lang.translate('ultradox_online') && txt(rowsO[0], '.udxl__row__sub') === 'vid1793313812.sevstar933krop.com', rowsO.map((r) => r.find('.udxl__row__main').text() + ':' + txt(r, '.udxl__row__sub')).join('|'));
check('fullpage: the online row shows the item quality token in the right cell (NUM-style quality choice)', rowsO.length === 1 && rowsO[0].find('.udxl__row__q') !== null && txt(rowsO[0], '.udxl__row__q') === 'WEB-DL', 'q=' + (rowsO[0] ? txt(rowsO[0], '.udxl__row__q') : 'no row'));
const oTorr = L.Torrent.calls.length;
rowsO[0].handlers['hover:enter'].forEach((f) => f());
check('fullpage: the explicit row pick opens the site embed through Lampa.Player.play exactly once', L.Player.plays.length === playsBeforeOnline + 1, String(L.Player.plays.length - playsBeforeOnline));
check('fullpage: player entry is the parsed #iframe_block-player URL + item title', (function () {
    const p = L.Player.plays[L.Player.plays.length - 1];
    return !!p && p.url === SERIES_EMBED && p.title === 'Show Name (2021)';
})(), JSON.stringify(L.Player.plays[L.Player.plays.length - 1]));
check('fullpage: the online route probes the embed exactly once (read-only preflight) and starts no torrent', fetches.length === fetchesBeforeOnline + 2 && fetches[fetches.length - 2] === SERIES_URL && fetches[fetches.length - 1] === SERIES_EMBED && L.Torrent.calls.length === oTorr, String(fetches.length - fetchesBeforeOnline) + ' new fetches');

// ---------- 2/3/4. FullPage: film release selection ----------
console.log('fullpage: film detail + release selection');
const film = new FP({ item: { title: 'Great Movie (2023)', serial: false, itemUrl: FILM_URL, poster: '' } });
film.activity = { loader() {}, toggle() {} };
film.create();

const fm = film.render();
check('fullpage(film): top line', fm.find('.udxf__top').text() === 'Франція • 2023', txt(fm, '.udxf__top'));
check('fullpage(film): overview', fm.find('.udxf__overview').text() === 'Епічна історія космічної одесьи.');
check('fullpage(film): director line (single name, no ellipsis)', txt(fm, '.udxf__fact--director') === 'Режисер: Мар Олид', txt(fm, '.udxf__fact--director'));
check('fullpage(film): cast line shows every name (no cap, no ellipsis truncation)', txt(fm, '.udxf__fact--cast') === 'У ролях: Кира Миро, Сальва Рейна, Луна Фульхенсио, Ян Кортегосо, Адриана Биде, Антонио Пагудо, Марта Хазас', txt(fm, '.udxf__fact--cast'));
check('fullpage(film): page rating gif produces no rating text (no value in HTML)', !/рейтинг/i.test(allText(fm)), allText(fm).slice(0, 160));
check('fullpage(film): no poster -> element removed (no undefined src)', findAll(fm, 'udxf__poster').length === 0, String(findAll(fm, 'udxf__poster').length));
check('fullpage(film): no imdb id -> enrichment slots stay hidden', (function () { const r = fm.find('.udxf__rate'); const o = fm.find('.udxf__orig'); const s = fm.find('.udxf__seasons'); return !!(r && o && s) && r.classes.has('hide') && o.classes.has('hide') && s.classes.has('hide') && r.text() === '' && o.text() === '' && s.text() === ''; })(), JSON.stringify([txt(fm, '.udxf__rate'), txt(fm, '.udxf__orig'), txt(fm, '.udxf__seasons')]));
check('fullpage(film): valid backdrop set exactly once (no duplicate node)', findAll(fm, 'udxf__backdrop').length === 1 && fm.find('.udxf__backdrop').style.backgroundImage === 'url("https://045.ultradox.click/upload/movie-fanart.jpg")' && fm.find('.udxf__backdrop').classes.has('udxf__backdrop--on'), fm.find('.udxf__backdrop') ? fm.find('.udxf__backdrop').style.backgroundImage : 'no backdrop element');

const foBtn = fm.find('.udxf__act--online');
const ftBtn = fm.find('.udxf__act--torrents');
check('fullpage(film): action strip present (online + TorrServer)', foBtn !== null && ftBtn !== null, String(!!foBtn) + ':' + String(!!ftBtn));
const fFetches = fetches.length;
const fPlays = L.Player.plays.length;
const fTorr = L.Torrent.calls.length;
L.Select.last = null;
foBtn.handlers['hover:enter'].forEach((f) => f());
const pushedFT = L.Activity.pushes[L.Activity.pushes.length - 1];
check('fullpage(film): "Онлайн" opens the dedicated release page with the film payload', !!pushedFT && pushedFT.component === 'ultradox_torrents' && pushedFT.detail.releases.length === 1, JSON.stringify(pushedFT && pushedFT.component));
check('fullpage(film): opening the page starts nothing (no request, no torrent, no L.Select)', fetches.length === fFetches && L.Torrent.calls.length === fTorr && L.Select.last === null, String(fetches.length - fFetches) + '/' + String(L.Torrent.calls.length - fTorr));

const lpF = new LP_T(pushedFT);
lpF.activity = { loader() {}, toggle() {} };
lpF.create();
const rowsF = findAll(lpF.render(), 'udxl__row');
check('fullpage(film): one real release listed as quality • size', rowsF.length === 1 && rowsF[0].find('.udxl__row__main').text() === 'WEB-DL 2160p • 20 GB', rowsF.map((r) => r.find('.udxl__row__main').text()).join('|'));
check('fullpage(film): raw release kept as inert data in the page payload', !!pushedFT && /^magnet:\?xt=urn:btih:aaaa1111bbbb2222/.test(pushedFT.detail.releases[0].magnet) && pushedFT.detail.releases[0].sizeBytes === 21474836480, String(pushedFT && pushedFT.detail.releases[0] && pushedFT.detail.releases[0].magnet).slice(0, 40));
rowsF[0].handlers['hover:enter'].forEach((f) => f());
picks++;
check('fullpage(film): pick hands off the exact release (MagnetUri/Size)', (function () {
    const c = L.Torrent.calls[L.Torrent.calls.length - 1];
    return L.Torrent.calls.length === fTorr + 1 && c.o.MagnetUri === pushedFT.detail.releases[0].magnet && c.o.Size === 21474836480 && c.o.Tracker === 'Ultradox' && c.movie.number_of_seasons === undefined;
})(), JSON.stringify(L.Torrent.calls[L.Torrent.calls.length - 1] && L.Torrent.calls[L.Torrent.calls.length - 1].o));

// "TorrServer" on the film detail: the core torrents search page with the
// film movie metadata (no seasons).
ftBtn.handlers['hover:enter'].forEach((f) => f());
const pushedFTs = L.Activity.pushes[L.Activity.pushes.length - 1];
check('fullpage(film): "TorrServer" opens the core torrents search page (title+year search, film metadata)', !!pushedFTs && pushedFTs.component === 'torrents' && pushedFTs.search === 'Great Movie 2023' && pushedFTs.search_one === 'Great Movie' && !!pushedFTs.movie && pushedFTs.movie.number_of_seasons === 0 && pushedFTs.movie.img === '', JSON.stringify(pushedFTs && { s: pushedFTs.search, m: pushedFTs.movie }));

// The film page carries no #iframe_block-player embed: the dedicated page
// (driven from its own payload - no longer a strip route) shows a clear
// in-page empty state, never an invented URL.
const fTorrAfterPick = L.Torrent.calls.length;
const oPayloadF = { title: pushedFT.title, component: 'ultradox_online', item: pushedFT.item, detail: pushedFT.detail, seasons: pushedFT.seasons };
const lpFO = new LP_O(oPayloadF);
lpFO.activity = { loader() {}, toggle() {} };
lpFO.create();
const lpoFilm = lpFO.render();
check('fullpage(film): no online embed -> clear in-page empty state, no player call, no new torrent', findAll(lpoFilm, 'udx-empty').length === 1 && findAll(lpoFilm, 'udx-empty')[0].text() === L.Lang.translate('ultradox_no_online') && L.Player.plays.length === fPlays && L.Torrent.calls.length === fTorrAfterPick, JSON.stringify({ empty: findAll(lpoFilm, 'udx-empty').map((e) => e.text()), plays: L.Player.plays.length - fPlays }));

// ---------- FullPage: dead online embed -> message, no player call ----------
// A page whose #iframe_block-player embed answers with an error (the live
// host returns 404 for origin-less requests): the pre-player probe must fail,
// the player must never start with a dead URL, and the user gets the clear
// "unavailable" message instead of a black screen.
console.log('fullpage: dead online embed');
const DEAD_EMBED = 'https://vid1799999999.sevstar933krop.com/movie/deadbeefdeadbeefdeadbeefdeadbeef/iframe?d=ultradox.ru';
const DEAD_URL = 'https://045.ultradox.click/nerufilm/dead-embed-2025.html';
ROUTES.set(DEAD_URL,
    '<html><head></head><body><ul>' +
    '<li><span>Жанр:</span> Драма</li>' +
    '<li itemprop="contributor"><span> Страна: </span> Індія</li>' +
    '<li><span>Год:</span> 2025</li>' +
    '</ul>' +
    '<div class="full-story_iframe-block" id="iframe_block-player">' +
    '<iframe src="' + DEAD_EMBED + '" width="100%" height="480"></iframe>' +
    '</div>' +
    '<a href="magnet:?xt=urn:btih:9999999999999999999999999999999999999999&amp;dn=Dead.Embed.2025.WEB-DLRip.mkv&amp;xl=1073741824"></a>' +
    '</body></html>');
const dead = new FP({ item: { title: 'Dead Embed (2025)', serial: false, itemUrl: DEAD_URL, poster: '' } });
dead.activity = { loader() {}, toggle() {} };
let deadErr = null;
try { dead.create(); } catch (e) { deadErr = e; }
check('fullpage(dead embed): build() did not throw', deadErr === null, deadErr && deadErr.constructor.name + ': ' + deadErr.message);
const dr = dead.render();
const dOBtn = dr.find('.udxf__act--online');
const dPlays = L.Player.plays.length;
const dTorr = L.Torrent.calls.length;
const dNoties = L.Noty.msgs.length;
const dFetches = fetches.length;
dOBtn.handlers['hover:enter'].forEach((f) => f());
check('fullpage(dead embed): the press opens the release list only (no player, no message yet)', L.Player.plays.length === dPlays && L.Noty.msgs.length === dNoties, JSON.stringify({ plays: L.Player.plays.length - dPlays, noties: L.Noty.msgs.length - dNoties }));
const pushedDO = L.Activity.pushes[L.Activity.pushes.length - 1];
check('fullpage(dead embed): the "Онлайн" push carries the dead-item release payload', !!pushedDO && pushedDO.component === 'ultradox_torrents' && !!pushedDO.detail && pushedDO.detail.releases.length === 1, JSON.stringify(pushedDO && { c: pushedDO.component, rel: pushedDO.detail && pushedDO.detail.releases.length }));
const lpD = new LP_O({ title: pushedDO.title, component: 'ultradox_online', item: pushedDO.item, detail: pushedDO.detail, seasons: pushedDO.seasons });
lpD.activity = { loader() {}, toggle() {} };
lpD.create();
const rowsD = findAll(lpD.render(), 'udxl__row');
check('fullpage(dead embed): the dead embed is listed (read-only, never started)', rowsD.length === 1 && txt(rowsD[0], '.udxl__row__sub') === 'vid1799999999.sevstar933krop.com' && L.Player.plays.length === dPlays && L.Torrent.calls.length === dTorr, rowsD.map((r) => txt(r, '.udxl__row__sub')).join('|'));
rowsD[0].handlers['hover:enter'].forEach((f) => f());
check('fullpage(dead embed): dead URL never reaches the player', L.Player.plays.length === dPlays, String(L.Player.plays.length - dPlays));
check('fullpage(dead embed): clear "unavailable" message shown', L.Noty.msgs.length === dNoties + 1 && L.Noty.msgs[L.Noty.msgs.length - 1] === L.Lang.translate('ultradox_online_unavailable'), JSON.stringify(L.Noty.msgs.slice(dNoties)));
check('fullpage(dead embed): page re-probed once plus the dead embed probe, no torrent started', fetches.length === dFetches + 2 && fetches[fetches.length - 2] === DEAD_URL && fetches[fetches.length - 1] === DEAD_EMBED && L.Torrent.calls.length === dTorr, String(fetches.length - dFetches) + ' new fetches');

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
const nbgTorr = L.Torrent.calls.length;
let nobgErr = null;
try { nobg.create(); } catch (e) { nobgErr = e; }
const nf = nobg.render();
check('fullpage(no backdrop): build() did not throw', nobgErr === null, nobgErr && nobgErr.constructor.name + ': ' + nobgErr.message);
check('fullpage(no backdrop): element present but stays off, image explicitly cleared (neutral fallback)', nf.find('.udxf__backdrop') !== null && !nf.find('.udxf__backdrop').classes.has('udxf__backdrop--on') && !nf.find('.udxf__backdrop').classes.has('udxf__backdrop--poster') && nf.find('.udxf__backdrop').style.backgroundImage === '' && nf.find('.udxf') !== null && !nf.find('.udxf').classes.has('udxf--poster'));
check('fullpage(no backdrop): no undefined/broken image left', (function () {
    const imgs = [];
    (function walk(n) { for (const c of n.children || []) { if (c && c.tagName === 'IMG') imgs.push(c); if (c && c.children) walk(c); } })(nf);
    return imgs.every((i) => typeof i.src === 'string' && i.src.length > 0);
})());
check('fullpage(no backdrop): detail still shows title and meta', nf.find('.udxf__title').text() === 'No Fanart' && nf.find('.udxf__line').text() === 'Трилер', txt(nf, '.udxf__line'));
check('fullpage(no facts): fact rows present but hidden and empty (no data)', (function () { const d = nf.find('.udxf__fact--director'); const c = nf.find('.udxf__fact--cast'); return !!(d && c) && d.classes.has('hide') && c.classes.has('hide') && d.text() === '' && c.text() === ''; })(), JSON.stringify([txt(nf, '.udxf__fact--director'), txt(nf, '.udxf__fact--cast')]));
check('fullpage(no backdrop): no torrent started', L.Torrent.calls.length === nbgTorr, String(L.Torrent.calls.length - nbgTorr));

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
check('fullpage(pixhost): visible backgroundImage is the plain poster url (no placeholder text, no embedded gradient)', (function () {
    const b = sp.find('.udxf__backdrop');
    return b !== null && b.style.backgroundImage === 'url("https://045.ultradox.click/upload/c.jpg")' && b.style.backgroundImage.indexOf('gradient') === -1 && b.style.backgroundImage.indexOf('Picture removed') === -1;
})(), sp.find('.udxf__backdrop') ? String(sp.find('.udxf__backdrop').style.backgroundImage) : 'no backdrop element');
check('fullpage(pixhost): only the poster fallback modifier applied', sp.find('.udxf__backdrop').classes.has('udxf__backdrop--poster') && !sp.find('.udxf__backdrop').classes.has('udxf__backdrop--on'));
check('fullpage(pixhost): poster state on the root enables the zone veil', sp.find('.udxf') !== null && sp.find('.udxf').classes.has('udxf--poster'), String(sp.find('.udxf') && sp.find('.udxf').classes));
check('fullpage(pixhost): exactly one backdrop element (no second node)', findAll(sp, 'udxf__backdrop').length === 1, String(findAll(sp, 'udxf__backdrop').length));
check('fullpage(pixhost): poster kept', sp.find('.udxf__poster') && sp.find('.udxf__poster').src === 'https://045.ultradox.click/upload/c.jpg', sp.find('.udxf__poster') ? sp.find('.udxf__poster').src : 'no poster element');
check('fullpage(pixhost): title kept', txt(sp, '.udxf__title') === 'Любитель акул встречает девушку', txt(sp, '.udxf__title'));
check('fullpage(pixhost): overview kept', txt(sp, '.udxf__overview') === 'Детектив про любителля акул.', txt(sp, '.udxf__overview'));
check('fullpage(pixhost): action strip kept (online + TorrServer), old button gone', sp.find('.udxf__act--online') !== null && sp.find('.udxf__act--torrents') !== null && sp.find('.udx-f__play') === null, String(!!(sp.find('.udxf__act--online') && sp.find('.udxf__act--torrents'))));
const sTorr = L.Torrent.calls.length;
const sFetches = fetches.length;
L.Select.last = null;
sp.find('.udxf__act--online').handlers['hover:enter'].forEach((f) => f());
const pushedS = L.Activity.pushes[L.Activity.pushes.length - 1];
const lpS = new LP_T(pushedS);
lpS.activity = { loader() {}, toggle() {} };
lpS.create();
const rowsS = findAll(lpS.render(), 'udxl__row');
check('fullpage(pixhost): release listed without execution (list open never starts a torrent)', rowsS.length === 1 && rowsS[0].find('.udxl__row__main').text() === 'WEB-DL • 6.8 GB' && /^magnet:\?xt=urn:btih:deadbeef/.test(pushedS.detail.releases[0].magnet) && L.Torrent.calls.length === sTorr && fetches.length === sFetches, rowsS.map((r) => r.find('.udxl__row__main').text()).join('|'));

// ---------- FullPage: a pixhost-hosted POSTER must not reach the background ----------
// The og:image above is rejected for the backdrop; the same host family must
// also be rejected when it arrives as item.poster - otherwise the full-screen
// backdrop would render the "Picture removed" placeholder. The left <img> is
// untouched (it is not the backdrop).
console.log('fullpage: pixhost poster rejected for the backdrop');
const PPHOST_URL = 'https://045.ultradox.click/nerufilm/no-fanart-pixhost-poster.html';
ROUTES.set(PPHOST_URL,
    '<html><head></head><body><ul>' +
    '<li><span>Жанр:</span> Драма</li>' +
    '<li itemprop="contributor"><span> Страна: </span> США</li>' +
    '<li><span>Год:</span> 2024</li>' +
    '</ul>' +
    '<a href="magnet:?xt=urn:btih:4444444444444444444444444444444444444444&amp;dn=Pixhost.Poster.2024.WEB-DLRip.mkv&amp;xl=1073741824"></a>' +
    '</body></html>');
const pp = new FP({ item: { title: 'Pixhost Poster (2024)', serial: false, itemUrl: PPHOST_URL, poster: 'https://t3.pixhost.cc/6852/removed-placeholder.jpg' } });
pp.activity = { loader() {}, toggle() {} };
pp.create();
const pr = pp.render();
check('fullpage(pixhost poster): neutral fallback - the pixhost URL stays out of the background-image', (function () {
    const b = pr.find('.udxf__backdrop');
    return b !== null && b.style.backgroundImage === '' && !b.classes.has('udxf__backdrop--on') && !b.classes.has('udxf__backdrop--poster') && pr.find('.udxf') !== null && !pr.find('.udxf').classes.has('udxf--poster');
})(), pr.find('.udxf__backdrop') ? String(pr.find('.udxf__backdrop').style.backgroundImage) + ':' + String(pr.find('.udxf__backdrop').classes) : 'no backdrop element');
check('fullpage(pixhost poster): the left poster element keeps the raw URL untouched', pr.find('.udxf__poster') && pr.find('.udxf__poster').src === 'https://t3.pixhost.cc/6852/removed-placeholder.jpg', pr.find('.udxf__poster') ? pr.find('.udxf__poster').src : 'no poster element');

// ---------- FullPage: multi-release detail -> every release listed ----------
// No quality pre-filter in Phase 4: "Онлайн" lists every release of the
// item; the user just picks the concrete row they want, and that pick (only
// that pick) drives the standard TorrServer handoff.
console.log('fullpage: multi-release detail');
const MULTI_URL = 'https://045.ultradox.click/serial/multi-quality-2022/';
ROUTES.set(MULTI_URL,
    '<html><head></head><body><ul>' +
    '<li><span>Жанр:</span> Кримінал</li>' +
    '<li itemprop="contributor"><span> Страна: </span> США</li>' +
    '<li><span>Год:</span> 2022</li>' +
    '</ul>' +
    '<a href="magnet:?xt=urn:btih:1111111111111111111111111111111111111111&amp;dn=Multi.Show.S01.E01.1080p.WEB-DLRip.mkv&amp;xl=10737418240"></a>' +
    '<a href="magnet:?xt=urn:btih:2222222222222222222222222222222222222222&amp;dn=Multi.Show.S01.E02.1080p.WEB-DLRip.mkv&amp;xl=10737418240"></a>' +
    '<a href="magnet:?xt=urn:btih:3333333333333333333333333333333333333333&amp;dn=Multi.Show.S01.E03.720p.BDRip.mkv&amp;xl=5368709120"></a>' +
    '</body></html>');
const multi = new FP({ item: { title: 'Multi Quality (2022)', serial: true, itemUrl: MULTI_URL, poster: '' } });
multi.activity = { loader() {}, toggle() {} };
multi.create();

const mOBtn = multi.render().find('.udxf__act--online');
L.Select.last = null;
mOBtn.handlers['hover:enter'].forEach((f) => f());
const pushedM = L.Activity.pushes[L.Activity.pushes.length - 1];
check('multi: "Онлайн" opens the dedicated release page with every release of the item (3)', !!pushedM && pushedM.component === 'ultradox_torrents' && pushedM.detail.releases.length === 3, JSON.stringify(pushedM && pushedM.detail && pushedM.detail.releases.length));
const lpM = new LP_T(pushedM);
lpM.activity = { loader() {}, toggle() {} };
lpM.create();
const rowsM = findAll(lpM.render(), 'udxl__row');
check('multi: every release listed as a quality • size row', rowsM.length === 3 && rowsM.map((r) => r.find('.udxl__row__main').text()).join('|') === 'WEB-DL 1080p • 10 GB|WEB-DL 1080p • 10 GB|BDRIP 720p • 5.0 GB', rowsM.map((r) => r.find('.udxl__row__main').text()).join('|'));
check('multi: release rows keep the raw release as inert data in the page payload', !!pushedM && pushedM.detail.releases.every((r) => typeof r.magnet === 'string' && typeof r.sizeBytes === 'number'), JSON.stringify(pushedM && pushedM.detail.releases.map((r) => String(r.magnet).slice(0, 24))));

const mTorr = L.Torrent.calls.length;
const mNoties = L.Noty.msgs.length;
rowsM[2].handlers['hover:enter'].forEach((f) => f());
picks++;
check('multi: picking the 720p row hands off exactly that release', (function () {
    const c = L.Torrent.calls[L.Torrent.calls.length - 1];
    const r = pushedM.detail.releases[2];
    return L.Torrent.calls.length === mTorr + 1 && /^magnet:\?xt=urn:btih:333333333333/.test(r.magnet) && c.o.MagnetUri === r.magnet && c.o.Size === 5368709120;
})(), JSON.stringify(L.Torrent.calls[L.Torrent.calls.length - 1] && L.Torrent.calls[L.Torrent.calls.length - 1].o));
check('multi: the pick runs the standard flow silently (no stray noty)', L.Noty.msgs.length === mNoties, JSON.stringify(L.Noty.msgs.slice(mNoties)));

// ---------- empty detail: no releases -> noty, selector untouched ----------
console.log('fullpage: empty detail');
const missing = new FP({ item: { title: 'Missing (1999)', serial: false, itemUrl: 'https://045.ultradox.click/serial/missing-1999/', poster: '' } });
missing.activity = { loader() {}, toggle() {} };
missing.create();
const missRoot = missing.render();
const missO = missRoot.find('.udxf__act--online');
const selBefore = L.Select.last;
const mNoties0 = L.Noty.msgs.length;
const mPlays0 = L.Player.plays.length;
const mTorr0 = L.Torrent.calls.length;
const mFetches0 = fetches.length;
check('fullpage: enrichment slots stay hidden on the empty model', (function () { const r = missRoot.find('.udxf__rate'); return !!r && r.classes.has('hide') && r.text() === ''; })(), String(!!missRoot.find('.udxf__rate')));
check('fullpage: failed fetch (empty model) -> fact rows hidden and empty', (function () { const d = missing.render().find('.udxf__fact--director'); const c = missing.render().find('.udxf__fact--cast'); return !!(d && c) && d.classes.has('hide') && c.classes.has('hide') && d.text() === '' && c.text() === ''; })(), JSON.stringify([txt(missing.render(), '.udxf__fact--director'), txt(missing.render(), '.udxf__fact--cast')]));

// both strip controls on an empty release list: the dedicated release page
// answers with the clear in-page empty state (no releases), the core torrents
// push carries the bare-title search (the failed detail has no year), the
// online page (own payload) answers with its clear empty state - no selector,
// no error, no execution
let mErr = null;
try {
    missO.handlers['hover:enter'].forEach((f) => f());
    const pushedMT = L.Activity.pushes[L.Activity.pushes.length - 1];
    const lpeT = new LP_T(pushedMT);
    lpeT.activity = { loader() {}, toggle() {} };
    lpeT.create();
    const emT = findAll(lpeT.render(), 'udx-empty');
    check('fullpage(empty): no releases -> the dedicated page shows the clear empty state (no selector, no noty)', L.Select.last === selBefore && emT.length === 1 && emT[0].text() === L.Lang.translate('ultradox_no_link') && L.Noty.msgs.length === mNoties0 && L.Torrent.calls.length === mTorr0, JSON.stringify({ select: !!L.Select.last, empty: emT.map((e) => e.text()), noties: L.Noty.msgs.slice(mNoties0) }));

    const mRoot = missing.render();
    const mT2 = mRoot.find('.udxf__act--torrents');
    mT2.handlers['hover:enter'].forEach((f) => f());
    const pushedMTs = L.Activity.pushes[L.Activity.pushes.length - 1];
    check('fullpage(empty): "TorrServer" opens the core torrents search page with the bare-title search (no year in the failed detail)', !!pushedMTs && pushedMTs.component === 'torrents' && pushedMTs.search === 'Missing' && pushedMTs.search_one === 'Missing' && !!pushedMTs.movie && pushedMTs.movie.number_of_seasons === 0 && L.Select.last === selBefore, JSON.stringify(pushedMTs && { c: pushedMTs.component, s: pushedMTs.search }));

    const lpeO = new LP_O({ title: pushedMT.title, component: 'ultradox_online', item: pushedMT.item, detail: pushedMT.detail, seasons: pushedMT.seasons });
    lpeO.activity = { loader() {}, toggle() {} };
    lpeO.create();
    const lpeRoot = lpeO.render();
    const emO = findAll(lpeRoot, 'udx-empty');
    check('fullpage(empty): the online page answers with the clear empty state (fetch fail-safe, no player, no torrent)', emO.length === 1 && emO[0].text() === L.Lang.translate('ultradox_no_online') && L.Player.plays.length === mPlays0 && L.Torrent.calls.length === mTorr0, JSON.stringify({ empty: emO.map((e) => e.text()), plays: L.Player.plays.length - mPlays0, torr: L.Torrent.calls.length - mTorr0 }));
    check('fullpage(empty): the online probe touched only the item page (mirror), nothing else', fetches.length === mFetches0 + 1 && fetches[fetches.length - 1] === 'https://045.ultradox.click/serial/missing-1999/', fetches.slice(mFetches0).join('|'));
} catch (e) { mErr = e; }
check('fullpage(empty): the dedicated pages did not throw', mErr === null, mErr && mErr.constructor.name + ': ' + mErr.message);

// ---------- TMDB enrichment fail-safes: a failing/broken core integration must
// never break the detail page (best-effort contract) ----------
console.log('fullpage: TMDB enrichment fail-safes');
L.TMDB.mode = 'fail';
const tfFail = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: '' } });
tfFail.activity = { loader() {}, toggle() {} };
let tfErr = null;
try { tfFail.create(); } catch (e) { tfErr = e; }
check('tmdb(fail): a failing core integration does not break the build', tfErr === null && tfFail.render().find('.udxf__title').text() === 'Show Name', tfErr && tfErr.message);
check('tmdb(fail): enrichment slots stay hidden, page keeps the Ultradox data', (function () { const r = tfFail.render().find('.udxf__rate'); const o = tfFail.render().find('.udxf__orig'); const s = tfFail.render().find('.udxf__seasons'); return !!(r && o && s) && r.classes.has('hide') && o.classes.has('hide') && s.classes.has('hide'); })(), 'slot revealed or missing');
check('tmdb(fail): the attempt went through the core door exactly once', L.TMDB.touches === 4, String(L.TMDB.touches));

L.TMDB.mode = 'throw';
const tfThrow = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: '' } });
tfThrow.activity = { loader() {}, toggle() {} };
let ttErr = null;
try { tfThrow.create(); } catch (e) { ttErr = e; }
check('tmdb(throw): a broken (throwing) integration is a silent no-op', ttErr === null && tfThrow.render().find('.udxf__overview').text() === 'Детективний серіал про агентку.', ttErr && ttErr.message);
check('tmdb(throw): enrichment slots stay hidden', (function () { const r = tfThrow.render().find('.udxf__rate'); return !!r && r.classes.has('hide'); })(), String(!!tfThrow.render().find('.udxf__rate')));
check('tmdb(throw): the attempt counted, the page unaffected', L.TMDB.touches === 5, String(L.TMDB.touches));
L.TMDB.mode = 'ok';

// ---------- no external metadata transport: a repeated detail page fetches nothing beyond the mirror ----------
console.log('metadata: no external metadata transport');
const series2 = new FP({ item: { title: 'Show Name (2021)', serial: true, itemUrl: SERIES_URL, poster: '' } });
series2.activity = { loader() {}, toggle() {} };
series2.create();
check('metadata: repeated detail re-applies the enrichment via the core door (3 more times)', (function () { const e = series2.render().find('.udxf__rate'); return !!e && !e.classes.has('hide') && e.text().indexOf('8.1') !== -1 && L.TMDB.touches === 8; })(), String(L.TMDB.touches) + ':' + txt(series2.render(), '.udxf__rate'));
check('metadata: repeated detail renders one strip only (no duplication)', findAll(series2.render(), 'udxf__actions').length === 1, String(findAll(series2.render(), 'udxf__actions').length));

// ---------- 6. network: public mirrors only ----------
check('network: only public mirrors + the item own embed probed (no external metadata service)', fetches.every((u) => MIRRORS.some((m) => u.indexOf(m) === 0) || u === SERIES_EMBED || u === DEAD_EMBED), JSON.stringify(fetches));

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
check('torrent: L.Torrent.start counter equals the explicit row picks (' + picks + ')', L.Torrent.calls.length === picks, String(L.Torrent.calls.length));
check('player: every L.Player.play corresponds to an explicit embed row pick (1)', L.Player.plays.length === 1 && L.Player.plays[0].url === SERIES_EMBED, JSON.stringify(L.Player.plays.map((p) => p.url)));
console.log(failures ? 'FAIL (' + failures + ' check(s) failed)' : 'PASS');
process.exitCode = failures ? 1 : 0;
