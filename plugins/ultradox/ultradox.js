/*
 * Lampa plugin: Ultradox (OCTOPUS) -> TorrServer
 * Install: add the published CDN URL (jsDelivr, pinned by commit SHA) in Lampa:
 *          Settings -> Plugins -> +  (e.g. https://cdn.jsdelivr.net/gh/vaservaga/lampa-plugins@<commit-sha>/plugins/ultradox/ultradox.js)
 * Requires Lampa already configured to use TorrServer (internal torrclient + TorrServer URL).
 *
 * UI (Phase 3, NUM parity): core card grid (.category-full + Template 'card')
 * with the type badge top-left, quality badge bottom-left and the year under
 * the title; category buttons in the head (simple-button); full detail page
 * (validated backdrop, poster left, meta, overview) with a release selector.
 * All displayed data comes from the Ultradox HTML itself; no external
 * metadata services are queried and no key is ever hardcoded in this plugin.
 * Torrent/TorrServer playback is a later stage, not wired here.
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
    // Layers pictogram for the quality selector (own minimal mark).
    var ICON_QUALITY = '<svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3l8 4.4-8 4.4-8-4.4L12 3z" fill="currentColor"/><path d="M4 12.2l8 4.4 8-4.4M4 16.4l8 4.4 8-4.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
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
                    '<div class="udxf__line"></div>' +
                    '<div class="udxf__overview"></div>' +
                    '<div class="udxf__fact udxf__fact--director"></div>' +
                    '<div class="udxf__fact udxf__fact--cast"></div>' +
                    '<div class="udxf__actions">' +
                        '<div class="simple-button selector udxf__act udxf__act--quality">' + ICON_QUALITY + '<span class="udxf__act__label udxf__qlab"></span></div>' +
                        '<div class="simple-button selector udxf__act udxf__act--torrents">' + ICON_RELEASES + '<span class="udxf__act__label udxf__tlab"></span></div>' +
                    '</div>' +
                '</div>' +
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
        '.udxf__act--quality{background:rgba(9,29,43,.62);border:1px solid rgba(255,255,255,.24);color:#dbe7f2;}' +
        '.udxf__act--quality.focus{border-color:rgba(255,255,255,.55);transform:translateY(-.1em);box-shadow:0 .3em .8em rgba(0,0,0,.38);}' +
        '.udxf__act--torrents{background:linear-gradient(135deg,#18b7d8 0%,#2e6bf0 100%);border:1px solid rgba(255,255,255,.20);}' +
        '.udxf__act--torrents.focus{transform:translateY(-.1em);box-shadow:0 .4em .9em rgba(0,0,0,.42),0 0 0 .22em rgba(56,197,255,.28);}' +
        '.udx-kind{position:absolute;left:10px;top:10px;z-index:2;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;background:#57F570;color:#0f3d1a;font-weight:700;padding:0 .55em;border-radius:.45em;font-size:.75em;line-height:1.5;white-space:nowrap;pointer-events:none;}' +
        '.udxf__fact{font-size:1.05em;line-height:1.45;color:#9fb2c4;margin-top:.8em;}' +
        '</style>';

    function boot() {
        var L = window.Lampa;
        window.plugin_ultradox_ready = true;

        L.Lang.add({
            ultradox_title: { uk: 'Ultradox', ru: 'Ultradox', en: 'Ultradox', be: 'Ultradox' },
            ultradox_empty: { uk: 'Нічого не знайдено', ru: 'Ничего не найдено', en: 'Nothing found', be: 'Нічога не знайдзена' },
            ultradox_no_link: { uk: 'Немає посилання на торент', ru: 'Нет ссылки на торрент', en: 'No torrent link', be: 'Няма спасылкі' },
            ultradox_quality_pick: { uk: 'Вибрати якість', ru: 'Выбрать качество', en: 'Pick quality', be: 'Выбраць якасць' },
            ultradox_torrents: { uk: 'Торенти', ru: 'Торренты', en: 'Torrents', be: 'Торэнты' },
            ultradox_release_selected: { uk: 'Реліз вибрано', ru: 'Релиз выбран', en: 'Release selected', be: 'Выбран рэліз' },
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
            translation: '', quality: '', director: '', cast: '', imdb: '', backdrop: '', releases: []
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

    // Full release page (catalog -> OK): backdrop only from the film's own fanart,
    // poster on the left, metadata + overview on the right, and a compact action
    // strip (quality selector + "Torrents") whose both controls open the list of
    // the film's concrete releases; selecting one keeps the choice in memory of
    // this page and updates the quality label only (playback is a later stage).
    // No TMDB, no core full component. Back returns to the catalog on the same card.
    function FullPage(object) {
        var L = window.Lampa;
        var item = object.item || {};
        var detail = null;
        var built = false;
        var qualityBtn = null, qualityLabel = null, torrentsBtn = null, torrentsLabel = null;
        var selectedRelease = null;
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
                detail = { overview: '', genre: '', country: '', year: '', runtime: '', translation: '', quality: '', director: '', cast: '', imdb: '', backdrop: '', releases: [] };
                self.build();
            });
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(DETAIL_HTML));
                qualityBtn = html.find('.udxf__act--quality');
                torrentsBtn = html.find('.udxf__act--torrents');
                qualityLabel = html.find('.udxf__qlab');
                torrentsLabel = html.find('.udxf__tlab');
                if (torrentsLabel) torrentsLabel.text(L.Lang.translate('ultradox_torrents'));
                // One shared path for both controls: opening the release list.
                var self = this;
                var openReleases = function () { self.showReleases(); };
                if (qualityBtn) qualityBtn.on('hover:enter', openReleases);
                if (torrentsBtn) torrentsBtn.on('hover:enter', openReleases);
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
            if (this.activity) this.activity.toggle();
        };

        this.fill = function () {
            var d = detail || {};

            var bg = html.find('.udxf__backdrop');
            if (d.backdrop && bg) {
                bg.style.backgroundImage = 'url("' + d.backdrop.replace(/"/g, '%22') + '")';
                bg.addClass('udxf__backdrop--on');
            } else if (item.poster && bg) {
                bg.style.backgroundImage = 'linear-gradient(90deg,rgba(6,28,41,.86),rgba(6,28,41,.35) 58%),linear-gradient(to top,rgba(6,28,41,.78),rgba(6,28,41,0) 42%),url("' + item.poster.replace(/"/g, '%22') + '")';
                bg.addClass('udxf__backdrop--poster');
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

            var directorEl = html.find('.udxf__fact--director');
            if (d.director) directorEl.text(L.Lang.translate('ultradox_director') + ': ' + d.director); else directorEl.remove();

            var castNames = d.cast ? String(d.cast).split(',').map(function (n) { return n.replace(/\s+/g, ' ').trim(); }).filter(function (n) { return n; }) : [];
            var castEl = html.find('.udxf__fact--cast');
            if (castNames.length) {
                var castShown = castNames.slice(0, 5).join(', ');
                if (castNames.length > 5) castShown += ' …';
                castEl.text(L.Lang.translate('ultradox_cast') + ': ' + castShown);
            } else castEl.remove();

            // The quality label mirrors only the release chosen on this page
            // (in-memory); the placeholder stays until the first selection.
            updateQualityLabel();
        };

        // Left-button label: the normalized quality of the release chosen on
        // this page, or the placeholder until the first selection. Only the
        // quality is shown - never a magnet, hash, URL or size.
        function updateQualityLabel() {
            if (!qualityLabel) return;
            var q = (selectedRelease && selectedRelease.label) ? releaseQuality(selectedRelease.label) : '';
            qualityLabel.text(q || L.Lang.translate('ultradox_quality_pick'));
        }

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
                onSelect: function (chosen) {
                    // Informational only: keep the choice in memory of this
                    // detail page and refresh the quality label. No execution.
                    if (chosen && chosen.id) selectedRelease = chosen.id;
                    updateQualityLabel();
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
                    L.Controller.collectionFocus(qualityBtn, html);
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
            qualityBtn = null; qualityLabel = null; torrentsBtn = null; torrentsLabel = null;
            selectedRelease = null;
        };
    }

    if (window.Lampa) boot();
})();
