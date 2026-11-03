/*
 * Lampa plugin: Ultradox (OCTOPUS) -> TorrServer
 * Install: add the published CDN URL (jsDelivr, pinned by commit SHA) in Lampa:
 *          Settings -> Plugins -> +  (e.g. https://cdn.jsdelivr.net/gh/vaservaga/lampa-plugins@<commit-sha>/plugins/ultradox/ultradox.js)
 * Requires Lampa already configured to use TorrServer (internal torrclient + TorrServer URL).
 *
 * UI (Phase 5, NUM parity): core card grid (.category-full + Template 'card')
 * with the type badge top-left, quality badge bottom-left and the year under
 * the title; category buttons in the head (simple-button); full detail page
 * (validated backdrop, poster left, meta, overview) with exactly two actions:
 *   left  "Онлайн"    -> ultradox_torrents: the item's real releases
 *                        (NUM-style: the item's info card on the left, the
 *                        item's real rows on the right - quality • size
 *                        rows, upload date from the "torrent_N_info"
 *                        blocks). The standard Lampa torrent flow
 *                        (L.Torrent.start with MagnetUri/Size, exactly as
 *                        the earlier Ultradox build used it) runs only
 *                        after an explicit row pick.
 *   right "TorrServer"-> the core Lampa torrents search page (component
 *                        'torrents'): the title (+year) search combination
 *                        and the item's movie metadata; the result list is
 *                        rendered by the core from the parser response.
 * No button ever starts a magnet/download/playback on its own. The
 * ultradox_online page (the site's real embeds, probed read-only; the
 * standard Lampa player call runs only from an explicit row pick there)
 * stays a registered component, driven from its own payload.
 * The base data comes from the Ultradox HTML itself. TMDB enrichment
 * (rating, original title, seasons) is best-effort through the already
 * present Lampa core integration only (Lampa.TMDB.api + L.Reguest.silent);
 * when it is unavailable or fails the detail page keeps working with the
 * Ultradox data alone. No key is ever hardcoded in this plugin.
 */
(function () {
    'use strict';

    if (window.plugin_ultradox_ready) return;
    if (!window.Lampa) {
        // Lampa is not ready yet: wait for it. All top-level definitions below
        // must run regardless, so boot() is deferred to the end of this IIFE.
        document.addEventListener('DOMContentLoaded', function () { if (window.Lampa) boot(); });
    }

    // Direct mode: public mirrors only, no LAN dependency. Primary is 045.ultradox.click;
    // 010.ultadox.space is a verified alias (same HTML structure, redirects to 045).
    var MIRRORS = ['https://045.ultradox.click', 'https://010.ultadox.space'];
    // Images are rendered by the HTTPS WebView; pin them to a verified public HTTPS origin.
    var POSTER_ORIGIN = 'https://045.ultradox.click';
    var HIDE_RUSSIAN_PRODUCTIONS = true;
    var countryCache = {};

    var CATS = [
        { id: 'serial', path: '/serial/', title: 'Серіали' },
        { id: 'hd', path: '/hd/', title: 'HDRIP / BDRIP' },
        { id: 'webrips', path: '/webrips/', title: 'WEB-DL' }
    ];

    var PAGE = 20;
    var MAX_PAGE = 30;
    var goodBase = null;

    var ICON_MENU = '<svg width="38" height="31" viewBox="0 0 38 31" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3h6v9c0 5-3 8-7 9 2 1 4 3 4 6v10h-6V27c0-4-3-7-7-8-4-1-7-4-7-9V3h6v9c0 4 3 6 7 6s7-2 7-6V3z" fill="currentColor"/><path d="M22 3h6v9c0 5-3 8-7 9 2 1 4 3 4 6v10h-6V27c0-4-3-7-7-8V3z" fill="currentColor" opacity="0.55"/></svg>';
    // Globe mark for the online action (own minimal mark; no play triangle).
    var ICON_ONLINE = '<svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" stroke="currentColor" stroke-width="1.7"/></svg>';
    // List pictogram for the releases button: a plain list, no play hint.
    var ICON_RELEASES = '<svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 5.5h11M8.5 12h11M8.5 18.5h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="4.2" cy="5.5" r="1.5" fill="currentColor"/><circle cx="4.2" cy="12" r="1.5" fill="currentColor"/><circle cx="4.2" cy="18.5" r="1.5" fill="currentColor"/></svg>';

    var CONTENT_HTML =
        '<div class="udx-content">' +
            '<div class="udx-bg udx-bg--first" aria-hidden="true"></div>' +
            '<div class="udx-bg udx-bg--second" aria-hidden="true"></div>' +
            '<div class="udx-bg__veil" aria-hidden="true"></div>' +
            '<div class="udx-content__head">' +
                '<div class="udx-content__cats"></div>' +
            '</div>' +
            '<div class="udx-content__list"></div>' +
        '</div>';

    var DETAIL_HTML =
        '<div class="udxf">' +
            '<div class="udxf__backdrop" aria-hidden="true"></div>' +
            '<div class="udxf__gradient" aria-hidden="true"></div>' +
            '<div class="udxf__body">' +
                '<img class="udxf__poster" alt="">' +
                '<div class="udxf__meta">' +
                    '<div class="udxf__top"></div>' +
                    '<div class="udxf__title"></div>' +
                    '<div class="udxf__rate hide"></div>' +
                    '<div class="udxf__orig hide"></div>' +
                    '<div class="udxf__line"></div>' +
                    '<div class="udxf__seasons hide"></div>' +
                    '<div class="udxf__overview"></div>' +
                    '<div class="udxf__fact udxf__fact--director"></div>' +
                    '<div class="udxf__fact udxf__fact--cast"></div>' +
                    '<div class="udxf__actions">' +
                        '<div class="simple-button selector udxf__act udxf__act--online">' + ICON_ONLINE + '<span class="udxf__act__label udxf__olab"></span></div>' +
                        '<div class="simple-button selector udxf__act udxf__act--torrents">' + ICON_RELEASES + '<span class="udxf__act__label udxf__tlab"></span></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

    // The dedicated full-page list screens (ultradox_online /
    // ultradox_torrents): the item's info card on the left, the item's real
    // rows on the right (NUM-style).
    var LIST_HTML =
        '<div class="udxl">' +
            '<div class="udxl__backdrop" aria-hidden="true"></div>' +
            '<div class="udxl__veil" aria-hidden="true"></div>' +
            '<div class="udxl__body">' +
                '<div class="udxl__card">' +
                    '<img class="udxl__poster" alt="">' +
                    '<div class="udxl__title"></div>' +
                    '<div class="udxl__meta"></div>' +
                '</div>' +
                '<div class="udxl__list"></div>' +
            '</div>' +
        '</div>';

    var STYLE_HTML = '<style id="ultradox-style">' +
        '.udx-content{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udx-bg{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;background:center/cover no-repeat;transform:scale(1.10);filter:blur(20px) brightness(.55) saturate(.78);opacity:0;transition:opacity .32s ease;}' +
        '.udx-bg--on{opacity:1;}' +
        '.udx-bg__veil{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.78),rgba(6,28,41,.30) 60%),linear-gradient(to top,rgba(6,28,41,.70),rgba(6,28,41,0) 42%);}' +
        '.udx-content__head{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;padding:14px 20px;background:linear-gradient(rgba(0,0,0,.55),transparent);}' +
        '.udx-content__cats{display:flex;align-items:center;}' +
        '.udx-cat{flex-shrink:0;}' +
        '.udx-cat__label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udx-cat.udx-active{background-color:#fff;color:#000;}' +
        '.udx-content__list{position:relative;z-index:1;padding-top:80px;}' +
        '.udx-empty{width:100%;text-align:center;padding:5em 0;color:#9aa4b2;font-size:1.5em;}' +
        '.udx-content .card__view{position:relative;overflow:hidden;}' +
        '.udx-content .card__title{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:2.5em;font-size:1em;line-height:1.25em;font-weight:600;color:#fff;}' +
        '.udx-content .card__age{min-height:1.4em;font-size:0.85em;line-height:1.4em;color:#9aa4b2;}' +
        '.udx-chip{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;align-items:stretch;max-width:calc(100% - 20px);overflow:hidden;border-bottom-left-radius:0.55em;pointer-events:none;}' +
        '.udx-chip span{font-size:0.75em;line-height:1.5;padding:0 0.55em;white-space:nowrap;}' +
        '.udx-chip__quality{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.88);color:#14202a;}' +
        '.udxf{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udxf__backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;background:center/cover no-repeat;opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        '.udxf__backdrop--on{opacity:1;}' +
        '.udxf__backdrop--poster{opacity:1;transform:scale(1.1);filter:blur(22px) brightness(.72) saturate(.82);}' +
        '.udxf__gradient{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.55),rgba(6,28,41,.88) 72%);}' +
        // Poster-fallback state (.udxf--poster on the root): the poster doubles
        // as the backdrop, so the veil darkens the left text zone and the bottom
        // rows (title/overview/actions) and fades to clear artwork toward the
        // right and the top - no layer is opaque, so the image stays visible
        // as atmosphere on the right.
        '.udxf--poster .udxf__gradient{background:linear-gradient(90deg,rgba(6,28,41,.84),rgba(6,28,41,.52) 46%,rgba(6,28,41,0) 78%),linear-gradient(to top,rgba(6,28,41,.62),rgba(6,28,41,0) 44%);}' +
        '.udxf__body{position:relative;z-index:2;height:100%;display:flex;align-items:center;padding:0 6% 0 5%;box-sizing:border-box;}' +
        '.udxf__poster{flex-shrink:0;width:12em;border-radius:.5em;background:#3E3E3E;box-shadow:0 .8em 2em rgba(0,0,0,.55);}' +
        '.udxf__meta{margin-left:2.2em;min-width:0;max-width:62%;}' +
        '.udxf__top{font-size:1.05em;color:#cdd8e4;letter-spacing:.03em;}' +
        '.udxf__title{font-size:2.1em;font-weight:700;line-height:1.15;color:#fff;margin-top:.35em;}' +
        '.udxf__line{font-size:1.05em;color:#9fb2c4;margin-top:.9em;}' +
        '.udxf__overview{font-size:1.05em;line-height:1.4;color:#e7eef5;margin-top:1em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}' +
        // Compact horizontal action strip: one quality selector + one
        // "Torrents" button, ~62px tall at the 1080p root font (3.7em of the
        // 1.05em button font), 1em gap, two-line wrap on narrow columns.
        '.udxf__actions{display:flex;align-items:center;flex-wrap:wrap;gap:1em;margin-top:1.6em;}' +
        '.udxf__act{display:inline-flex;align-items:center;justify-content:center;gap:.6em;height:3.7em;padding:0 1.25em;border-radius:1.05em;font-size:1.05em;font-weight:600;line-height:1;white-space:nowrap;flex:0 1 auto;max-width:100%;color:#fff;background:transparent;}' +
        '.udxf__act svg{flex:0 0 auto;opacity:.92;}' +
        '.udxf__act__label{min-width:0;overflow:hidden;text-overflow:ellipsis;}' +
        '.udxf__act--online{background:rgba(9,29,43,.62);border:1px solid rgba(255,255,255,.24);color:#dbe7f2;}' +
        '.udxf__act--online.focus{border-color:rgba(255,255,255,.55);transform:translateY(-.1em);box-shadow:0 .3em .8em rgba(0,0,0,.38);}' +
        '.udxf__act--torrents{background:linear-gradient(135deg,#18b7d8 0%,#2e6bf0 100%);border:1px solid rgba(255,255,255,.20);}' +
        '.udxf__act--torrents.focus{transform:translateY(-.1em);box-shadow:0 .4em .9em rgba(0,0,0,.42),0 0 0 .22em rgba(56,197,255,.28);}' +
        '.udx-kind{position:absolute;left:10px;top:10px;z-index:2;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;background:#57F570;color:#0f3d1a;font-weight:700;padding:0 .55em;border-radius:.45em;font-size:.75em;line-height:1.5;white-space:nowrap;pointer-events:none;}' +
        '.udxf__fact{font-size:1.05em;line-height:1.45;color:#9fb2c4;margin-top:.8em;}' +
        // TMDB enrichment slots: hidden until a real value arrives (best-effort,
        // the page never waits for them and keeps working without any of them).
        '.udxf .hide{display:none;}' +
        '.udxf__rate{font-size:1.05em;font-weight:600;color:#ffd66b;margin-top:.6em;}' +
        '.udxf__orig{font-size:1em;color:#9fb2c4;margin-top:.3em;}' +
        '.udxf__seasons{font-size:1.05em;color:#9fb2c4;margin-top:.8em;}' +
        // Full-page list screens (NUM-style: info card left, real rows right).
        '.udxl{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udxl__backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;background:center/cover no-repeat;opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        '.udxl__backdrop--on{opacity:1;}' +
        '.udxl__backdrop--poster{opacity:1;transform:scale(1.1);filter:blur(22px) brightness(.72) saturate(.82);}' +
        '.udxl__veil{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.62),rgba(6,28,41,.26) 55%),linear-gradient(to top,rgba(6,28,41,.58),rgba(6,28,41,0) 46%);}' +
        '.udxl__body{position:relative;z-index:2;height:100%;display:flex;align-items:center;padding:0 5%;box-sizing:border-box;gap:2em;}' +
        '.udxl__card{flex:0 0 auto;width:11em;display:flex;flex-direction:column;align-items:center;gap:.7em;}' +
        '.udxl__poster{width:100%;border-radius:.5em;background:#3E3E3E;box-shadow:0 .8em 2em rgba(0,0,0,.55);}' +
        '.udxl__title{font-size:1.25em;font-weight:700;line-height:1.25;color:#fff;text-align:center;}' +
        '.udxl__meta{font-size:.95em;line-height:1.45;color:#9fb2c4;text-align:center;}' +
        '.udxl__list{flex:1 1 auto;min-width:0;height:86%;position:relative;}' +
        '.udxl__rows{width:100%;}' +
        '.udxl__row{display:block;width:100%;margin:.5em 0;padding:.65em 1.1em;border-radius:.9em;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);text-align:left;box-sizing:border-box;}' +
        '.udxl__row.focus{background:rgba(56,197,255,.14);border-color:rgba(56,197,255,.55);transform:translateX(.15em);}' +
        '.udxl__row__main{font-size:1.05em;font-weight:600;line-height:1.35;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udxl__row__sub{font-size:.9em;line-height:1.35;color:#9fb2c4;margin-top:.2em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '</style>';

    function boot() {
        var L = window.Lampa;
        window.plugin_ultradox_ready = true;

        L.Lang.add({
            ultradox_title: { uk: 'Ultradox', ru: 'Ultradox', en: 'Ultradox', be: 'Ultradox' },
            ultradox_empty: { uk: 'Нічого не знайдено', ru: 'Ничего не найдено', en: 'Nothing found', be: 'Нічога не знайдзена' },
            ultradox_no_link: { uk: 'Немає посилання на торент', ru: 'Нет ссылки на торрент', en: 'No torrent link', be: 'Няма спасылкі' },
            ultradox_online: { uk: 'Онлайн', ru: 'Онлайн', en: 'Online', be: 'Анлайн' },
            ultradox_no_online: { uk: 'Немає онлайн-джерела', ru: 'Нет онлайн-источника', en: 'No online source', be: 'Няма анлайн-крыніцы' },
            ultradox_online_unavailable: { uk: 'Онлайн-джерело недоступне', ru: 'Онлайн-источник недоступен', en: 'Online source unavailable', be: 'Анлайн-крыніца недаступная' },
            ultradox_torrserver: { uk: 'TorrServer', ru: 'TorrServer', en: 'TorrServer', be: 'TorrServer' },
            ultradox_rating: { uk: 'Рейтинг', ru: 'Рейтинг', en: 'Rating', be: 'Рэйтынг' },
            ultradox_seasons: { uk: 'Сезонів', ru: 'Сезонов', en: 'Seasons', be: 'Сезонаў' },
            ultradox_director: { uk: 'Режисер', ru: 'Режиссёр', en: 'Director', be: 'Рэжысёр' },
            ultradox_cast: { uk: 'У ролях', ru: 'В ролях', en: 'Starring', be: 'У ролях' }
        });

        L.Manifest.plugins = {
            type: 'torrent',
            version: '2.0.0',
            name: L.Lang.translate('ultradox_title'),
            description: 'Ultradox/OCTOPUS release list -> TorrServer',
            component: 'ultradox'
        };

        L.Component.add('ultradox', Component);
        L.Component.add('ultradox_full', FullPage);
        L.Component.add('ultradox_online', ListPage);
        L.Component.add('ultradox_torrents', ListPage);

        function addMenu() {
            if ($('.menu .menu__list').length == 0) return;
            if ($('.menu .menu__list .udx-menu-item').length > 0) return;

            var t = L.Lang.translate('ultradox_title');
            var button = $(
                '<li class="menu__item selector udx-menu-item">' +
                    '<div class="menu__ico">' + ICON_MENU + '</div>' +
                    '<div class="menu__text">' + t + '</div>' +
                '</li>'
            );
            button.on('hover:enter', function () {
                L.Activity.push({ url: '', title: t, component: 'ultradox', page: 1, category: 'serial' });
            });
            $('.menu .menu__list').eq(0).append(button);
            if (!$('#ultradox-style').length) $('body').append(STYLE_HTML);
        }

        if (window.appready) addMenu();
        else L.Listener.follow('app', function (e) { if (e.type == 'ready') addMenu(); });
    }

    function catBy(id) {
        for (var i = 0; i < CATS.length; i++) if (CATS[i].id == id) return CATS[i];
        return CATS[0];
    }

    function NavCanMove(d) {
        try { return typeof Navigator !== 'undefined' && Navigator.canmove && Navigator.canmove(d); } catch (e) { return false; }
    }
    function NavMove(d) {
        try { if (typeof Navigator !== 'undefined' && Navigator.move) Navigator.move(d); } catch (e) {}
    }

    function fetchText(url, ok, err) {
        var net = new window.Lampa.Reguest();
        net.timeout(20000);
        net.native(url, ok, err, undefined, { dataType: 'text' });
    }

    // Best-effort TMDB through the already-present Lampa core integration:
    // Lampa.TMDB.api builds the request URL (auth comes from the Lampa
    // account/settings, exactly like the core and the tmdb_proxy plugin do);
    // this plugin never carries a key of its own. Any absence or failure of
    // that integration is reported to the err callback and silently ignored
    // by the detail page (it keeps working with the Ultradox data alone).
    function tmdbAvailable() {
        try { return !!(window.Lampa && window.Lampa.TMDB && typeof window.Lampa.TMDB.api === 'function'); } catch (e) { return false; }
    }

    function tmdbLang() {
        try { var l = window.Lampa.Storage.get('tmdb_lang', 'ru'); return (l ? String(l) : 'ru') || 'ru'; } catch (e) { return 'ru'; }
    }

    function tmdbJson(path, ok, err) {
        if (!tmdbAvailable()) { if (err) err(new Error('tmdb unavailable')); return; }
        var url = '';
        try { url = window.Lampa.TMDB.api(path); } catch (e) { if (err) err(e); return; }
        var net = new window.Lampa.Reguest();
        net.timeout(15000);
        net.silent(url, ok, err);
    }

    function countryFromDetail(html) {
        var m = (html || '').match(/<li[^>]*itemprop="contributor"[^>]*>\s*<span>\s*Страна:\s*<\/span>\s*([^<]+)/i);
        return m ? strip(m[1]) : '';
    }

    // Detail-page payload for the full release page: metadata lines, the plot
    // overview (technical tail like "Формат: ..." cut off), the IMDB id embedded
    // in the ratings block, a validated backdrop, and the concrete release list.
    function parseDetail(html) {
        var out = {
            overview: '', genre: '', country: '', year: '', runtime: '',
            translation: '', quality: '', director: '', cast: '', imdb: '',
            backdrop: '', online: '', releases: []
        };
        if (!html) return out;
        function field(re) { var m = html.match(re); return m ? strip(m[1]) : ''; }

        var dm = html.match(/<meta name="description" content="([\s\S]*?)">/);
        if (dm) {
            var ov = decode(dm[1]);
            var cut = ov.match(/\sФормат:/);
            if (cut) ov = ov.slice(0, cut.index);
            out.overview = ov.replace(/\s+/g, ' ').trim();
        }
        out.genre = field(/<span>Жанр:<\/span>\s*([\s\S]*?)<\/li>/i);
        out.country = field(/<span>\s*Страна:\s*<\/span>\s*([^<]+)/i);
        out.year = field(/<span>Год:<\/span>\s*([^<]+)/i);
        out.runtime = field(/<span>Время:<\/span>\s*([^<]+)/i);
        out.translation = field(/<span>Перевод:<\/span>\s*([\s\S]*?)<\/li>/i);
        out.quality = field(/<span>Качество:<\/span>\s*([^<]+)/i);
        out.director = field(/<span>\s*Режиссерский состав:\s*<\/span>\s*([\s\S]*?)<\/li>/i);
        out.cast = field(/<span>\s*В Ролях:\s*<\/span>\s*([\s\S]*?)<\/li>/i);

        var pic = html.match(/imdb\/pic\/(\d+)\.gif/);
        var leech = html.match(/do=go&url=([A-Za-z0-9+/=]+)%3D%3D/);
        if (pic) out.imdb = 'tt' + pic[1];
        else if (leech) {
            try {
                var u = atob(leech[1].replace(/%3D/g, '='));
                var t = u.match(/tt\d+/);
                if (t) out.imdb = t[0];
            } catch (e) {}
        }

        var og = html.match(/og:image" content="([^"]+)"/);
        if (og && validBackdrop(og[1])) out.backdrop = og[1];

        // The site's own online route: the "Смотреть онлайн" embed inside
        // #iframe_block-player (the trailer tab loads via ajax and has no
        // iframe src, so the player block is matched explicitly).
        var pl = html.match(/id="iframe_block-player"[\s\S]{0,600}?<iframe[^>]+src="([^"]+)"/);
        if (pl) out.online = decode(pl[1]);

        out.releases = parseReleases(html);
        return out;
    }

    // The og:image of a release page is usually the wide fanart, but for some
    // titles it is a rating badge (Kinopoisk/IMDB gif). Only accept a real photo.
    // This source's og:image uploads sit on the pixhost.cc CDN and resolve to
    // its "Picture removed" placeholder (302 -> pixhost.cc/image/removed.png),
    // so that host family is rejected for the full-screen backdrop; posters are
    // unaffected (they stay pinned to POSTER_ORIGIN).
    function validBackdrop(url) {
        if (!url || !/^https?:/i.test(url)) return '';
        if (/\/rating\/|imdb\/pic|kinopoisk\.ru/i.test(url)) return '';
        if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return '';
        var host = url.match(/^https?:\/\/([^\/?#]+)/i);
        if (host && /(^|\.)pixhost\.cc$/i.test(host[1])) return '';
        return url;
    }

    // Compact release label from a torrent file name: season/episode (series),
    // quality token and resolution. "1O8Op" (letter O) is normalised to 1080p.
    function releaseLabel(name) {
        var s = String(name || '').replace(/\.torrent$/i, '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
        var norm = s.replace(/1O8Op/gi, '1080p');
        var parts = [];
        var season = norm.match(/\bS(\d{1,2})\b/i);
        var ep = norm.match(/\bE(\d{1,3})\b/i);
        if (season) parts.push('С' + season[1] + (ep ? '.' + ep[1] : ''));
        var qual = norm.match(/\b(WEB-DLRip|WEB-DL|BDRip|HDRip|HDTVRip|DVRip|CamRip)\b/i);
        if (qual) parts.push(qual[1].toUpperCase());
        var res = norm.match(/\b(2160p|1080p|720p|576p|540p|480p|400p|360p|4k)\b/i);
        if (res) parts.push(res[1].toUpperCase() === '4K' ? '2160p' : res[1].toUpperCase());
        if (!parts.length) parts.push(s.split(' ').slice(0, 3).join(' '));
        return parts.join(' ');
    }

    // Compact quality for the detail action strip, derived only from an
    // existing release label ("С01.01 WEB-DLRIP 1080P" -> "WEB-DL 1080p"):
    // quality token + resolution, no magnet/hash/size or other details.
    function releaseQuality(label) {
        var s = String(label || '');
        var parts = [];
        var qual = s.match(/\b(WEB-DLRip|WEB-DL|BDRip|HDRip|HDTVRip|DVRip|CamRip)\b/i);
        if (qual) {
            var t = qual[1].toUpperCase();
            if (t === 'WEB-DLRIP') t = 'WEB-DL';
            parts.push(t);
        }
        var res = s.match(/\b(2160p|1080p|720p|576p|540p|480p|400p|360p|4k)\b/i);
        if (res) {
            var r = res[1].toUpperCase();
            if (r === '4K') r = '2160P';
            parts.push(r.replace(/P$/, 'p'));
        }
        return parts.join(' ');
    }

    // The releases of a detail payload as list-page rows: "quality • size" on
    // the main line, the upload date (when the page carries it) on the second
    // line, the raw release carried as the selection payload. Memory only -
    // no request is issued here.
    function releaseRows(detail) {
        var rel = (detail && detail.releases) || [];
        var out = [];
        for (var i = 0; i < rel.length; i++) {
            var r = rel[i];
            var q = releaseQuality(r.label);
            var t = q || r.label || '';
            if (t && r.size) t += ' • ' + r.size;
            else if (!t) t = r.size || '';
            if (!t) continue;
            out.push({ main: t, sub: r.date || '', release: r });
        }
        return out;
    }

    function filterRussianProductions(items, done) {
        if (!HIDE_RUSSIAN_PRODUCTIONS || !items.length) { done(items); return; }
        var remaining = items.length;
        var kept = new Array(items.length);
        var next = 0;
        var inFlight = 0;
        var MAX_COUNTRY_REQUESTS = 4;
        function complete(index, russian) {
            if (!russian) kept[index] = items[index];
            remaining--;
            inFlight--;
            if (!remaining) { done(kept.filter(function (item) { return !!item; })); return; }
            launch();
        }
        function check(item, index) {
            if (!item.itemUrl) { complete(index, false); return; }
            if (Object.prototype.hasOwnProperty.call(countryCache, item.itemUrl)) {
                complete(index, countryCache[item.itemUrl]);
                return;
            }
            fetchText(item.itemUrl, function (html) {
                var russian = /(?:россия|russia)/i.test(countryFromDetail(html));
                countryCache[item.itemUrl] = russian;
                complete(index, russian);
            }, function () {
                // A failed country lookup must not silently hide a release.
                complete(index, false);
            });
        }
        function launch() {
            while (inFlight < MAX_COUNTRY_REQUESTS && next < items.length) {
                var index = next++;
                inFlight++;
                check(items[index], index);
            }
        }
        launch();
    }

    function loadList(path, pageNo, ok, err) {
        var order = MIRRORS.slice();
        if (goodBase && order.indexOf(goodBase) !== -1) {
            order.splice(order.indexOf(goodBase), 1);
            order.unshift(goodBase);
        }
        var rel = pageNo > 1 ? path + 'page/' + pageNo + '/' : path;
        var i = 0;
        (function next() {
            if (i >= order.length) { if (err) err(); return; }
            var base = order[i++];
            fetchText(base + rel, function (html) {
                var items = parse(html, base);
                if (items.length) {
                    goodBase = base;
                    var posters = parsePosters(html, base);
                    for (var j = 0; j < items.length; j++) items[j].poster = posters[items[j].itemUrl] || '';
                    ok(items);
                }
                else next();
            }, function () { next(); });
        })();
    }

    function strip(s) {
        return (s || '')
            .replace(/<br\s*\/?>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&#0?39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function decode(s) {
        return (s || '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
    }

    // The site puts the year in parentheses at the end of the title; it is
    // dropped for display (card titles and the full page title).
    function stripYear(title) {
        return String(title || '').replace(/\s*\((19|20)\d{2}\)\s*$/, '');
    }

    // One compact quality token from the raw site value (e.g.
    // "WEB-DL/WEB-DLRip" -> "WEB-DL"): a single real token, no slash, no repeats.
    function qualityToken(type) {
        var s = String(type || '');
        var tokens = ['WEB-DLRip', 'WEB-DL', 'BDRip', 'HDRip', 'HDTVRip', 'DVRip', 'CamRip', '2160p', '4K', '1080p', '720p', '576p'];
        var i;
        for (i = 0; i < tokens.length; i++) {
            if (new RegExp('\\b' + tokens[i].replace(/-/g, '\\-') + '\\b', 'i').test(s)) {
                if (tokens[i] === 'WEB-DLRip') return 'WEB-DL';
                if (tokens[i] === '4K') return '2160p';
                return tokens[i].toUpperCase();
            }
        }
        return '';
    }

    // Type label strictly from real data: serial section (incl. /serial-hd/),
    // film sections, or an explicit type word. '' when undetermined (no chip).
    // Live film sections (/hd/, /webrips/) point their cards at /nerufilm/
    // detail pages, so that segment is a film-section marker too.
    function kindLabel(item) {
        if (item.serial) return 'Серіал';
        var url = String(item.itemUrl || '');
        if (/\/(hd|webrips|nerufilm|film)\//i.test(url)) return 'Фільм';
        if (/фильм|фільм|film/i.test(String(item.type || ''))) return 'Фільм';
        return '';
    }

    function parse(html, base) {
        var out = [];
        if (!html) return out;

        // Category pages are a paginated card grid ("top__slider_div__item"). Cards are
        // the browsable catalog and carry posters, so they are the primary source.
        // The legacy "<tr> + magnet" table on these pages is a separate "latest
        // releases" widget, so it is used only as a fallback for sources without cards.
        var cards = /<div\s+class="top__slider_div__item"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>\s*<img\s+src="([^"]+)"[^>]*>\s*<\/a>\s*<span>([\s\S]*?)<\/span>[\s\S]*?<span\s+class="short-quality">([\s\S]*?)<\/span>[\s\S]*?<\/div>\s*<\/div>/g;
        var cm;
        while ((cm = cards.exec(html))) {
            var cardTitle = strip(cm[3]);
            if (!cardTitle) continue;
            var cardType = strip(cm[4]);
            var cardHref = decode(cm[1]);
            out.push({
                title: cardTitle,
                year: (cardTitle.match(/\b(19|20)\d{2}\b/) || [])[0] || '',
                type: cardType,
                serial: /\/serial(?:-[\w]+)?\//i.test(cardHref) || /сериал/i.test(cardTitle + ' ' + cardType),
                size: '',
                magnet: '',
                fileUrl: '',
                itemUrl: base + cardHref,
                playUrl: '',
                imdb: '',
                kp: ''
            });
        }
        if (out.length) return out;

        // Fallback: legacy table rows with embedded magnets (no detail fetch needed).
        var rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var tm = r.match(/href="(magnet:[^"]+)"/);
            if (!tm) continue;

            var cells = [];
            var cre = /<td[^>]*>([\s\S]*?)<\/td>/g, m;
            while ((m = cre.exec(r))) cells.push(m[1]);

            var titleCell = cells[2] || '';
            var thref = titleCell.match(/href="([^"]+)"/);
            var title = strip(titleCell);
            if (!title) continue;

            var size = '';
            for (var c = 0; c < cells.length; c++) {
                var sm = (cells[c] || '').match(/(\d+(?:\.\d+)?\s*(?:GB|Gb|MB|KB|TB))/i);
                if (sm) { size = sm[1]; break; }
            }

            var tdl = r.match(/href="(\/index\.php\?do=download(?:&amp;|&)id=\d+)"/);
            var tplay = r.match(/data-clipboard-text="(https:[^"]*\/iframe)"/);
            var timdb = r.match(/imdb\.com\/title\/(tt\d+)/);
            var tkp = r.match(/kinopoisk\.ru\/(?:film|series)\/(\d+)/);
            var type = cells[1] ? strip(cells[1]) : '';

            out.push({
                title: title,
                date: cells[0] ? strip(cells[0]) : '',
                type: type,
                serial: /сериал/i.test(type),
                size: size,
                magnet: decode(tm[1]),
                fileUrl: tdl ? base + decode(tdl[1]) : '',
                itemUrl: thref ? base + decode(thref[1]) : '',
                playUrl: tplay ? tplay[1] : '',
                imdb: timdb ? timdb[1] : '',
                kp: tkp ? tkp[1] : ''
            });
        }
        return out;
    }

    /* cover images from the top slider block of the page: <a href="..."><img src="..."> */
    function parsePosters(html, base) {
        var map = {};
        var re = /<a href="([^"]+)"[^>]*>\s*<img src="([^"]+)"/g, m;
        while ((m = re.exec(html || ''))) map[base + decode(m[1])] = POSTER_ORIGIN + decode(m[2]);
        return map;
    }

    function magnetInfo(m) {
        var h = (m || '').match(/urn:btih:([0-9a-fA-F]{40})/);
        var x = (m || '').match(/xl=(\d+)/);
        return { hash: h ? h[1] : '', xl: x ? parseInt(x[1], 10) : 0 };
    }

    // Unique releases of a detail page as [{magnet, xl, dn}], deduped by hash.
    // A release may appear both as a download block and a magnet icon link.
    function parseMagnets(html) {
        var out = [], seen = {};
        var ms = (html || '').match(/magnet:[^\s"<>]+/g) || [];
        for (var i = 0; i < ms.length; i++) {
            var m = decode(ms[i]);
            var info = magnetInfo(m);
            if (!info.hash || seen[info.hash]) continue;
            seen[info.hash] = true;
            out.push({ magnet: m, xl: info.xl, dn: (m.match(/dn=([^&]+)/) || [])[1] || '' });
        }
        return out;
    }

    // The unique releases of a detail page. Primary source: the "torrent_N_info"
    // blocks, which carry the magnet plus the human size and the upload date
    // ("Загрузил: USER (DATE)"). A magnet-only page (no blocks) still yields the
    // magnet list (no date). Deduped by hash.
    function parseReleases(html) {
        var out = [], seen = {};
        var h = String(html || '');
        var parts = h.split(/<div id="torrent_\d+_info"/);
        if (parts.length > 1) {
            for (var i = 1; i < parts.length; i++) {
                var part = parts[i];
                var m = part.match(/magnet:[^\s"<>]+/);
                if (!m) continue;
                var mag = decode(m[0]);
                var info = magnetInfo(mag);
                if (!info.hash || seen[info.hash]) continue;
                seen[info.hash] = true;
                var dn = (mag.match(/dn=([^&]+)/) || [])[1] || '';
                var name = dn ? decodeURIComponent(dn).replace(/\.torrent$/i, '') : '';
                var size = (part.match(/class="info_d-size"[^>]*>\s*([^<]+?)\s*</) || [])[1] || '';
                var bord = part.match(/<div class="bord_a1">([\s\S]*?)<\/div>/);
                var date = bord ? ((bord[1].match(/\((\d{1,2}\s+\S+\s+\d{4}(?:\s+\d{1,2}:\d{2})?)\)/) || [])[1] || '') : '';
                out.push({
                    name: name,
                    label: releaseLabel(name),
                    size: size || bytesToHuman(info.xl),
                    sizeBytes: info.xl,
                    date: date,
                    magnet: mag
                });
            }
            return out;
        }
        var mags = parseMagnets(h);
        for (var j = 0; j < mags.length; j++) {
            var nm = mags[j].dn ? decodeURIComponent(mags[j].dn).replace(/\.torrent$/i, '') : '';
            out.push({
                name: nm,
                label: releaseLabel(nm),
                size: bytesToHuman(mags[j].xl),
                sizeBytes: mags[j].xl,
                date: '',
                magnet: mags[j].magnet
            });
        }
        return out;
    }

    // The real player embeds of a detail page: every <iframe src>, deduped,
    // in page order (the site puts the #iframe_block-player embed first).
    // Read-only: this only lists what the page really carries.
    function parseEmbeds(html) {
        var out = [], seen = {};
        var re = /<iframe[^>]+src="([^"]+)"/g, m;
        while ((m = re.exec(String(html || '')))) {
            var u = decode(m[1]);
            if (!u || !/^https?:\/\//i.test(u) || seen[u]) continue;
            seen[u] = true;
            out.push(u);
        }
        return out;
    }

    function bytesToHuman(b) {
        if (!b) return '';
        var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, n = b;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
    }

    function Component(object) {
        var L = window.Lampa;
        var items = [], rendered = 0, catId = null, catPath = null;
        var seen = {}, serverPage = 1, fetching = false, consecutiveEmpty = 0;
        var last = null, scroll = null, grid = null, built = false, catBtns = [], loadToken = 0;
        var bgLayers = [null, null], bgFront = 0, bgShown = '', bgPending = '', bgToken = 0;
        var html = document.createElement('div');

        this.create = function () {
            if (this.activity) this.activity.loader(true);
            this.load(object.category);
            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.load = function (categoryId) {
            var c = catBy(categoryId);
            catId = c.id;
            catPath = c.path;
            ++loadToken;
            items = [];
            rendered = 0;
            seen = {};
            serverPage = 1;
            fetching = false;
            consecutiveEmpty = 0;
            this.build();
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(CONTENT_HTML));
                bgLayers[0] = html.find('.udx-bg--first');
                bgLayers[1] = html.find('.udx-bg--second');

                scroll = new Lampa.Scroll({ mask: true, over: true });
                scroll.onEnd = (function () { this.loadMore(); }).bind(this);

                grid = document.createElement('div');
                grid.addClass('category-full');
                scroll.append(grid);
                html.find('.udx-content__list').append(scroll.render(true));

                // Bound the scroll viewport so focus can scroll the grid (record pattern).
                scroll.minus(html.find('.udx-content__head'));

                this.buildCats();
                L.Layer.update(html);
            }
            this.setActive();
            this.display();
        };

        this.buildCats = function () {
            var self = this;
            var catsEl = html.find('.udx-content__cats');
            CATS.forEach(function (c) {
                var b = document.createElement('div');
                b.addClass('simple-button simple-button--invisible selector udx-cat');
                var lb = document.createElement('span');
                lb.addClass('udx-cat__label');
                lb.text(c.title);
                b.append(lb);
                b.on('hover:enter', (function (c2) {
                    return function () { self.selectCat(c2); };
                })(c));
                catsEl.append(b);
                catBtns.push({ c: c, el: b });
            });
        };

        this.setActive = function () {
            catBtns.forEach(function (b) {
                if (b.c.id == catId) b.el.addClass('udx-active');
                else b.el.removeClass('udx-active');
            });
        };

        this.selectCat = function (c) {
            if (c.id == catId) return;
            if (this.activity) this.activity.loader(true);
            this.load(c.id);
        };

        this.display = function () {
            last = null;
            rendered = 0;
            if (grid) grid.empty();
            if (scroll) scroll.reset();
            if (bgLayers[0]) bgLayers[0].removeClass('udx-bg--on');
            if (bgLayers[1]) bgLayers[1].removeClass('udx-bg--on');
            bgFront = 0;
            bgShown = '';
            bgPending = '';
            bgToken++;

            if (this.activity) this.activity.toggle();
            this.fill();
        };

        // Append every loaded-but-not-yet-shown item, then top up with more server
        // pages until the first screen is filled. Scrolling further (scroll.onEnd)
        // keeps loading page by page.
        this.fill = function () {
            var self = this;
            while (rendered < items.length) self.appendCard(items[rendered++]);
            if (scroll) L.Layer.visible(scroll.render(true));
            if (items.length < PAGE) self.loadMore();
        };

        // Fetch one more server page, dedup by itemUrl, apply the country filter and
        // append the new items. Guards: single in-flight fetch, hard page cap, and a
        // stop after two consecutive pages that add nothing new.
        this.loadMore = function () {
            if (fetching) return;
            if (serverPage > MAX_PAGE || consecutiveEmpty >= 2) {
                if (!items.length) this.showEmpty();
                return;
            }
            var self = this, token = loadToken, pg = serverPage;
            fetching = true;
            if (this.activity) this.activity.loader(true);
            loadList(catPath, pg, function (raw) {
                if (token !== loadToken) { fetching = false; return; }
                serverPage = pg + 1;
                var fresh = [];
                for (var i = 0; i < raw.length; i++) {
                    var it = raw[i];
                    if (it.itemUrl && seen[it.itemUrl]) continue;
                    if (it.itemUrl) seen[it.itemUrl] = true;
                    fresh.push(it);
                }
                if (!fresh.length) {
                    fetching = false;
                    if (self.activity) self.activity.loader(false);
                    consecutiveEmpty++;
                    if (!items.length && (serverPage > MAX_PAGE || consecutiveEmpty >= 2)) self.showEmpty();
                    else self.fill();
                    return;
                }
                filterRussianProductions(fresh, function (kept) {
                    if (token !== loadToken) { fetching = false; return; }
                    fetching = false;
                    if (self.activity) self.activity.loader(false);
                    if (kept.length) { consecutiveEmpty = 0; for (var k = 0; k < kept.length; k++) items.push(kept[k]); }
                    else consecutiveEmpty++;
                    if (!items.length && (serverPage > MAX_PAGE || consecutiveEmpty >= 2)) self.showEmpty();
                    else self.fill();
                });
            }, function () {
                if (token !== loadToken) { fetching = false; return; }
                serverPage = pg + 1;
                fetching = false;
                if (self.activity) self.activity.loader(false);
                consecutiveEmpty++;
                if (!items.length && (serverPage > MAX_PAGE || consecutiveEmpty >= 2)) self.showEmpty();
                else self.fill();
            });
        };

        this.showEmpty = function () {
            if (!grid) return;
            var em = document.createElement('div');
            em.addClass('udx-empty');
            em.text(L.Lang.translate('ultradox_empty'));
            grid.append(em);
        };

        function focusBackdrop(url) {
            if (!url || !bgLayers[0] || !bgLayers[1]) return;
            if (url === bgShown || url === bgPending) return;
            var token = ++bgToken;
            var target = bgLayers[1 - bgFront];
            var other = bgLayers[bgFront];
            bgPending = url;
            var img = new Image();
            img.onload = function () {
                if (token !== bgToken) return;
                target.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
                target.addClass('udx-bg--on');
                other.removeClass('udx-bg--on');
                bgFront = 1 - bgFront;
                bgShown = url;
                bgPending = '';
            };
            img.onerror = function () {
                if (token !== bgToken) return;
                bgPending = '';
            };
            img.src = url;
        }

        this.appendCard = function (item) {
            var title = stripYear(item.title);
            var year = item.year || '';
            // The year line must never repeat a year the title already shows.
            if (year && new RegExp('\\b' + year + '\\b').test(title)) year = '';
            var card = L.Template.js('card', { title: title, release_year: year });
            card.find('.card__title').text(title);

            // The line under the title carries the year, or the quality/size
            // of a fallback row (no poster). With nothing to show it is
            // removed entirely (same as the core Release/FullEpisode cards):
            // no empty row, no placeholder; the title's reserved area keeps
            // the card geometry stable.
            var meta = [];
            if (item.type && !item.poster) meta.push(item.type);
            if (item.size) meta.push(item.size);
            var ageLine = card.find('.card__age');
            if (ageLine) {
                if (meta.length) ageLine.text(meta.join(' • '));
                else if (!year) ageLine.remove();
            }

            if (item.poster) {
                var img = card.find('.card__img');
                img.src = item.poster;
                img.onerror = function () { this.src = './img/img_broken.svg'; };
            }

            // One type chip per card, strictly inside the poster (top-left);
            // only rendered when the type is determined from real data.
            var kindText = kindLabel(item);
            if (kindText) {
                var kind = document.createElement('div');
                kind.addClass('udx-kind');
                kind.text(kindText);
                card.find('.card__view').append(kind);
            }

            // One quality chip per card (bottom-left), a single real token.
            var q = qualityToken(item.type);
            if (q) {
                var chip = document.createElement('div');
                chip.addClass('udx-chip');
                var qs = document.createElement('span');
                qs.addClass('udx-chip__quality');
                qs.text(q);
                chip.append(qs);
                card.find('.card__view').append(chip);
            }

            var self = this;

            card.on('hover:focus', function () {
                last = card;
                if (scroll) scroll.update(card);
                focusBackdrop(item.poster);
            });

            card.on('hover:enter', function () {
                L.Activity.push({
                    url: '',
                    title: item.title,
                    component: 'ultradox_full',
                    item: item
                });
            });

            card.on('visible', function () {
                if (L.Controller.own && L.Controller.own(self)) L.Controller.collectionAppend(card);
            });

            if (!last) last = card;
            if (L.Controller.own && L.Controller.own(this)) L.Controller.collectionAppend(card);
            grid.append(card);
        };

        this.start = function () {
            if (L.Activity.active() && L.Activity.active().activity !== this.activity) return;

            L.Controller.add('content', {
                link: this,
                invisible: true,
                toggle: function () {
                    L.Controller.collectionSet(html);
                    L.Controller.collectionFocus(last, html);
                },
                left: function () {
                    if (NavCanMove('left')) NavMove('left');
                    else L.Controller.toggle('menu');
                },
                right: function () { NavMove('right'); },
                up: function () {
                    if (NavCanMove('up')) NavMove('up');
                    else L.Controller.toggle('head');
                },
                down: function () { NavMove('down'); },
                back: function () { L.Activity.backward(); }
            });

            L.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            if (scroll) scroll.destroy();
            html.remove();
            built = false;
            catBtns = [];
        };
    }

    // Full release page (catalog -> OK): backdrop only from the film's own
    // fanart (without one, the poster doubles as a zone-veiled backdrop),
    // poster on the left, metadata + overview on the right, and a compact
    // action strip with exactly two actions:
    //   left  "Онлайн"    -> opens the ultradox_torrents page: the item's real
    //                        releases (NUM-style: info card left, quality •
    //                        size rows with the upload date right); the
    //                        standard Lampa torrent flow runs only after an
    //                        explicit row pick there;
    //   right "TorrServer"-> pushes the core Lampa torrents search page
    //                        (component 'torrents', the title+year search and
    //                        the item's movie metadata); the result list is
    //                        rendered by the core from the parser response.
    // TMDB enrichment (rating / original title / seasons) is best-effort via
    // the core Lampa.TMDB integration; without it the page shows the
    // Ultradox data alone. Back returns to the catalog on the same card.
    function FullPage(object) {
        var L = window.Lampa;
        var item = object.item || {};
        var detail = null;
        var built = false;
        var onlineBtn = null, torrentsBtn = null;
        var lastAct = null;
        var tmdbSeasons = 0;
        var enrichToken = 0;
        var udxRoot = null;
        var html = document.createElement('div');

        this.create = function () {
            if (this.activity) this.activity.loader(true);
            this.loadDetail();
            return this.render();
        };

        this.render = function () {
            return html;
        };

        this.loadDetail = function () {
            var self = this;
            fetchText(item.itemUrl || '', function (raw) {
                detail = parseDetail(raw);
                self.detail = detail;
                self.build();
            }, function () {
                detail = { overview: '', genre: '', country: '', year: '', runtime: '', translation: '', quality: '', director: '', cast: '', imdb: '', backdrop: '', online: '', releases: [] };
                self.detail = detail;
                self.build();
            });
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(DETAIL_HTML));
                udxRoot = html.find('.udxf');
                onlineBtn = html.find('.udxf__act--online');
                torrentsBtn = html.find('.udxf__act--torrents');
                // Left action: opens the dedicated release-list page.
                // Right action: opens the core torrents search page.
                // hover:focus remembers the last touched action so the page
                // refocuses exactly there (start() falls back to the online
                // button while nothing has been focused yet).
                var self = this;
                if (onlineBtn) {
                    onlineBtn.find('.udxf__olab').text(L.Lang.translate('ultradox_online'));
                    onlineBtn.on('hover:focus', function () { lastAct = onlineBtn; });
                    onlineBtn.on('hover:enter', function () { self.openReleaseList(); });
                }
                if (torrentsBtn) {
                    torrentsBtn.find('.udxf__tlab').text(L.Lang.translate('ultradox_torrserver'));
                    torrentsBtn.on('hover:focus', function () { lastAct = torrentsBtn; });
                    torrentsBtn.on('hover:enter', function () { self.openTorrents(); });
                }
                // Lampa's Element.prototype.find returns a single node
                // (querySelector), not a collection: use it directly, guard null.
                var poster = html.find('.udxf__poster');
                if (item.poster && poster) {
                    poster.src = item.poster;
                    poster.onerror = function () { this.src = './img/img_broken.svg'; };
                } else if (poster) {
                    poster.remove();
                }
                L.Layer.update(html);
            }

            this.fill();
            // Best-effort TMDB enrichment (never blocks or breaks the page):
            // the slot elements are already present; a missing/failed
            // integration simply leaves them hidden.
            this.enrich();
            if (this.activity) this.activity.toggle();
        };

        this.fill = function () {
            var d = detail || {};

            // The card poster may double as the backdrop, but only a real
            // absolute URL from a non-pixhost host: the pixhost family answers
            // its "Picture removed" placeholder, which must never reach the
            // full-screen background (the left <img> keeps the raw URL).
            var posterBackdrop = '';
            var pstr = item.poster ? String(item.poster) : '';
            if (/^https?:\/\//i.test(pstr)) {
                var phost = pstr.match(/^https?:\/\/([^\/?#]+)/i);
                if (!(phost && /(^|\.)pixhost\.cc$/i.test(phost[1]))) posterBackdrop = pstr;
            }

            var bg = html.find('.udxf__backdrop');
            // Reset first: the previous page's image and states never survive
            // a fill(); the branch below applies exactly one state.
            if (bg) {
                bg.style.backgroundImage = '';
                bg.removeClass('udxf__backdrop--on');
                bg.removeClass('udxf__backdrop--poster');
            }
            if (udxRoot) udxRoot.removeClass('udxf--poster');
            if (d.backdrop && bg) {
                bg.style.backgroundImage = 'url("' + d.backdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxf__backdrop--on');
            } else if (posterBackdrop && bg) {
                // Poster as backdrop: the plain image only - all darkening
                // lives in the zone veil (.udxf--poster state), not embedded
                // into the background-image here.
                bg.style.backgroundImage = 'url("' + posterBackdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxf__backdrop--poster');
                if (udxRoot) udxRoot.addClass('udxf--poster');
            }

            html.find('.udxf__title').text(stripYear(item.title));

            var top = [];
            if (d.country) top.push(d.country);
            if (d.year) top.push(d.year);
            slotShow('.udxf__top', top.length ? top.join(' • ') : '');

            var line = [];
            if (d.genre) line.push(d.genre);
            if (d.runtime) line.push(d.runtime);
            if (d.translation) line.push(d.translation);
            slotShow('.udxf__line', line.length ? line.join(' • ') : '');

            slotShow('.udxf__overview', d.overview || '');
            slotShow('.udxf__fact--director', d.director ? L.Lang.translate('ultradox_director') + ': ' + d.director : '');

            var castNames = d.cast ? String(d.cast).split(',').map(function (n) { return n.replace(/\s+/g, ' ').trim(); }).filter(function (n) { return n; }) : [];
            var castShown = '';
            if (castNames.length) {
                castShown = castNames.slice(0, 5).join(', ');
                if (castNames.length > 5) castShown += ' …';
            }
            slotShow('.udxf__fact--cast', castShown ? L.Lang.translate('ultradox_cast') + ': ' + castShown : '');

            // TMDB enrichment slots: hidden here; the enrichment (if it runs)
            // reveals them later. The page never waits for any of them.
            slotShow('.udxf__rate', '');
            slotShow('.udxf__orig', '');
            slotShow('.udxf__seasons', '');
        };

        // One show/hide primitive for all optional meta rows: text + visible,
        // or empty + hidden (the .hide class is the core display:none marker).
        function slotShow(sel, text) {
            var e = html.find(sel);
            if (!e) return;
            if (text) { e.text(text); e.removeClass('hide'); }
            else { e.text(''); e.addClass('hide'); }
        }

        // Movie metadata for the core torrent screens. The Ultradox card has
        // no TMDB id: the core derives a storage key from it, which is
        // harmless. genres stays an empty list so the core's genre branch
        // remains inert; number_of_seasons=1 marks a serial, which the core
        // uses to sort results by season/episode.
        function moviePayload() {
            var title = stripYear(item.title);
            var year = item.year || (detail && detail.year) || '';
            var p = {
                title: title,
                original_title: title,
                img: item.poster || '',
                release_date: year,
                genres: [],
                number_of_seasons: item.serial ? 1 : 0,
                source: 'ultradox'
            };
            if (item.serial) {
                p.original_name = title;
                p.first_air_date = year;
            }
            return p;
        }

        // Left action "Онлайн": opens the dedicated full-page release list
        // (NUM-style: info card left, the item's real releases right). The
        // standard Lampa torrent flow runs only after an explicit user pick
        // inside that page.
        this.openReleaseList = function () {
            L.Activity.push({ title: item.title, component: 'ultradox_torrents', item: item, detail: detail, seasons: tmdbSeasons });
        };

        // Right action "TorrServer": the core torrent search screen for this
        // title. The search string is the simple title+year combination (the
        // core Torrents callback builds language-ordered combinations of the
        // same parts); the result list (title/size/seeders) is rendered by
        // the core from the parser response.
        this.openTorrents = function () {
            var title = stripYear(item.title);
            var year = item.year || (detail && detail.year) || '';
            L.Activity.push({
                url: '',
                title: L.Lang.translate('title_torrents'),
                component: 'torrents',
                search: year ? (title + ' ' + year) : title,
                search_one: title,
                search_two: title,
                movie: moviePayload(),
                page: 1
            });
        };

        // Best-effort TMDB enrichment through the core Lampa integration only
        // (Lampa.TMDB.api builds the authed URL; nothing is hardcoded here).
        // Every failure is a silent no-op: the detail page keeps the
        // Ultradox-sourced data and stays fully usable.
        this.enrich = function () {
            var imdb = detail && detail.imdb;
            if (!imdb || !tmdbAvailable()) return;
            var self = this;
            var token = ++enrichToken;
            var lang = tmdbLang();
            tmdbJson('find/' + imdb + '?external_sources=imdb_id&language=' + lang, function (found) {
                if (token !== enrichToken || !udxRoot) return;
                var res = found && found.results;
                if (!res || !res.length) return;
                var pick = null;
                for (var i = 0; i < res.length; i++) {
                    if (res[i].media_type === 'movie' || res[i].media_type === 'tv') { pick = res[i]; break; }
                }
                if (!pick) return;
                var type = pick.media_type;
                tmdbJson(type + '/' + pick.id + '?language=' + lang, function (data) {
                    if (token !== enrichToken || !udxRoot) return;
                    if (data) self.applyTmdb({ type: type, data: data });
                });
                tmdbJson(type + '/' + pick.id + '/credits?language=' + lang, function (cr) {
                    if (token !== enrichToken || !udxRoot) return;
                    // Credits arrive too but are not displayed: the site's own
                    // cast row is the confirmed source and already shown.
                });
            }, function () { /* integration missing or request failed: keep Ultradox data */ });
        };

        // Apply the parts of the TMDB payload that add confirmed data the
        // site does not carry: rating, original title, season count (series).
        this.applyTmdb = function (meta) {
            if (!udxRoot) return;
            var d = meta.data || {};
            if (typeof d.vote_average === 'number' && d.vote_average > 0) {
                slotShow('.udxf__rate', L.Lang.translate('ultradox_rating') + ': ' + (Math.round(d.vote_average * 10) / 10).toFixed(1));
            }
            var ot = String(d.original_title || '');
            var shown = stripYear(String(item.title || ''));
            if (ot && ot.toLowerCase() !== shown.toLowerCase()) slotShow('.udxf__orig', ot);
            if (meta.type === 'tv' && typeof d.number_of_seasons === 'number' && d.number_of_seasons > 0) {
                tmdbSeasons = d.number_of_seasons;
                slotShow('.udxf__seasons', L.Lang.translate('ultradox_seasons') + ': ' + d.number_of_seasons);
            }
        };

        this.start = function () {
            if (L.Activity.active() && L.Activity.active().activity !== this.activity) return;

            L.Controller.add('content', {
                link: this,
                invisible: true,
                toggle: function () {
                    L.Controller.collectionSet(html);
                    L.Controller.collectionFocus(lastAct || onlineBtn, html);
                },
                left: function () {
                    if (NavCanMove('left')) NavMove('left');
                    else L.Controller.toggle('menu');
                },
                right: function () { NavMove('right'); },
                up: function () {
                    if (NavCanMove('up')) NavMove('up');
                    else L.Controller.toggle('head');
                },
                down: function () { NavMove('down'); },
                back: function () { L.Activity.backward(); }
            });

            L.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            html.remove();
            built = false;
            onlineBtn = null; torrentsBtn = null; udxRoot = null;
            lastAct = null;
            tmdbSeasons = 0;
            enrichToken++;
        };
    }

    // Dedicated full-page list screens (NUM-style: the item's info card on
    // the left, the item's real rows on the right). The release-list page is
    // opened by the detail strip; the online page stays available from its
    // own payload (no longer a strip route). Neither variant starts anything
    // by itself:
    //   ultradox_online  -> the item's real online embeds, probed read-only
    //                       from its detail page (or a clear empty state when
    //                       the page has none); the standard Lampa player call
    //                       (Lampa.Player.play) runs only from an explicit row
    //                       pick, which is probed read-only first so a dead
    //                       embed shows a message instead of a black screen;
    //   ultradox_torrents-> the item's real releases (quality • size rows with
    //                       the upload date); the standard Lampa torrent flow
    //                       (L.Torrent.start with MagnetUri/Size) runs only
    //                       from an explicit row pick.
    // Back returns to the detail page on the same item.
    function ListPage(object) {
        var L = window.Lampa;
        var mode = object.component === 'ultradox_torrents' ? 'torrents' : 'online';
        var item = object.item || {};
        var detail = object.detail || {};
        var built = false;
        var rows = [];
        var firstRow = null, lastRow = null, scroll = null, listBox = null;
        var html = document.createElement('div');

        this.create = function () {
            if (this.activity) this.activity.loader(true);
            if (mode === 'online') this.loadEmbeds();
            else this.build();
            return this.render();
        };

        this.render = function () {
            return html;
        };

        // Online mode is the only variant that fetches: a read-only probe of
        // the item page for its real embeds. The torrents variant works fully
        // from the detail payload the detail page already fetched.
        this.loadEmbeds = function () {
            var self = this;
            if (!item.itemUrl) { rows = []; self.build(); return; }
            fetchText(item.itemUrl, function (raw) {
                rows = parseEmbeds(raw);
                self.build();
            }, function () {
                rows = [];
                self.build();
            });
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(LIST_HTML));

                var poster = html.find('.udxl__poster');
                if (item.poster && poster) {
                    poster.src = item.poster;
                    poster.onerror = function () { this.src = './img/img_broken.svg'; };
                } else if (poster) {
                    poster.remove();
                }

                scroll = new Lampa.Scroll({ mask: true, over: true });
                listBox = document.createElement('div');
                listBox.addClass('udxl__rows');
                scroll.append(listBox);
                html.find('.udxl__list').append(scroll.render(true));

                L.Layer.update(html);
            }

            this.fillCard();
            this.fillRows();
            if (this.activity) this.activity.toggle();
        };

        this.fillCard = function () {
            var d = detail || {};

            var bg = html.find('.udxl__backdrop');
            var posterBackdrop = '';
            var pstr = item.poster ? String(item.poster) : '';
            if (/^https?:\/\//i.test(pstr)) {
                var phost = pstr.match(/^https?:\/\/([^\/?#]+)/i);
                if (!(phost && /(^|\.)pixhost\.cc$/i.test(phost[1]))) posterBackdrop = pstr;
            }
            if (bg) {
                bg.style.backgroundImage = '';
                bg.removeClass('udxl__backdrop--on');
                bg.removeClass('udxl__backdrop--poster');
            }
            if (d.backdrop && bg) {
                bg.style.backgroundImage = 'url("' + d.backdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxl__backdrop--on');
            } else if (posterBackdrop && bg) {
                bg.style.backgroundImage = 'url("' + posterBackdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxl__backdrop--poster');
            }

            html.find('.udxl__title').text(stripYear(item.title));
            var meta = [];
            if (d.country) meta.push(d.country);
            if (d.year) meta.push(d.year);
            if (d.genre) meta.push(d.genre);
            html.find('.udxl__meta').text(meta.join(' • '));
        };

        this.fillRows = function () {
            if (!listBox) return;
            listBox.empty();
            firstRow = null;
            lastRow = null;
            var self = this;

            var data = mode === 'online'
                ? rows.map(function (u, i) {
                    var host = (u.match(/^https?:\/\/([^\/?#]+)/i) || [])[1] || '';
                    var t = L.Lang.translate('ultradox_online');
                    if (rows.length > 1) t += ' ' + (i + 1);
                    return { main: t, sub: host, data: u };
                })
                : releaseRows(detail);

            if (!data.length) {
                var em = document.createElement('div');
                em.addClass('udx-empty');
                em.text(mode === 'online' ? L.Lang.translate('ultradox_no_online') : L.Lang.translate('ultradox_no_link'));
                listBox.append(em);
                return;
            }

            for (var i = 0; i < data.length; i++) self.appendRow(data[i]);
            if (scroll) L.Layer.visible(scroll.render(true));
        };

        this.appendRow = function (row) {
            var el = document.createElement('div');
            el.addClass('simple-button selector udxl__row');
            var main = document.createElement('div');
            main.addClass('udxl__row__main');
            main.text(row.main);
            el.append(main);
            if (row.sub) {
                var sub = document.createElement('div');
                sub.addClass('udxl__row__sub');
                sub.text(row.sub);
                el.append(sub);
            }

            var self = this;
            el.on('hover:focus', function () {
                lastRow = el;
                if (scroll) scroll.update(el);
            });
            el.on('hover:enter', function () {
                if (mode === 'online') self.playRow(row.data);
                else self.startTorrServer(row.release);
            });

            if (!firstRow) firstRow = el;
            if (L.Controller.own && L.Controller.own(this)) L.Controller.collectionAppend(el);
            listBox.append(el);
        };

        // Explicit row pick only: the standard Lampa player call, probed
        // read-only first (the embed host rejects origin-less requests, so a
        // dead URL must not reach the player as a black screen).
        this.playRow = function (url) {
            var self = this;
            if (!url || !L.Player || typeof L.Player.play !== 'function') {
                L.Noty.show(L.Lang.translate('ultradox_no_online'));
                return;
            }
            if (this.activity) this.activity.loader(true);
            fetchText(url, function () {
                if (self.activity) self.activity.loader(false);
                L.Player.play({ url: url, title: item.title });
            }, function () {
                if (self.activity) self.activity.loader(false);
                L.Noty.show(L.Lang.translate('ultradox_online_unavailable'));
            });
        };

        // Explicit row pick only: the standard Lampa torrent flow, same
        // payload shape the earlier Ultradox build used for TorrServer
        // playback (MagnetUri/Size).
        this.startTorrServer = function (r) {
            if (!r || !r.magnet) { L.Noty.show(L.Lang.translate('ultradox_no_link')); return; }
            var o = {
                title: item.title,
                Title: item.title,
                Tracker: 'Ultradox',
                size: r.size || '',
                Size: r.sizeBytes || 0,
                Seeders: 0,
                Peers: 0,
                MagnetUri: r.magnet,
                Link: ''
            };
            var movie = {
                title: item.title,
                original_title: item.title,
                img: item.poster || '',
                number_of_seasons: item.serial ? (object.seasons || 1) : undefined
            };
            L.Torrent.start(o, movie);
        };

        this.start = function () {
            if (L.Activity.active() && L.Activity.active().activity !== this.activity) return;

            L.Controller.add('content', {
                link: this,
                invisible: true,
                toggle: function () {
                    L.Controller.collectionSet(html);
                    L.Controller.collectionFocus(lastRow || firstRow || html, html);
                },
                left: function () {
                    if (NavCanMove('left')) NavMove('left');
                    else L.Activity.backward();
                },
                right: function () { NavMove('right'); },
                up: function () { NavMove('up'); },
                down: function () { NavMove('down'); },
                back: function () { L.Activity.backward(); }
            });

            L.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            if (scroll) scroll.destroy();
            html.remove();
            built = false;
            rows = [];
            firstRow = null; lastRow = null; listBox = null; scroll = null;
        };
    }

    if (window.Lampa) boot();
})();
