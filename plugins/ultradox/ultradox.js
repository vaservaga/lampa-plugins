/*
 * Lampa plugin: Ultradox (OCTOPUS) -> TorrServer
 * Install: add the published CDN URL (jsDelivr, pinned by commit SHA) in Lampa:
 *          Settings -> Plugins -> +  (e.g. https://cdn.jsdelivr.net/gh/vaservaga/lampa-plugins@<commit-sha>/plugins/ultradox/ultradox.js)
 * Requires Lampa already configured to use TorrServer (internal torrclient + TorrServer URL).
 *
 * UI (Phase 3, NUM parity): core card grid (.category-full + Template 'card')
 * with the type badge top-left, quality badge bottom-left, TMDB rating badge
 * bottom-right and the year under the title; category buttons in the head
 * (simple-button); full detail page (validated backdrop, poster left, meta,
 * TMDB rating line, overview) with a release selector. Ratings come from TMDB
 * through the Lampa core TMDB integration (Lampa.TMDB.key()/api()); the key
 * lives in Lampa's own TMDB settings, never in this plugin. Torrent/TorrServer
 * playback is a later stage, not wired here.
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

    var CONTENT_HTML =
        '<div class="udx-content">' +
            '<div class="udx-backdrop" aria-hidden="true"></div>' +
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
                    '<div class="udxf__line"></div>' +
                    '<div class="udxf__rating"></div>' +
                    '<div class="udxf__overview"></div>' +
                    '<div class="udxf__actions"><div class="simple-button selector udx-f__play"></div></div>' +
                '</div>' +
            '</div>' +
        '</div>';

    var STYLE_HTML = '<style id="ultradox-style">' +
        '.udx-content{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udx-backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.93),rgba(6,28,41,.60)),#061c29 center/cover no-repeat;opacity:0;transition:opacity .25s ease;}' +
        '.udx-content__head{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;padding:14px 20px;background:linear-gradient(rgba(0,0,0,.55),transparent);}' +
        '.udx-content__cats{display:flex;align-items:center;}' +
        '.udx-cat{flex-shrink:0;}' +
        '.udx-cat__label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udx-cat.udx-active{background-color:#fff;color:#000;}' +
        '.udx-content__list{position:relative;z-index:1;padding-top:80px;}' +
        '.udx-empty{width:100%;text-align:center;padding:5em 0;color:#9aa4b2;font-size:1.5em;}' +
        '.udx-chip{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;align-items:stretch;max-width:calc(100% - 20px);overflow:hidden;border-bottom-left-radius:0.55em;pointer-events:none;}' +
        '.udx-chip span{font-size:0.75em;line-height:1.5;padding:0 0.55em;white-space:nowrap;}' +
        '.udx-chip__kind{flex-shrink:0;background:#57F570;color:#0f3d1a;font-weight:700;}' +
        '.udx-chip__quality{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;background:rgba(255,255,255,0.88);color:#14202a;}' +
        '.udxf{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udxf__backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;background:center/cover no-repeat;opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        '.udxf__backdrop--on{opacity:1;}' +
        '.udxf__gradient{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.55),rgba(6,28,41,.88) 72%);}' +
        '.udxf__body{position:relative;z-index:2;height:100%;display:flex;align-items:center;padding:0 6% 0 5%;box-sizing:border-box;}' +
        '.udxf__poster{flex-shrink:0;width:12em;border-radius:.5em;background:#3E3E3E;box-shadow:0 .8em 2em rgba(0,0,0,.55);}' +
        '.udxf__meta{margin-left:2.2em;min-width:0;max-width:62%;}' +
        '.udxf__top{font-size:1.05em;color:#cdd8e4;letter-spacing:.03em;}' +
        '.udxf__title{font-size:2.1em;font-weight:700;line-height:1.15;color:#fff;margin-top:.35em;}' +
        '.udxf__line{font-size:1.05em;color:#9fb2c4;margin-top:.9em;}' +
        '.udxf__overview{font-size:1.05em;line-height:1.4;color:#e7eef5;margin-top:1em;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;}' +
        '.udxf__actions{margin-top:1.8em;}' +
        '.udx-f__play{display:inline-block;min-width:11em;text-align:center;padding:.55em 1.4em;background:#57F570;color:#0f3d1a;font-weight:700;border-radius:.4em;font-size:1.05em;}' +
        '.udx-f__play.focus{background:#57F570;color:#0f3d1a;box-shadow:0 0 0 .3em #fff;border-radius:.6em;}' +
        '.udx-kind{position:absolute;left:10px;top:10px;z-index:2;background:#57F570;color:#0f3d1a;font-weight:700;padding:0 .55em;border-radius:.45em;font-size:.75em;line-height:1.5;white-space:nowrap;pointer-events:none;}' +
        '.udx-rate{position:absolute;right:10px;bottom:10px;z-index:2;background:rgba(6,20,30,.78);color:#ffd76a;font-weight:700;padding:0 .55em;border-radius:.45em;font-size:.8em;line-height:1.5;white-space:nowrap;pointer-events:none;}' +
        '.udxf__rating{font-size:1.05em;font-weight:700;color:#ffd76a;margin-top:1em;}' +
        '</style>';

    function boot() {
        var L = window.Lampa;
        window.plugin_ultradox_ready = true;

        L.Lang.add({
            ultradox_title: { uk: 'Ultradox', ru: 'Ultradox', en: 'Ultradox', be: 'Ultradox' },
            ultradox_empty: { uk: 'Нічого не знайдено', ru: 'Ничего не найдено', en: 'Nothing found', be: 'Нічога не знайдзена' },
            ultradox_no_link: { uk: 'Немає посилання на торент', ru: 'Нет ссылки на торрент', en: 'No torrent link', be: 'Няма спасылкі' },
            ultradox_watch: { uk: 'Дивитися', ru: 'Смотреть', en: 'Watch', be: 'Глядзець' },
            ultradox_release_selected: { uk: 'Реліз вибрано', ru: 'Релиз выбран', en: 'Release selected', be: 'Выбран рэліз' }
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
        Tmdb.init();

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
            translation: '', quality: '', imdb: '', backdrop: '', releases: []
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

        var mags = parseMagnets(html);
        for (var i = 0; i < mags.length; i++) {
            var name = mags[i].dn ? decodeURIComponent(mags[i].dn) : '';
            out.releases.push({
                name: name,
                label: releaseLabel(name),
                size: bytesToHuman(mags[i].xl),
                sizeBytes: mags[i].xl,
                magnet: mags[i].magnet
            });
        }
        return out;
    }

    // The og:image of a release page is usually the wide fanart, but for some
    // titles it is a rating badge (Kinopoisk/IMDB gif). Only accept a real photo.
    function validBackdrop(url) {
        if (!url || !/^https?:/i.test(url)) return '';
        if (/\/rating\/|imdb\/pic|kinopoisk\.ru/i.test(url)) return '';
        if (!/\.(jpe?g|png|webp)(\?|$)/i.test(url)) return '';
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

    // External rating data (value, age rating, release status) from TMDB via
    // the Lampa core TMDB integration: the key comes from Lampa's own TMDB
    // settings (Lampa.TMDB.key()) and requests go through Lampa.TMDB.api()
    // (the tmdb_proxy plugin routes them via Lampa's server-side proxy when
    // enabled). The plugin never hardcodes or stores a key. No key / no
    // resolvable match / failed request => the rating UI is hidden (no
    // placeholder, no fabricated value).
    var Tmdb = { enabled: false, cache: null };
    var tmdbInFlight = 0;
    var tmdbQueue = [];
    var TMDB_MAX_INFLIGHT = 2;

    function tmdbKey() {
        try { return window.Lampa.TMDB.key(); } catch (e) { return ''; }
    }

    Tmdb.init = function () {
        if (!window.Lampa.TMDB) return;
        if (!tmdbKey()) return;
        Tmdb.enabled = true;
        try {
            var raw = window.Lampa.Storage.get('udx_tmdb_cache', '{}');
            Tmdb.cache = (typeof raw === 'string') ? (JSON.parse(raw) || {}) : (raw || {});
        } catch (e) { Tmdb.cache = {}; }
    };

    Tmdb.saveCache = function () {
        try { window.Lampa.Storage.set('udx_tmdb_cache', JSON.stringify(Tmdb.cache || {})); } catch (e) {}
    };

    function tmdbGet(path, ok, fail) {
        var L = window.Lampa;
        var net = new L.Reguest();
        net.timeout(15000);
        var url = (L.TMDB.api ? L.TMDB.api(path) : 'https://api.themoviedb.org/3/' + path);
        net.native(url, function (txt) {
            var j = null;
            try { j = JSON.parse(String(txt)); } catch (e) {}
            if (!j || j.success === false) { fail(); return; }
            ok(j);
        }, fail);
    }

    function tmdbEnqueue(job) {
        if (tmdbInFlight < TMDB_MAX_INFLIGHT) { tmdbInFlight++; job(); return; }
        tmdbQueue.push(job);
    }

    function tmdbDone() {
        tmdbInFlight--;
        if (tmdbQueue.length) { tmdbInFlight++; tmdbQueue.shift()(); }
    }

    function normTitle(s) {
        return String(s || '').toLowerCase().replace(/[^a-zа-яёіїєґ\s]/g, '').replace(/\s+/g, ' ').trim();
    }

    // Resolve a work to a TMDB entry. Conservative on purpose: the title must
    // match exactly (normalized) and, when known, the year too — otherwise we
    // rather hide the rating than show a value that belongs to another work.
    Tmdb.find = function (item, done) {
        if (!Tmdb.enabled) { done(null); return; }
        var title = stripYear(item.title);
        if (!title) { done(null); return; }
        var type = item.serial ? 'tv' : 'movie';
        var key = type + '|' + normTitle(title) + '|' + (item.year || '');
        if (Tmdb.cache && Object.prototype.hasOwnProperty.call(Tmdb.cache, key)) {
            var c = Tmdb.cache[key];
            done(c && c.id ? c : null);
            return;
        }
        var lang = 'ru';
        try { lang = window.Lampa.Storage.get('tmdb_lang', 'ru') || 'ru'; } catch (e) {}
        var qs = 'search/' + type + '?api_key=' + tmdbKey() + '&query=' + encodeURIComponent(title) + '&language=' + lang;
        if (type === 'tv' && item.year) qs += '&first_air_date_year=' + item.year;
        tmdbEnqueue(function () {
            tmdbGet(qs, function (j) {
                var res = (j && j.results) || [];
                var want = normTitle(title);
                var match = null;
                for (var i = 0; i < res.length && !match; i++) {
                    var r = res[i];
                    var name = normTitle(type === 'tv' ? r.name : r.title);
                    if (name !== want) continue;
                    var yr = String(type === 'tv' ? (r.first_air_date || '') : (r.release_date || '')).slice(0, 4);
                    if (item.year && yr && yr !== String(item.year)) continue;
                    match = { id: r.id, v: r.vote_average || 0 };
                }
                Tmdb.cache[key] = match || { id: 0 };
                Tmdb.saveCache();
                done(match);
                tmdbDone();
            }, function () {
                done(null);
                tmdbDone();
            });
        });
    };

    Tmdb.rate = function (item, done) {
        Tmdb.find(item, done);
    };

    function pickCert(j) {
        var rs = (j && j.release_dates && j.release_dates.results) || [];
        var pref = ['RU', 'US'];
        var i, k, p, rd;
        for (p = 0; p < pref.length; p++) {
            for (i = 0; i < rs.length; i++) {
                if (rs[i].iso_3166_1 !== pref[p]) continue;
                rd = rs[i].release_dates || [];
                for (k = 0; k < rd.length; k++) if (rd[k].certification) return rd[k].certification;
            }
        }
        for (i = 0; i < rs.length; i++) {
            rd = rs[i].release_dates || [];
            for (k = 0; k < rd.length; k++) if (rd[k].certification) return rd[k].certification;
        }
        return '';
    }

    // Rating + age rating + release status for the detail page: the search
    // match plus the entry details (certification, status) when available.
    Tmdb.full = function (item, done) {
        Tmdb.find(item, function (m) {
            if (!m) { done(null); return; }
            var dkey = m.id + ':d';
            if (Tmdb.cache && Object.prototype.hasOwnProperty.call(Tmdb.cache, dkey)) {
                var c = Tmdb.cache[dkey];
                done({ v: m.v, cert: c.cert || '', status: c.status || '' });
                return;
            }
            var path = (item.serial ? 'tv/' : 'movie/') + m.id + '?api_key=' + tmdbKey() + '&language=ru';
            tmdbEnqueue(function () {
                tmdbGet(path, function (j) {
                    var info = { cert: pickCert(j), status: j.status || '' };
                    Tmdb.cache[dkey] = info;
                    Tmdb.saveCache();
                    done({ v: m.v, cert: info.cert, status: info.status });
                    tmdbDone();
                }, function () {
                    done({ v: m.v, cert: '', status: '' });
                    tmdbDone();
                });
            });
        });
    };

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
                serial: /\/serial\//i.test(cardHref) || /сериал/i.test(cardTitle + ' ' + cardType),
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
            var backdrop = html.find('.udx-backdrop');
            if (backdrop && backdrop.length && typeof backdrop.css === 'function') backdrop.css('opacity', '0');

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

        this.appendCard = function (item) {
            var title = stripYear(item.title);
            var card = L.Template.js('card', { title: title, release_year: item.year || '' });
            card.find('.card__title').text(title);

            // The small line below the title only carries what is absent from
            // the poster (quality/size of fallback rows).
            var meta = [];
            if (item.type && !item.poster) meta.push(item.type);
            if (item.size) meta.push(item.size);
            if (meta.length) card.find('.card__age').text(meta.join(' • '));
            else card.find('.card__age').remove();

            if (item.poster) {
                var img = card.find('.card__img');
                img.src = item.poster;
                img.onerror = function () { this.src = './img/img_broken.svg'; };
            }

            // NUM parity: type badge top-left, quality badge bottom-left (only
            // a real quality token; the type itself is the top-left badge).
            var kind = document.createElement('div');
            kind.addClass('udx-kind');
            kind.text(item.serial ? 'Серіал' : 'Фільм');
            card.find('.card__view').append(kind);

            var qm = String(item.type || '').match(/\b(WEB-DL|Rip|BDRip|HDRip|HDTVRip|DVRip|CamRip|4K|2160p|1080p|720p)\b/i);
            if (qm) {
                var chip = document.createElement('div');
                chip.addClass('udx-chip');
                var qs = document.createElement('span');
                qs.addClass('udx-chip__quality');
                qs.text(qm[0].toUpperCase());
                chip.append(qs);
                card.find('.card__view').append(chip);
            }

            // Rating badge bottom-right from TMDB (async, cached); hidden when
            // there is no resolvable match (no placeholder, no fabricated value).
            if (Tmdb.enabled) {
                Tmdb.rate(item, function (m) {
                    if (!m || !m.v) return;
                    var rate = document.createElement('div');
                    rate.addClass('udx-rate');
                    rate.text(String(Math.round(m.v * 10) / 10));
                    card.find('.card__view').append(rate);
                });
            }

            var self = this;

            card.on('hover:focus', function () {
                last = card;
                if (scroll) scroll.update(card);
                if (item.poster) {
                    var backdrop = html.find('.udx-backdrop');
                    if (backdrop && backdrop.length && typeof backdrop.css === 'function') {
                        backdrop.css({
                            'background-image': 'linear-gradient(90deg,rgba(6,28,41,.93),rgba(6,28,41,.60)),url("' + item.poster.replace(/"/g, '%22') + '")',
                            opacity: '1'
                        });
                    }
                }
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

    // Full release page (catalog -> OK): backdrop only from the film's own fanart,
    // poster on the left, metadata + overview on the right, and a "Watch" action
    // that opens the list of the film's concrete releases; selecting one shows a
    // short confirmation only (playback is a later stage). No TMDB, no core full
    // component. Back returns to the catalog on the same card.
    function FullPage(object) {
        var L = window.Lampa;
        var item = object.item || {};
        var detail = null;
        var built = false;
        var playBtn = null;
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
                self.build();
            }, function () {
                detail = { overview: '', genre: '', country: '', year: '', runtime: '', translation: '', quality: '', imdb: '', backdrop: '', releases: [] };
                self.build();
            });
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(DETAIL_HTML));
                playBtn = html.find('.udx-f__play');
                playBtn.text(L.Lang.translate('ultradox_watch'));
                var self = this;
                playBtn.on('hover:enter', function () { self.showReleases(); });
                var poster = html.find('.udxf__poster');
                if (item.poster) {
                    poster[0].src = item.poster;
                    poster[0].onerror = function () { this.src = './img/img_broken.svg'; };
                } else {
                    poster.remove();
                }
                L.Layer.update(html);
            }

            this.fill();
            if (this.activity) this.activity.toggle();
        };

        this.fill = function () {
            var d = detail || {};

            var bg = html.find('.udxf__backdrop');
            if (d.backdrop) {
                bg[0].style.backgroundImage = 'url("' + d.backdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxf__backdrop--on');
            }

            html.find('.udxf__title').text(stripYear(item.title));

            var top = [];
            if (d.country) top.push(d.country);
            if (d.year) top.push(d.year);
            var topEl = html.find('.udxf__top');
            if (top.length) topEl.text(top.join(' • ')); else topEl.remove();

            var line = [];
            if (d.genre) line.push(d.genre);
            if (d.runtime) line.push(d.runtime);
            if (d.translation) line.push(d.translation);
            var lineEl = html.find('.udxf__line');
            if (line.length) lineEl.text(line.join(' • ')); else lineEl.remove();

            var ov = html.find('.udxf__overview');
            if (d.overview) ov.text(d.overview); else ov.remove();

            // External rating line (TMDB via Lampa core): value, age rating and
            // release status when available; hidden when there is no match.
            var ratingEl = html.find('.udxf__rating');
            if (!Tmdb.enabled) { ratingEl.remove(); return; }
            Tmdb.full(item, function (r) {
                if (!r || (!r.v && !r.cert && !r.status)) { ratingEl.remove(); return; }
                var parts = [];
                if (r.v) parts.push('TMDB ' + (Math.round(r.v * 10) / 10));
                if (r.cert) parts.push(r.cert);
                if (r.status) parts.push(r.status);
                ratingEl.text(parts.join(' • '));
            });
        };

        this.showReleases = function () {
            var rel = (detail && detail.releases) || [];
            if (!rel.length) { L.Noty.show(L.Lang.translate('ultradox_no_link')); return; }
            L.Select.show({
                title: item.title,
                items: rel.map(function (r) {
                    var parts = [];
                    if (r.label) parts.push(r.label);
                    if (r.size) parts.push(r.size);
                    return { title: parts.join(' • '), id: r };
                }),
                onBack: function () { L.Controller.toggle('content'); },
                onSelect: function () {
                    L.Controller.toggle('content');
                    L.Noty.show(L.Lang.translate('ultradox_release_selected'));
                }
            });
        };

        this.start = function () {
            if (L.Activity.active() && L.Activity.active().activity !== this.activity) return;

            L.Controller.add('content', {
                link: this,
                invisible: true,
                toggle: function () {
                    L.Controller.collectionSet(html);
                    L.Controller.collectionFocus(playBtn, html);
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
        };
    }

    if (window.Lampa) boot();
})();
