/*
 * Lampa plugin: Ultradox (OCTOPUS) -> TorrServer
 * Install: add the published CDN URL (jsDelivr, pinned by commit SHA) in Lampa:
 *          Settings -> Plugins -> +  (e.g. https://cdn.jsdelivr.net/gh/vaservaga/lampa-plugins@<commit-sha>/plugins/ultradox/ultradox.js)
 * Requires Lampa already configured to use TorrServer (internal torrclient + TorrServer URL).
 *
 * UI (Phase 2): core card grid (.category-full + Template 'card'),
 * category buttons in the head (simple-button), TorrServer playback.
 */
(function () {
    'use strict';

    if (window.plugin_ultradox_ready) return;
    if (!window.Lampa) {
        document.addEventListener('DOMContentLoaded', function () { if (window.Lampa) boot(); });
        return;
    }
    boot();

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

    var STYLE_HTML = '<style id="ultradox-style">' +
        '.udx-content{position:relative;width:100%;height:100%;overflow:hidden;background:#061c29;}' +
        '.udx-backdrop{position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(90deg,rgba(6,28,41,.93),rgba(6,28,41,.60)),#061c29 center/cover no-repeat;opacity:0;transition:opacity .25s ease,background-image .25s ease;}' +
        '.udx-content__head{position:absolute;top:0;left:0;right:0;z-index:20;display:flex;align-items:center;padding:14px 20px;background:linear-gradient(rgba(0,0,0,.55),transparent);}' +
        '.udx-content__cats{display:flex;align-items:center;}' +
        '.udx-cat{flex-shrink:0;}' +
        '.udx-cat__label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udx-cat.udx-active{background-color:#fff;color:#000;}' +
        '.udx-content__list{position:relative;z-index:1;padding-top:80px;}' +
        '.udx-empty{width:100%;text-align:center;padding:5em 0;color:#9aa4b2;font-size:1.5em;}' +
        '</style>';

    function boot() {
        var L = window.Lampa;
        window.plugin_ultradox_ready = true;

        L.Lang.add({
            ultradox_title: { uk: 'Ultradox', ru: 'Ultradox', en: 'Ultradox', be: 'Ultradox' },
            ultradox_empty: { uk: 'Нічого не знайдено', ru: 'Ничего не найдено', en: 'Nothing found', be: 'Нічога не знайдзена' },
            ultradox_no_link: { uk: 'Немає посилання на торент', ru: 'Нет ссылки на торрент', en: 'No torrent link', be: 'Няма спасылкі' }
        });

        L.Manifest.plugins = {
            type: 'torrent',
            version: '2.0.0',
            name: L.Lang.translate('ultradox_title'),
            description: 'Ultradox/OCTOPUS release list -> TorrServer',
            component: 'ultradox'
        };

        L.Component.add('ultradox', Component);

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

    function loadList(path, ok, err) {
        var order = MIRRORS.slice();
        if (goodBase && order.indexOf(goodBase) !== -1) {
            order.splice(order.indexOf(goodBase), 1);
            order.unshift(goodBase);
        }
        var i = 0;
        (function next() {
            if (i >= order.length) { if (err) err(); return; }
            var base = order[i++];
            fetchText(base + path, function (html) {
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

    function sizeToBytes(s) {
        if (!s) return 0;
        var m = String(s).match(/(\d+(?:\.\d+)?)\s*(TB|GB|Gb|MB|KB)/i);
        if (!m) return 0;
        var n = parseFloat(m[1]);
        var u = m[2].toUpperCase();
        var mult = { KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
        return Math.round(n * (mult[u] || 0));
    }

    function decode(s) {
        return (s || '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
    }

    function parse(html, base) {
        var out = [];
        if (!html) return out;
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
        if (out.length) return out;

        // Current UltraDox category pages use card blocks, not legacy table rows.
        // Detail pages still provide magnets through fetchRealMagnets().
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

    function fileLabel(f) {
        var dn = (f.dn || '').replace(/\.torrent$/i, '');
        return dn || 'Файл';
    }

    function bytesToHuman(b) {
        if (!b) return '';
        var u = ['B', 'KB', 'MB', 'GB', 'TB'], i = 0, n = b;
        while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
        return (n >= 10 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
    }

    function fetchRealMagnets(itemUrl, ok, err) {
        if (!itemUrl) { if (err) err(); return; }
        fetchText(itemUrl, function (html) {
            var found = [], seen = {};
            var ms = (html || '').match(/magnet:[^\s"<>]+/g) || [];
            for (var i = 0; i < ms.length; i++) {
                var m = decode(ms[i]);
                var info = magnetInfo(m);
                if (!info.hash || seen[info.hash]) continue;
                seen[info.hash] = true;
                found.push({ magnet: m, xl: info.xl, dn: (m.match(/dn=([^&]+)/) || [])[1] || '' });
            }
            if (found.length) ok(found); else if (err) err();
        }, function () { if (err) err(); });
    }

    function pickBest(found, wantBytes) {
        if (!found || !found.length) return null;
        if (!wantBytes) {
            var b = found[0];
            for (var i = 1; i < found.length; i++) if (found[i].xl > b.xl) b = found[i];
            return b;
        }
        var best = null, bd = -1;
        for (var j = 0; j < found.length; j++) {
            var d = Math.abs(found[j].xl - wantBytes);
            if (bd < 0 || d < bd) { bd = d; best = found[j]; }
        }
        return best;
    }

    function Component(object) {
        var L = window.Lampa;
        var items = [], page = 0, catId = null;
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
            var token = ++loadToken;
            var self = this;
            loadList(c.path, function (data) {
                filterRussianProductions(data, function (filtered) {
                    if (token !== loadToken) return;
                    items = filtered;
                    self.build();
                });
            }, function () {
                if (token !== loadToken) return;
                items = [];
                self.build();
            });
        };

        this.build = function () {
            if (this.activity) this.activity.loader(false);

            if (!built) {
                built = true;
                html.append($(CONTENT_HTML));

                scroll = new Lampa.Scroll({ mask: true, over: true });
                scroll.onEnd = (function () { this.next(); }).bind(this);

                grid = document.createElement('div');
                grid.addClass('category-full');
                scroll.append(grid);
                html.find('.udx-content__list').append(scroll.render(true));

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
            items = [];
            if (this.activity) this.activity.loader(true);
            this.load(c.id);
        };

        this.display = function () {
            page = 0;
            last = null;
            if (grid) grid.empty();
            if (scroll) scroll.reset();

            if (!items.length) {
                var em = document.createElement('div');
                em.addClass('udx-empty');
                em.text(L.Lang.translate('ultradox_empty'));
                grid.append(em);
            } else {
                this.next();
            }

            if (this.activity) this.activity.toggle();
        };

        this.next = function () {
            var start = page * PAGE;
            if (start >= items.length) return;
            var slice = items.slice(start, start + PAGE);
            var self = this;
            slice.forEach(function (item) { self.appendCard(item); });
            page++;
            if (scroll) L.Layer.visible(scroll.render(true));
        };

        this.appendCard = function (item) {
            var ym = item.title.match(/\((19\d{2}|20\d{2})\)/) || item.title.match(/(19|20)\d{2}/);
            var year = ym ? (ym[1] || ym[0]) : '';

            var card = L.Template.js('card', { title: item.title, release_year: year });
            card.find('.card__title').text(item.title);

            var meta = [];
            if (item.type && !item.poster) meta.push(item.type);
            if (year) meta.push(year);
            if (item.size) meta.push(item.size);
            card.find('.card__age').text(meta.join(' • '));

            if (item.poster) {
                var img = card.find('.card__img');
                img.src = item.poster;
                img.onerror = function () { this.src = './img/img_broken.svg'; };
                if (item.type) {
                    var t = document.createElement('div');
                    t.addClass('card__type');
                    t.text(item.type);
                    card.find('.card__view').append(t);
                }
            } else {
                var v = card.find('.card__view');
                if (v) v.remove();
            }

            var el = {
                title: item.title,
                Title: item.title,
                Tracker: 'Ultradox',
                size: item.size,
                Size: sizeToBytes(item.size),
                Seeders: 0,
                Peers: 0,
                MagnetUri: item.magnet,
                Link: item.fileUrl || item.magnet,
                _udx: item
            };

            var self = this;

            card.on('hover:focus', function () {
                last = card;
                if (scroll) scroll.update(card, true);
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
                self.chooseFile(el);
            });

            card.on('hover:long', function () {
                self.chooseFile(el);
            });

            card.on('visible', function () {
                if (L.Controller.own && L.Controller.own(self)) L.Controller.collectionAppend(card);
            });

            if (!last) last = card;
            if (L.Controller.own && L.Controller.own(this)) L.Controller.collectionAppend(card);
            grid.append(card);
        };

        this.playAuto = function (el) {
            this.run(el, null);
        };

        this.chooseFile = function (el) {
            var self = this;
            this.ensureReal(el, function (found) {
                if (found.length == 1) { self.run(el, 0); return; }
                L.Select.show({
                    title: el.title,
                    items: found.map(function (f, i) {
                        return { title: fileLabel(f) + ' • ' + bytesToHuman(f.xl), id: i };
                    }),
                    onBack: function () { L.Controller.toggle('content'); },
                    onSelect: function (a) {
                        L.Controller.toggle('content');
                        self.run(el, a.id);
                    }
                });
            });
        };

        this.ensureReal = function (el, cb) {
            if (el._udx && el._udx._real) { cb(el._udx._real); return; }
            var self = this;
            if (this.activity) this.activity.loader(true);
            fetchRealMagnets(el._udx ? el._udx.itemUrl : '', function (found) {
                if (el._udx) el._udx._real = found;
                if (self.activity) self.activity.loader(false);
                cb(found);
            }, function () {
                if (self.activity) self.activity.loader(false);
                cb([]);
            });
        };

        this.run = function (el, idx) {
            var self = this;
            this.ensureReal(el, function (found) {
                var best = (idx == null) ? pickBest(found, el.Size) : found[idx];
                if (!best) {
                    L.Noty.show(L.Lang.translate('ultradox_no_link'));
                    return;
                }
                var o = {
                    title: el.title,
                    Title: el.title,
                    Tracker: 'Ultradox',
                    size: bytesToHuman(best.xl),
                    Size: best.xl,
                    Seeders: 0,
                    Peers: 0,
                    MagnetUri: best.magnet,
                    Link: ''
                };
                var movie = {
                    title: el.title,
                    original_title: el.title,
                    img: '',
                    number_of_seasons: (el._udx && el._udx.serial) ? 1 : undefined
                };
                L.Torrent.start(o, movie);
            });
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
})();
