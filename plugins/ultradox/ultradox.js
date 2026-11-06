/*
 * Lampa plugin: Ultradox (OCTOPUS) -> TorrServer
 * Install: add the published CDN URL (jsDelivr, pinned by commit SHA) in Lampa:
 *          Settings -> Plugins -> +  (e.g. https://cdn.jsdelivr.net/gh/vaservaga/lampa-plugins@<commit-sha>/plugins/ultradox/ultradox.js)
 * Requires Lampa already configured to use TorrServer (internal torrclient + TorrServer URL).
 *
 * UI (Phase 5, NUM parity): core card grid (.category-full + Template 'card')
 * with the type badge top-left, quality badge bottom-left and the year under
 * the title; category buttons in the head (simple-button); full detail page
 * in the NUM reference layout 1:1 (validated backdrop, large poster on the
 * left, meta block: country • year, large title, original title, rating
 * badge, runtime • genre line, seasons, the director and the full cast
 * lines, then exactly two action pills above - left
 * "Онлайн", right "TorrServer" - both on the native Lampa button surface
 * (core glass + the focus invert); below them a
 * full-width "Детально" details strip with the complete overview - no text
 * truncation - inside a scroll viewport) with
 * exactly two actions:
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
    // Globe mark (kept for the legacy online page icon use).
    var ICON_ONLINE = '<svg width="1.3em" height="1.3em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.7 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.7-3.8-9S9.5 5.6 12 3z" stroke="currentColor" stroke-width="1.7"/></svg>';
    // Play mark for the "Онлайн" pill (the MODS reference shape: a white play
    // triangle sitting on the gradient disc).
    var ICON_PLAY = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.2-6.8c.6-.4.6-1.4 0-1.8L9.6 4.3c-.7-.4-1.6.1-1.6.9z" fill="currentColor"/></svg>';
    // List pictogram for the releases button: a plain list, no play hint.
    var ICON_RELEASES = '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.5 5.5h11M8.5 12h11M8.5 18.5h11" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="4.2" cy="5.5" r="1.5" fill="currentColor"/><circle cx="4.2" cy="12" r="1.5" fill="currentColor"/><circle cx="4.2" cy="18.5" r="1.5" fill="currentColor"/></svg>';

    var CONTENT_HTML =
        '<div class="udx-content">' +
            '<div class="udx-bg udx-bg--first" aria-hidden="true"></div>' +
            '<div class="udx-bg udx-bg--second" aria-hidden="true"></div>' +
            '<div class="udx-content__head">' +
                '<div class="udx-content__cats"></div>' +
            '</div>' +
            '<div class="udx-content__list"></div>' +
        '</div>';

    // NUM 1:1 detail layout: the backdrop + gradient sit under a scroll
    // viewport (.udxf__slot); the scroll content is built separately
    // (ZONE_HTML) so the same node is never parented twice - the top zone
    // (poster + meta block with the two action pills) and the full-width
    // details strip below it. The release side window (user request
    // 2026-11-04): the "Онлайн" action opens this right-hand panel over the
    // detail page instead of a dedicated full page; it lists the item's real
    // releases (quality • size, the site's own upload date) and BACK / a left
    // move closes it.
    var DETAIL_HTML =
        '<div class="udxf">' +
            '<div class="udxf__backdrop" aria-hidden="true"></div>' +
            '<div class="udxf__gradient" aria-hidden="true"></div>' +
            '<div class="udxf__slot"></div>' +
            '<div class="udxf__panel" aria-hidden="true">' +
                '<div class="udxf__panel__list"></div>' +
            '</div>' +
        '</div>';

    var ZONE_HTML =
        '<div class="udxf__content">' +
            '<div class="udxf__zone">' +
                '<img class="udxf__poster" alt="">' +
                '<div class="udxf__meta">' +
                    '<div class="udxf__top"></div>' +
                    '<div class="udxf__title"></div>' +
                    '<div class="udxf__orig hide"></div>' +
                    '<div class="udxf__rate hide"></div>' +
                    '<div class="udxf__line"></div>' +
                    '<div class="udxf__seasons hide"></div>' +
                    '<div class="udxf__fact udxf__fact--director hide"></div>' +
                    '<div class="udxf__fact udxf__fact--cast hide"></div>' +
                    '<div class="udxf__actions">' +
                        '<div class="simple-button selector udxf__act udxf__act--online">' + ICON_PLAY + '<span class="udxf__act__label udxf__olab"></span></div>' +
                        '<div class="simple-button selector udxf__act udxf__act--torrents">' + ICON_RELEASES + '<span class="udxf__act__label udxf__tlab"></span></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="udxf__details selector">' +
                '<div class="udxf__details-head"></div>' +
                '<div class="udxf__overview"></div>' +
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
        // Plugin-painted ambience (user clarification 2026-11-07): each screen
        // blurs + darkens its OWN Ultradox poster/fanart as a plain CSS
        // background layer behind the content. The core .background canvas
        // stays untouched (it keeps serving the stock sections): it cannot
        // show these posters with web security on - the core forces
        // crossOrigin=Anonymous on its background Image and the poster host
        // sends no Access-Control-Allow-Origin, so the core canvas would just
        // fail to load them. A plain background-image display needs no CORS.
        // The layers live INSIDE the screen roots, so leaving Ultradox
        // destroys them with the activity DOM - nothing is left covering the
        // other screens (the core canvas never received an Ultradox image).
        // Ambience under the head (user request 2026-11-05: "значки, а не
        // сама панель" - the icons float over the page atmosphere, no flat
        // dark bar): the core .head is transparent (fixed, no background) and
        // .wrap__content reserves 4em of padding under it. The screen roots
        // pull UP into that 4em zone (margin-top:-4em) and grow by the same
        // 4em (height:calc(100% + 4em)) so the bottom stays flush; their
        // backdrop layers (top:0/bottom:0) then cover the head zone too.
        // In-flow content is shifted back down by padding-top:4em (catalog +
        // list); the detail content is absolute, so its viewport keeps
        // position via .udxf__slot top:4em - every element stays where it
        // was validated.
        '.udx-content{position:relative;width:100%;height:calc(100% + 4em);overflow:hidden;margin-top:-4em;padding-top:4em;display:flex;flex-direction:column;}' +
        // Ambience backdrop: two permanent crossfading layers behind the grid
        // (focus on a card swaps the image, NUM-style). display must stay
        // visible - the OFF state is opacity:0 only (a display:none layer was
        // never shown at all on the TV); the content (z 20/1) stays above.
        // No directional veil (user request 2026-11-04): the backdrop is one
        // uniform image all around - the darkening gradient read as a black
        // band over the top-left of the screen.
        '.udx-bg{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;pointer-events:none;background:center/cover no-repeat;transform:scale(1.10);filter:blur(20px) brightness(.55) saturate(.78);opacity:0;transition:opacity .32s ease;}' +
        '.udx-bg--on{opacity:1;}' +
        // The tabs are their own zone above the grid (flex flow, NOT an
        // overlay): the head keeps its natural height, the grid area is what
        // remains - no poster can be covered by the tabs and the tab height
        // cannot affect the card geometry. No glass band here: the tabs float
        // over the plain Lampa background (+ the blurred backdrop behind),
        // nothing painted on top of the content zone.
        // The core top bar is visible on the catalog again (user request
        // 2026-11-05), so the tab zone keeps the normal top padding (the old
        // 34px margin compensated for the hidden bar).
        '.udx-content__head{flex:0 0 auto;z-index:20;display:flex;align-items:center;padding:14px 20px 14px 20px;}' +
        '.udx-content__cats{display:flex;align-items:center;}' +
        '.udx-cat{flex-shrink:0;}' +
        '.udx-cat__label{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udx-cat.udx-active{background-color:#fff;color:#000;}' +
        // The grid area is the flex remainder below the tab zone: flex-bounded
        // and the scroll fills it exactly (invariant: the TV scroll driver
        // clamps travel to the scroll element's offsetHeight, so the viewport
        // must stay height-bounded).
        '.udx-content__list{flex:1 1 auto;min-height:0;position:relative;z-index:1;}' +
        '.udx-content__list>.scroll{height:100%;}' +
        // No catalog transition override (user report 2026-11-04): the feed
        // must scroll EXACTLY like the core Lampa build (compared on the TV) -
        // the core 0.3s default-ease transform transition on every scroll
        // body, driven by one scroll.update per focus move. The earlier
        // 0.45s cubic-bezier ease-out override read as a jerky crawl next to
        // the core, so the catalog keeps the stock core curve.
        // Small clear band between the tab zone and the first poster row
        // (the core 2.5em mask padding read as a large empty block).
        // Top/side clearance so the first row's focus halo (-0.5em band) is
        // never clipped at the viewport edges (user request 2026-11-04).
        '.udx-content .scroll--mask .scroll__content{padding:1.4em 0.5em;}' +
        '.udx-empty{width:100%;text-align:center;padding:5em 0;color:rgba(255,255,255,.5);font-size:1.5em;}' +
        // Row geometry: exactly five equal cells filling the whole line (NUM
        // reference: edge to edge, the core 0.5em side paddings are the gap).
        // The core sets *{box-sizing:border-box}, so the 0.5em paddings sit
        // INSIDE the width; 20% - 0.5px keeps 5 x width strictly under the
        // line for any container width (round(0.2W) x 5 can exceed W by a
        // pixel and wrap the fifth card; flex-basis:0 puts all items on ONE
        // line - neither is safe, the explicit sub-100% width is).
        // margin-bottom is the vertical distance between rows (user reference
        // screenshot 2026-11-06, "така відстань ... між постерами": the band
        // from the year line to the next row's poster top measures 168px at a
        // card pitch of 326px - our card pitch (~345px) matches it, so the
        // same absolute air: 7em + the age line's 0.36em reserved slack =
        // 7.36em ~ 168px at the TV root font 1920/84.17 = 22.8px; the earlier
        // 2.5em read as a cramped 65px against that reference).
        // Five equal cells, slightly sub-20% (a thin inter-column gap, cards
        // a touch smaller per user request 2026-11-04 - no rounded-percent
        // wrap, not a single 20-item line; NUM reference).
        '.udx-content .category-full .card{width:calc(20% - 0.5em);flex-shrink:0;margin-bottom:7em;}' +
        // Poster-to-title gap: 0.5em = 8px at the 16px root font (the 8-12px
        // band measured on the NUM reference at 1920x1080); one value for all
        // three category tabs.
        // No overflow:hidden here: the focus ring below is a ::after band that
        // extends -0.5em OUTSIDE the poster box; clipping would erase it.
        '.udx-content .card__view{position:relative;margin-bottom:0.5em;}' +
        // NUM reference title: one scale up, regular weight (the earlier 0.9em
        // semibold read smaller and heavier than the reference grid).
        '.udx-content .card__title{margin-top:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-height:2.5em;font-size:1em;line-height:1.2em;font-weight:400;color:#fff;}' +
        // Year line dimmed like the NUM reference grid (white title, gray year).
        '.udx-content .card__age{min-height:1.4em;margin-top:0;font-size:0.8em;line-height:1.3em;color:rgba(255,255,255,.5);}' +
        // Catalog-addition date (latest release upload date, real data): shown
        // after the release year, dimmer still, so the two dates stay distinct.
        '.udx-content .card__age .udx-ad{color:rgba(255,255,255,.45);}' +
        // Focus halo (user request 2026-11-04): the core's white ring
        // (.card.focus .card__view::after) re-drawn in the NUM green
        // (#57F570) - the halo the reference shows around an active poster.
        // Same geometry as the core band (0.3em border, -0.5em offset,
        // z-index -1 behind the poster, radius 1.4em); only the color differs.
        // Poster box only - a whole-card ring would reach into the next row's
        // title zone (the row air is the 7em margin below the card, the halo
        // must stay under it).
        '.udx-content .card.focus .card__view::after{content:"";position:absolute;top:-0.5em;left:-0.5em;right:-0.5em;bottom:-0.5em;border:0.3em solid #57F570;border-radius:1.4em;z-index:-1;pointer-events:none;}' +
        '.udx-content .card.hover .card__view::after{border-color:rgba(87,245,112,.5);}' +
        // No glass top panel on Ultradox screens (user correction 2026-11-04):
        // the core .head keeps its native Lampa surface; nothing is painted
        // on top of the content zone.
        '.udx-chip{position:absolute;left:10px;bottom:10px;z-index:2;display:flex;align-items:stretch;max-width:calc(100% - 20px);overflow:hidden;border-bottom-left-radius:0.55em;pointer-events:none;}' +
        '.udx-chip span{font-size:0.75em;line-height:1.5;padding:0 0.55em;white-space:nowrap;}' +
        '.udx-chip__quality{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;background:#ffe216;color:#000;}' +
        // Same under-the-head extension as the catalog (user request
        // 2026-11-05): the fanart/veil backdrop covers the 4em zone under the
        // transparent core head; the content (the absolute .udxf__slot
        // viewport) stays at its validated position via top:4em below. The
        // opaque root is the neutral surface when no image is usable.
        '.udxf{position:relative;width:100%;height:calc(100% + 4em);overflow:hidden;margin-top:-4em;background:#1d1f20;}' +
        // The core top bar stays visible on every Ultradox screen (user
        // request 2026-11-05): the screens sit in flow in the core content
        // area below the head, exactly like a core page. The core gives
        // .wrap/.wrap__content an explicit height via frameUpdate, so
        // .udxf/.udxl height:100% resolves against a real box and the inner
        // .scroll{height:100%} viewport stays bounded for the TV scroll
        // driver's maxOffset clamp.
        '.udxf__backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;background:center/cover no-repeat;opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        // NUM-style backdrop: the image is ALWAYS a soft-blurred atmosphere
        // (never a flat dark surface). The fanart is blurred lightly and kept
        // bright enough to read as the artwork; scale hides the blur edge.
        '.udxf__backdrop--on{opacity:1;transform:scale(1.06);filter:blur(6px) brightness(.72) saturate(.9);}' +
        // Poster-as-backdrop fallback: a small poster stretched full-screen
        // shows upscale block artifacts, so a stronger blur hides them; the
        // tone is bright (not a flat dark fill) so it reads as a blurred
        // poster - the zone veil keeps the text legible.
        '.udxf__backdrop--poster{opacity:1;transform:scale(1.06);filter:blur(7px) brightness(.62) saturate(.92);}' +
        // Valid-backdrop veil (NUM-style): dark text zone on the left, the
        // scene stays clearly visible toward the right, soft bottom fade.
        '.udxf__gradient{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.82),rgba(0,0,0,.42) 46%,rgba(0,0,0,.06) 82%),linear-gradient(to top,rgba(0,0,0,.58),rgba(0,0,0,0) 46%);}' +
        // Poster-fallback state (.udxf--poster on the root): the poster doubles
        // as the backdrop, so the veil darkens the left text zone and the bottom
        // rows (title/overview/actions) and fades to clear artwork toward the
        // right and the top - no layer is opaque, so the image stays visible
        // as atmosphere on the right.
        '.udxf--poster .udxf__gradient{background:linear-gradient(90deg,rgba(0,0,0,.86),rgba(0,0,0,.58) 46%,rgba(0,0,0,.1) 80%),linear-gradient(to top,rgba(0,0,0,.66),rgba(0,0,0,0) 46%);}' +
        // NUM reference geometry (measured from the NUM detail screen): the
        // poster is large (~22em wide at the 1080p root font), the title is a
        // display size (3em), the meta block sits to the right of the poster,
        // and the "Детально" strip spans the full width below both.
        // The scroll viewport starts 4em DOWN (the head zone is ambience, not
        // content - see the root rule): the page keeps its validated geometry
        // (fits 1080p without scrolling) while the backdrop fills the head.
        '.udxf__slot{position:absolute;top:4em;left:0;right:0;bottom:0;z-index:2;}' +
        // Hard height bound on the core scroll element: the TV scroll driver
        // clamps travel to maxOffset(body vs html offsetHeight) - without a
        // fixed viewport height the page can never scroll.
        '.udxf__slot .scroll{position:relative;height:100%;overflow:hidden;}' +
        '.udxf__content{min-height:100%;}' +
        // Compact geometry (user request 2026-11-04): the whole page - zone,
        // pills and the full "Детально" strip - must fit a 1920x1080 screen
        // without scrolling: no min-height dead space under the poster, tight
        // padding and line spacing. The scroll viewport below stays
        // height-bounded as a safety net for unusually long text.
        // align-items:stretch: the meta column spans the poster's full height
        // (reference layout: top line at the poster top, the action pills at
        // the poster bottom - "текст і кнопки на рівні з постером").
        '.udxf__zone{display:flex;align-items:stretch;padding:4.5% 6% 1% 5%;box-sizing:border-box;}' +
        // The poster carries an explicit 2:3 box (min-height for the 19em
        // width): its bottom edge then always defines the zone bottom for
        // normal content, so the action strip rides EXACTLY the poster bottom
        // even in a webview that does not stretch replaced elements (a short
        // poster cover-crops into the box - never distorted); when the meta
        // column grows past the box the poster stretches with object-fit:cover.
        '.udxf__poster{flex-shrink:0;width:19em;min-height:28.5em;object-fit:cover;border-radius:1em;background:#3E3E3E;box-shadow:0 1em 2.4em rgba(0,0,0,.55);}' +
        // The meta column spans the poster's full height (user request
        // 2026-11-04: text and buttons at the level of the poster) - top line
        // starts at the poster top, the actions ride the poster bottom.
        '.udxf__meta{display:flex;flex-direction:column;margin-left:2.5em;min-width:0;max-width:64%;}' +
        '.udxf__top{font-size:1.2em;color:rgba(255,255,255,.6);letter-spacing:.03em;}' +
        // Display-size title (user request 2026-11-04: match the reference -
        // a large regular-weight display title over the meta line).
        '.udxf__title{font-size:4em;font-weight:400;line-height:1.1;color:#fff;margin-top:.25em;}' +
        '.udxf__line{font-size:1.08em;color:rgba(255,255,255,.5);margin-top:.5em;}' +
        // Full overview - no line clamp; the compact spacing keeps even a long
        // one inside the 1080p page.
        '.udxf__overview{font-size:1.1em;line-height:1.45;color:#fff;margin-top:.5em;}' +
        // Compact horizontal action strip, ~60px tall at the 1080p root font
        // (2.9em of the 1.3em button font), 1em gap, two-line wrap on narrow
        // columns. Default state: a TRANSPARENT dark-glass pill (the reference
        // "MODS's" look - barely there over the backdrop); focus turns it into
        // the 1:1 reference green->blue gradient pill (user request
        // 2026-11-04, both states from the reference screenshots). White icon
        // + white regular-weight label, the reference proportions (big label
        // in a compact bar). No per-role rules - both inherit this base.
        // The action strip rides the BOTTOM of the poster (the meta column is
        // a flex column stretched to the poster height): margin-top:auto eats
        // the free space, so the text starts at the poster top and the pills
        // sit at the poster bottom - the reference layout.
        '.udxf__actions{display:flex;align-items:center;flex-wrap:wrap;gap:1em;margin-top:auto;padding-top:.8em;}' +
        '.udxf__act{display:inline-flex;align-items:center;justify-content:center;gap:.6em;height:2.9em;padding:0 1.5em;border-radius:.5em;font-size:1.3em;font-weight:400;line-height:1;white-space:nowrap;flex:0 1 auto;max-width:100%;color:#fff;background:rgba(24,26,28,.6);}' +
        '.udxf__act svg{flex:0 0 auto;opacity:1;}' +
        '.udxf__act__label{min-width:0;overflow:hidden;text-overflow:ellipsis;}' +
        // Focus: the pill becomes the 1:1 reference green->blue gradient
        // surface (the reference screenshot shows a clean gradient - no green
        // ring, no brightness lift). Transform-free, zero layout shift.
        '.udxf__act.focus{background:linear-gradient(90deg,#37a26e 0%,#316fdd 100%);}' +
        '.udx-kind{position:absolute;left:10px;top:10px;z-index:2;max-width:calc(100% - 20px);overflow:hidden;text-overflow:ellipsis;background:#57F570;color:#000;font-weight:700;padding:0 .55em;border-radius:.45em;font-size:.75em;line-height:1.5;white-space:nowrap;pointer-events:none;}' +
        // The third-party interface_mod plugin (an Lampa user setting) appends
        // its own type label (.content-label, left:-0.8em -> clipped corner
        // speckles) to every card__view. Hide it inside our grid so a card
        // keeps exactly one type badge - ours.
        '.udx-content .card__view .content-label{display:none !important;}' +
        // That plugin (and the core chip for quality) position their labels
        // off-card (left:-0.8em -> letters clipped at the card corners).
        // Reposition them inside the poster on every card of Lampa.
        '.card__view>.content-label{left:10px!important;top:10px!important;}' +
        '.card__view>.card__quality{left:10px!important;bottom:10px!important;}' +
        // Full-width details strip under the top zone: heading, the complete
        // overview, director and the full cast (wrapped, never truncated).
        '.udxf__details{padding:0 6% 1% 5%;}' +
        '.udxf__details-head{font-size:1.3em;font-weight:700;line-height:1.3;color:#fff;margin-top:.6em;}' +
        '.udxf__fact{font-size:1.08em;line-height:1.45;color:rgba(255,255,255,.6);margin-top:.5em;}' +
        // The director line sits a touch lower in the meta column (user
        // request 2026-11-05: the fact pair read too high under the rating
        // line); the cast line keeps its .5em gap below the director.
        '.udxf__fact--director{margin-top:1em;}' +
        // Focus target: the whole strip receives the down-navigation focus
        // (scroll.update); no visible ring - the full-width white box-shadow
        // read as two horizontal lines across the screen.
        '.udxf__details.focus{background:transparent;box-shadow:none;outline:none;}' +
        // TMDB enrichment slots: hidden until a real value arrives (best-effort,
        // the page never waits for them and keeps working without any of them).
        '.udxf .hide{display:none;}' +
        // Rating as a compact badge chip (the text format is a test contract:
        // "X.X TMDB"); the surface is the core .full-start__rate glass.
        '.udxf__rate{display:inline-flex;align-items:baseline;background:rgba(0,0,0,.3);padding:.3em .8em;border-radius:.3em;font-size:1em;font-weight:700;color:#fff;margin-top:.8em;}' +
        '.udxf__orig{font-size:1em;color:rgba(255,255,255,.5);margin-top:.3em;}' +
        '.udxf__seasons{font-size:1.05em;color:rgba(255,255,255,.5);margin-top:.8em;}' +
        // Release side window (the "Онлайн" target): a native-Lampa side-menu
        // surface (dark) at the right edge of the detail page. Per the user's
        // drawn scheme (2026-11-05): flush with the top/right/bottom edges
        // (top:0;right:0;bottom:0 - the top raised, the right/bottom insets
        // gone), rounded 1.4em (the card halo radius); 28% wide (widened from
        // 24% per user report 2026-11-05: the row's green focus halo pressed
        // the panel's left edge) so the left edge (72%) still clears the
        // action strip (the right pill ends at ~67%); the rows are
        // full-width bars (text left), not fit-content pills.
        // display:none when closed so its selectors leave the spatial focus
        // map; the scroll viewport stays height-bounded (TV driver clamps
        // travel to the scroll element's offsetHeight).
        '.udxf__panel{position:absolute;top:0;right:0;bottom:0;width:28%;z-index:30;display:none;flex-direction:column;box-sizing:border-box;padding:1.5em 1.5em 1em;background:rgba(16,18,21,.96);border-left:1px solid rgba(255,255,255,.08);border-radius:1.4em;}' +
        '.udxf__panel--open{display:flex;}' +
        '.udxf__panel__list{flex:1 1 auto;min-height:0;position:relative;}' +
        '.udxf__panel__list>.scroll{position:relative;height:100%;overflow:hidden;}' +
        // Rows: the former full release page shape (quality • size on the main
        // line, the site's own upload date below), core simple-button surface,
        // auto height for the two lines. Focus: a darkened bar only - NO
        // green halo (user request 2026-11-05: the quality pick should sit
        // without the focus ring); the list-page rows (.udxl__row) keep it.
        // Full-width bars in the panel (user's drawn scheme 2026-11-05): the
        // row spans the panel content box, text left; an overly long label
        // wraps inside the bar. Less rounded than the card halo (user request
        // 2026-11-05: "не такі заокруглені"): 0.7em, not the 1.4em pill.
        '.udxf__prow{display:block;width:100%;box-sizing:border-box;white-space:normal;margin:0 0 .7em 0;height:auto;min-height:2.8em;padding:.55em 1.1em;border-radius:0.7em;}' +
        '.udxf__prow.focus{background-color:rgba(0,0,0,.55);color:#fff;}' +
        '.udxf__prow__main{font-size:1.05em;font-weight:600;color:#fff;line-height:1.35;}' +
        '.udxf__prow__sub{font-size:.9em;color:rgba(255,255,255,.55);margin-top:.25em;line-height:1.3;}' +
        // Full-page list screens (NUM-style: info card left, real rows right).
        // Same under-the-head extension as the catalog/detail (user request
        // 2026-11-05): the backdrop/veil cover the 4em zone under the
        // transparent core head; padding-top:4em keeps the in-flow .udxl__body
        // (height:100% of the reduced content box) at its validated position.
        // The opaque root is the neutral surface when no image is usable.
        '.udxl{position:relative;width:100%;height:calc(100% + 4em);overflow:hidden;margin-top:-4em;padding-top:4em;background:#1d1f20;}' +
        '.udxl__backdrop{position:absolute;top:0;left:0;right:0;bottom:0;z-index:0;background:center/cover no-repeat;opacity:0;transition:opacity .3s ease;pointer-events:none;}' +
        '.udxl__backdrop--on{opacity:1;}' +
        '.udxl__backdrop--poster{opacity:1;transform:scale(1.06);filter:blur(7px) brightness(.62) saturate(.92);}' +
        // List-screen veil (NUM-style): dark card zone on the left, the
        // backdrop stays visible behind the rows on the right.
        '.udxl__veil{position:absolute;top:0;left:0;right:0;bottom:0;z-index:1;pointer-events:none;background:linear-gradient(90deg,rgba(0,0,0,.78),rgba(0,0,0,.34) 55%,rgba(0,0,0,.08) 85%),linear-gradient(to top,rgba(0,0,0,.50),rgba(0,0,0,0) 46%);}' +
        '.udxl__body{position:relative;z-index:2;height:100%;display:flex;align-items:center;padding:0 5%;box-sizing:border-box;gap:2em;}' +
        // The card column is exactly the poster (bigger: 13em); the title and
        // meta hang below it absolutely, so centering the column in the body
        // centers the POSTER - the row block (also centered) stays symmetric
        // to the poster, which sits lower than the first row.
        '.udxl__card{flex:0 0 auto;width:13em;position:relative;}' +
        '.udxl__poster{width:100%;border-radius:1em;background:#3E3E3E;box-shadow:0 .8em 2em rgba(0,0,0,.55);}' +
        '.udxl__title{position:absolute;top:100%;left:0;right:0;margin-top:.7em;font-size:1.25em;line-height:1.25;color:#fff;text-align:center;min-height:2.5em;}' +
        '.udxl__meta{position:absolute;top:calc(100% + 4em);left:0;right:0;font-size:.95em;line-height:1.45;color:rgba(255,255,255,.5);text-align:center;}' +
        // Rows form a bounded block beside the info card (NUM list
        // proportion), not full-width strips.
        '.udxl__list{flex:0 1 auto;width:64%;max-width:54em;min-width:0;height:86%;position:relative;}' +
        '.udxl__rows{width:100%;}' +
        // Row: main+sub stack on the left, an optional right-aligned quality
        // cell (online rows) on the right. Native Lampa row surface (core
        // .torrent-item / .online values): glass rgba(0,0,0,.3), radius .3em,
        // no border; the focus is the confirmed .online.focus white ring
        // (the background is restated so the core .simple-button.focus invert
        // never turns the row solid white).
        '.udxl__row{display:flex;align-items:center;gap:1.2em;width:100%;margin:.5em 0;padding:.65em 1.1em;border-radius:.3em;background:rgba(0,0,0,.3);text-align:left;box-sizing:border-box;}' +
        '.udxl__row.focus{background-color:rgba(0,0,0,.3);box-shadow:0 0 0 .2em #57F570;}' +
        '.udxl__row__body{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}' +
        '.udxl__row__main{font-size:1.05em;font-weight:600;line-height:1.35;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udxl__row__sub{font-size:.9em;line-height:1.35;color:rgba(255,255,255,.5);margin-top:.2em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.udxl__row__q{flex:0 0 auto;font-size:.95em;font-weight:700;line-height:1.4;color:#fff;white-space:nowrap;}' +
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
            ultradox_torrserver: { uk: 'Торренти', ru: 'Торренты', en: 'Torrents', be: 'Торэнты' },
            ultradox_seasons: { uk: 'Сезонів', ru: 'Сезонов', en: 'Seasons', be: 'Сезонаў' },
            ultradox_director: { uk: 'Режисер', ru: 'Режиссёр', en: 'Director', be: 'Рэжысёр' },
            ultradox_cast: { uk: 'У ролях', ru: 'В ролях', en: 'Starring', be: 'У ролях' },
            ultradox_details: { uk: 'Детально', ru: 'Детали', en: 'Details', be: 'Дэталі' }
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
        // The dedicated full release page is gone (user request 2026-11-04):
        // the "Онлайн" action opens the in-page release side window inside
        // ultradox_full instead, so no ultradox_torrents component any more.

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

    // Soft scroll (user request 2026-11-04: "м'ягший скролінг, як в нативній
    // Lampa"). The native feel is fixed ~150px steps animated by the core
    // 0.3s transform transition (scroll.wheel). Our focus targets can sit far
    // apart, so a single scroll.update(el) teleports the whole distance in one
    // fast hop. This glides toward the element in native-sized steps instead:
    // each tick asks the core for one step (it animates as usual), the ticks
    // overlap the 0.3s transition into one continuous glide. The target is
    // computed with the core's own formula (bodyTop - elTop, clamped to 0).
    var SOFT_STEP = 150;
    var SOFT_TICK = 110;
    function softTo(scroll, el) {
        if (!scroll || !el || typeof scroll.position !== 'function' || typeof scroll.wheel !== 'function') return;
        var body = (typeof scroll.body === 'function') ? scroll.body(true) : null;
        if (!body || typeof body.getBoundingClientRect !== 'function') { if (scroll.update) scroll.update(el); return; }
        var brect = body.getBoundingClientRect();
        var erect = el.getBoundingClientRect();
        // An element already fully inside the scroll viewport must not
        // trigger any scroll: aligning it to the viewport top would push the
        // page above the top edge and crop what sits above it (on the detail
        // page the initial focus on an action button scrolled the page down
        // until the poster top was cut off - only an UP press corrected it;
        // user feedback 2026-11-04). Unmeasured rects (height 0 - the test
        // mock) keep the legacy align-to-top behaviour.
        var view = (typeof scroll.render === 'function') ? scroll.render(true) : null;
        var vrect = (view && view.getBoundingClientRect) ? view.getBoundingClientRect() : null;
        if (vrect && erect.height > 0 && vrect.height > 0 &&
            erect.top >= vrect.top && erect.bottom <= vrect.bottom) return;
        var target = Math.min(0, brect.top - erect.top);
        var token = (scroll._udxSoft || 0) + 1;
        scroll._udxSoft = token;
        function tick() {
            if (scroll._udxSoft !== token) return;
            var cur = scroll.position();
            var delta = target - cur;
            if (!delta) return;
            var step = Math.abs(delta) < SOFT_STEP ? Math.abs(delta) : SOFT_STEP;
            scroll.wheel(delta > 0 ? -step : step);
            if (Math.abs(target - scroll.position()) > 0.5) setTimeout(tick, SOFT_TICK);
        }
        tick();
    }

    // Month name (ru/uk, any case or declension) -> 1..12, matched on the
    // first three characters ("Окт", "октября", "жовтня" all resolve).
    function monthNum(name) {
        var n = String(name || '').toLowerCase().substring(0, 3);
        var map = { янв: 1, фев: 2, мар: 3, апр: 4, май: 5, мая: 5, іюн: 6, июн: 6, іюл: 7, июл: 7, авг: 8, сен: 9, окт: 10, жов: 10, ноя: 11, лис: 11, гру: 12, груд: 12, дек: 12 };
        return map[n] || 0;
    }

    // Real site data only: the page's own "Год:" field as a bare year plus the
    // newest upload date (latest "Загрузил: USER (dd Mon yyyy)") across the
    // page's releases, as 'dd.mm'. Both '' when the page carries nothing
    // readable - never fabricated.
    function siteDates(html) {
        var h = String(html || '');
        var y = '';
        var my = h.match(/<span>Год:<\/span>\s*([^<]+)/i);
        if (my) y = (strip(my[1]).match(/\b(19|20)\d{2}\b/) || [])[0] || '';
        var rel = parseReleases(h);
        var yy = 0, mo = 0, d = 0, i, m, mm;
        // newest date wins (year, then month, then day)
        for (i = 0; i < rel.length; i++) {
            m = String(rel[i].date || '').match(/^(\d{1,2})\s+(\S+)\s+(\d{4})/);
            if (!m) continue;
            mm = monthNum(m[2]);
            if (!mm) continue;
            var yv = +m[3];
            if (yv > yy || (yv === yy && mm > mo) || (yv === yy && mm === mo && +m[1] > d)) {
                yy = yv; mo = mm; d = +m[1];
            }
        }
        function p2(n) { return (n < 10 ? '0' : '') + n; }
        return { y: y, a: yy ? p2(d) + '.' + p2(mo) : '' };
    }

    // Paint the under-title line from the item's own site data (the bare year,
    // "year • dd.mm", or the date alone) onto the item's rendered card. FILL
    // ONLY: a card that already carries a line (a movie's rendered year, a
    // fallback row's type/size meta) is left untouched - appendCard removed
    // the element entirely for a year-less serial, so a missing element is
    // exactly the case this fills. Idempotent: once the line exists the call
    // is a no-op, so the background piggyback and a later focus never
    // duplicate it.
    function paintItemYear(item) {
        var card = item._card;
        if (!card || (!item.year && !item.added)) return;
        if (card.find('.card__age')) return;
        var age = document.createElement('div');
        age.addClass('card__age');
        if (item.year) {
            var ye = document.createElement('span');
            ye.text(item.year);
            age.append(ye);
        }
        if (item.added) {
            var de = document.createElement('span');
            de.addClass('udx-ad');
            de.text((item.year ? ' \u2022 ' : '') + item.added);
            age.append(de);
        }
        card.append(age);
    }

    // The standard Lampa torrent flow (the single handoff, pick-gated): the
    // picked release's MagnetUri/Size go to L.Torrent.start with the item's
    // movie metadata. Called ONLY from explicit row picks (panel rows and the
    // legacy online page rows).
    function startTorrServer(r, item, movie) {
        var L = window.Lampa;
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
        L.Torrent.start(o, movie);
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

    // Render-first country filter: the items are ALREADY painted by the time
    // this runs (user report 2026-11-05: the section page sat on the loader a
    // long time because every open gated the first paint on up to PAGE detail
    // fetches). Each lookup resolves independently; done(kept, dropped) fires
    // once all lookups settle so the caller prunes the "Россия" cards from
    // the grid (a failed lookup keeps its item - the filter must never empty
    // the feed on network failure).
    function filterRussianProductions(items, done) {
        if (!HIDE_RUSSIAN_PRODUCTIONS || !items.length) { done(items, []); return; }
        var remaining = items.length;
        var kept = new Array(items.length);
        var dropped = [];
        var next = 0;
        var inFlight = 0;
        var MAX_COUNTRY_REQUESTS = 4;
        function complete(index, russian) {
            if (!russian) kept[index] = items[index];
            else dropped.push(items[index]);
            remaining--;
            inFlight--;
            if (!remaining) { done(kept.filter(function (item) { return !!item; }), dropped); return; }
            launch();
        }
        // The cache value is { r: russian, y: release year, a: 'dd.mm' }: the
        // same detail-page fetch that decides the country filter also carries
        // the site's own release year + newest upload date, which year-less
        // items (serials) need for the card line - no extra request, and a
        // cached second visit gets the same dates without re-fetching. The
        // card was already painted without that line (render-first), so once
        // the lookup settles the line is filled in on the rendered card -
        // the serial card shows its dates without any focus (paintItemYear
        // is fill-only and idempotent).
        function check(item, index) {
            if (!item.itemUrl) { complete(index, false); return; }
            if (Object.prototype.hasOwnProperty.call(countryCache, item.itemUrl)) {
                var cc = countryCache[item.itemUrl];
                if (cc.y && !item.year) item.year = cc.y;
                if (cc.a) item.added = cc.a;
                paintItemYear(item);
                complete(index, cc.r);
                return;
            }
            fetchText(item.itemUrl, function (html) {
                var russian = /(?:россия|russia)/i.test(countryFromDetail(html));
                var sd = siteDates(html);
                countryCache[item.itemUrl] = { r: russian, y: sd.y, a: sd.a };
                if (sd.y && !item.year) item.year = sd.y;
                if (sd.a) item.added = sd.a;
                paintItemYear(item);
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
        var bgLayers = [null, null], bgFront = 0, bgShown = '', bgPending = '';
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
                // Real scroll viewport: the core frameUpdate (fired by the
                // Layer.update below and on every resize) sets an explicit
                // height (innerHeight - head - navi) on layer--wheight elements.
                // Without a bounded box the TV scroll driver clamps travel to
                // the element's offsetHeight - an unbounded element can never
                // scroll, and the second row stays cut off at the screen edge.
                var scEl = scroll.render(true);
                scEl.addClass('layer--wheight');
                html.find('.udx-content__list').append(scEl);

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
                b.on('hover:focus', function () {
                    // Focus leaving the grid upward lands on a category
                    // button: glide the grid back to the top so the page sits
                    // at the categories again (core lists keep their top
                    // visible while the header row holds focus). Without this
                    // the grid stayed scrolled down under the focused button
                    // (user report 2026-11-04: "сторінка з постерами не
                    // піднімається знову на категорію").
                    if (scroll && grid && grid.children[0]) scroll.update(grid.children[0], false);
                });
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
            // Category switch: both ambience layers back to off until the next
            // card focus hands over a poster (a stale category's image must
            // not sit behind the new feed).
            if (bgLayers[0]) bgLayers[0].removeClass('udx-bg--on');
            if (bgLayers[1]) bgLayers[1].removeClass('udx-bg--on');
            bgFront = 0;
            bgShown = '';
            bgPending = '';
            if (this.activity) this.activity.toggle();
            this.fill();
        };

        // The catalog ambience (NUM-style): the focused card's own poster,
        // blurred + darkened by the .udx-bg CSS, crossfaded behind the grid.
        // Two permanent layers swap an opacity class; the OFF state is
        // opacity:0 only. A single preload gate per new URL keeps a dead image
        // from erasing the current backdrop (the site does serve removed
        // uploads) and coalesces fast D-pad moves - a superseded load never
        // lands. Plain display load: no crossOrigin, so it works with web
        // security fully on (the core .background canvas cannot show these
        // posters - see the STYLE_HTML header). No cache of its own: the
        // host serves max-age=10y, the browser cache does the rest.
        function focusBackdrop(url) {
            if (!url || !bgLayers[0] || !bgLayers[1]) return;
            if (url === bgShown || url === bgPending) return;
            var target = bgLayers[1 - bgFront];
            var other = bgLayers[bgFront];
            bgPending = url;
            var img = new Image();
            img.onload = function () {
                if (bgPending !== url) return;
                bgPending = '';
                target.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
                target.addClass('udx-bg--on');
                other.removeClass('udx-bg--on');
                bgFront = 1 - bgFront;
                bgShown = url;
            };
            img.onerror = function () {
                if (bgPending === url) bgPending = '';
            };
            img.src = url;
        }

        // Append every loaded-but-not-yet-shown item, then top up with more server
        // pages until the first screen is filled. Scrolling further (scroll.onEnd)
        // keeps loading page by page.
        this.fill = function () {
            var self = this;
            while (rendered < items.length) self.appendCard(items[rendered++]);
            if (scroll) L.Layer.visible(scroll.render(true));
            if (items.length < PAGE) self.loadMore();
        };

        // Fetch one more server page, dedup by itemUrl and append the new
        // items (rendered immediately - the country filter prunes the
        // "Россия" cards in the background once the lookups settle).
        // Guards: single in-flight fetch, hard page cap, and a stop after two
        // consecutive pages that add nothing new.
        this.loadMore = function () {
            if (fetching) return;
            if (serverPage > MAX_PAGE || consecutiveEmpty >= 2) {
                if (!items.length) this.showEmpty();
                return;
            }
            var self = this, token = loadToken, pg = serverPage;
            fetching = true;
            // Never hide an already-painted catalog: the fullscreen activity
            // loader (.activity--load -> .activity__body opacity:0) is for the
            // first page only (empty grid). An incremental top-up over a
            // non-empty grid must keep every loaded card visible while the
            // next page fetches in the background (the core feed appends the
            // same way without hiding the list - Next$1.onLoadNext); the old
            // unconditional loader(true) blanked the whole feed for the whole
            // fetch on every bottom-edge DOWN (user report 2026-11-06:
            // "scrolling 1-2 rows the UI vanishes, only the spinner remains").
            if (this.activity && !items.length) this.activity.loader(true);
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
                // Paint first: the page appears as soon as its list data
                // arrives (the core feed behaves exactly this way). The
                // country lookups run in the background instead - gating the
                // first render on up to PAGE slow detail round trips is what
                // made a section sit on the loader for a long time (user
                // report 2026-11-05). Items that resolve as "Россия" are
                // pruned from the grid as they settle; a failed lookup keeps
                // its item (fail-safe, unchanged).
                consecutiveEmpty = 0;
                for (var f = 0; f < fresh.length; f++) items.push(fresh[f]);
                fetching = false;
                if (self.activity) self.activity.loader(false);
                self.fill();
                filterRussianProductions(fresh, function (kept, dropped) {
                    if (token !== loadToken) return;
                    for (var d = 0; d < dropped.length; d++) self.pruneItem(dropped[d]);
                    if (!dropped.length) return;
                    if (kept.length) consecutiveEmpty = 0;
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

        // Serials: the list carries no release year (titles end in "(N сезон)").
        // The line under the title gets the site's own "Год:" field plus the
        // newest catalog-addition date (year, then the dimmed "• dd.mm"; the
        // date alone when the page carries no readable year) through two
        // paths:
        //   - the background country check piggybacks both values on its
        //     detail fetch and fills the line on the rendered card as it
        //     settles - no focus needed (paintItemYear, fill-only);
        //   - a focus on a card that still has no data fetches the item page
        //     ONCE and paints the line, replacing any placeholder line (the
        //     fallback row's type/size meta) with the real page data.
        // Best-effort and silent: a failed fetch leaves the card as-is; once
        // the data is present a refocus never refetches and never duplicates
        // the line.
        this.enrichYear = function (item, card) {
            if (item.year || item.added) { paintItemYear(item); return; }
            if (item._yBusy || !item.itemUrl) return;
            item._yBusy = 1;
            fetchText(item.itemUrl, function (html) {
                var sd = siteDates(html);
                if (!sd.y && !sd.a) { item._yBusy = 0; return; }
                if (sd.y) item.year = sd.y;
                if (sd.a) item.added = sd.a;
                var old = card.find('.card__age');
                if (old) old.remove();
                paintItemYear(item);
            }, function () { item._yBusy = 0; });
        };

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
            // the card geometry stable. Year-less items (serials) get their
            // year + the newest upload date from the site's own page data
            // (the country-check fetch piggybacked both - real data only,
            // shown as soon as the card appears, no focus needed).
            var meta = [];
            if (item.type && !item.poster) meta.push(item.type);
            if (item.size) meta.push(item.size);
            var ageLine = card.find('.card__age');
            if (ageLine) {
                if (meta.length) ageLine.text(meta.join(' • '));
                else if (year) {
                    if (item.added) {
                        var ad = document.createElement('span');
                        ad.addClass('udx-ad');
                        ad.text(' \u2022 ' + item.added);
                        ageLine.append(ad);
                    }
                } else if (item.added) ageLine.text(item.added);
                else ageLine.remove();
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
                // The core's own focus glide, 1:1 the core items module
                // (app.min.js Items$2 onAppend): scroll.update(item,
                // align_left ? false : true) with the core default
                // align_left:false -> tocenter TRUE - the focused row is
                // CENTERED in the viewport, and the reposition runs on the way
                // UP too, so every D-pad step glides and the row above the
                // focus always stays on screen (the spatial Navigator then
                // walks row by row instead of skipping off-screen rows). The
                // old top-align (update(card, false)) pinned the row to the
                // viewport top: the previous row left the screen and an UP
                // press jumped straight to the category tabs with the grid
                // left scrolled down - "сторінка не піднімається знову на
                // категорію" (user report 2026-11-04). startScroll no-ops when
                // the position is unchanged, so a plain call is safe.
                if (scroll) {
                    if (scroll.update) scroll.update(card, true);
                    else softTo(scroll, card);
                }
                // Ambience: the focused card's own poster crossfades behind
                // the grid (focusBackdrop - NUM-style blurred backdrop). A
                // poster-less item keeps the current backdrop untouched.
                focusBackdrop(item.poster);
                self.enrichYear(item, card);
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
                if (L.Controller.collectionAppend) L.Controller.collectionAppend(card);
            });

            if (!last) last = card;
            // Unconditional registration (Navigator.add dedupes, so the
            // re-register from 'visible' is a no-op): the earlier own()-gated
            // append raced the loader window - while activity.loader(true) is
            // up the active controller is not ours and a whole card batch
            // could stay OUT of the navigation collection. The spatial
            // Navigator then skips the unregistered rows: from a deep row a
            // single UP press jumped straight to the category tabs (user
            // report 2026-11-04: "з 5-6 ряду перекидує зразу на кнопку
            // категорії").
            if (L.Controller.collectionAppend) L.Controller.collectionAppend(card);
            item._card = card;
            grid.append(card);
        };

        // Render-first filter: drop one card from the grid when its country
        // lookup resolves as a Russian production (the items are painted
        // before the lookups settle). Splices the item, removes its card, and
        // hands a lost focus to the neighbouring card so the spatial Navigator
        // always has a target.
        this.pruneItem = function (item) {
            var idx = -1, i;
            for (i = 0; i < items.length; i++) if (items[i] === item) { idx = i; break; }
            if (idx === -1) return;
            var cardEl = item._card;
            var alt = null;
            if (cardEl === last) {
                // The grid carries only cards (showEmpty appends its marker
                // only to an empty grid), so the direct siblings are cards.
                alt = (cardEl.nextElementSibling || cardEl.previousElementSibling) || null;
            }
            if (cardEl && typeof cardEl.remove === 'function') cardEl.remove();
            if (idx < rendered) rendered--;
            items.splice(idx, 1);
            if (cardEl === last) {
                last = alt;
                if (last) {
                    if (L.Controller.collectionAppend) L.Controller.collectionAppend(last);
                    try { if (typeof Navigator !== 'undefined' && Navigator.focus) Navigator.focus(last); } catch (e) {}
                }
            }
        };

        this.start = function () {
            if (L.Activity.active() && L.Activity.active().activity !== this.activity) return;
            var self = this;

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
                // Up from the top row goes to the category tab (core
                // behaviour); with the core top bar visible again (user
                // request 2026-11-05) a further up takes the focus into the
                // head via the core spatial Navigator.
                up: function () {
                    var dest = NavCanMove('up');
                    if (!dest) return;
                    // Safety net for a registration gap: if the spatial
                    // Navigator would leave the grid for a category tab while
                    // a grid row still sits above the focus, step to that row
                    // instead (registering it first - Navigator.focus refuses
                    // elements outside the collection). From the top row the
                    // tab stays the correct UP target (core behaviour).
                    if (dest.classList && dest.classList.contains('udx-cat') && grid && grid.children.length > 5) {
                        var kids = grid.children;
                        var cur = (typeof Navigator !== 'undefined' && Navigator.getFocusedElement) ? Navigator.getFocusedElement() : null;
                        var idx = cur ? Array.prototype.indexOf.call(kids, cur) : -1;
                        if (idx >= 5) {
                            var above = kids[idx - 5];
                            if (above) {
                                if (L.Controller.collectionAppend) L.Controller.collectionAppend(above);
                                if (typeof Navigator !== 'undefined' && Navigator.focus) Navigator.focus(above);
                                return;
                            }
                        }
                    }
                    NavMove('up');
                },
                // Bottom edge of the rendered feed: the Navigator has no
                // where to go - that IS the load-more trigger. The core
                // Scroll onEnd (the only other trigger) fires from webview
                // scroll events/transitions, which the TV remote flow does
                // not reliably produce, so the feed stopped at the first
                // top-up batch (the site serves 16 cards/page, the top-up
                // stops at PAGE=20 -> 16+16 = 32 cards = 6 rows - user
                // report 2026-11-05 "6 рядів в категорії, далі не
                // опускається"). loadMore is self-guarded (single in-flight
                // fetch, page cap, two consecutive empty pages), so repeat
                // presses are no-ops while a page is in flight.
                down: function () {
                    if (NavCanMove('down')) NavMove('down');
                    else self.loadMore();
                },
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

    // Detail page (catalog -> OK): the NUM reference layout 1:1 -
    // the core .background canvas shows only the film's own fanart (without
    // one, the non-pixhost poster art doubles as the ambience image; the core
    // canvas owns the blur + darkening, no plugin layers), a
    // large poster on the left, the meta block on the right (country • year,
    // large title, original title, rating badge, runtime • genre line,
    // seasons) with the two MODS-style action pills below it, and the
    // full-width "Детально" details strip (complete overview, director, full
    // cast - nothing clamped or truncated) inside a scroll viewport, with
    // exactly two actions:
    //   left  "Онлайн"    -> opens the in-page release SIDE WINDOW (user
    //                        request 2026-11-04, replaces the old dedicated
    //                        full release page): a right-hand panel over this
    //                        page listing the item's real releases (quality •
    //                        size rows, the site's own upload date); the
    //                        standard Lampa torrent flow runs only after an
    //                        explicit row pick in the panel; BACK or a left
    //                        move closes the window and refocuses the strip;
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
        var scroll = null;
        // Release side window state (the "Онлайн" target).
        var panelEl = null, panelScroll = null, panelBox = null;
        var panelOpen = false;
        var firstPanelRow = null, lastPanelRow = null;
        var lastActBefore = null;
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
                // Scroll viewport inside the slot: the zone + details strip
                // are one content node (the page grows when the overview or
                // the cast is long - no text is ever clamped).
                var content = document.createElement('div');
                content.addClass('udxf__content');
                content.append($(ZONE_HTML));
                scroll = new Lampa.Scroll({ mask: true, over: true });
                scroll.append(content);
                html.find('.udxf__slot').append(scroll.render(true));
                onlineBtn = html.find('.udxf__act--online');
                torrentsBtn = html.find('.udxf__act--torrents');
                // The release side window: the row list inside its own
                // height-bounded scroll viewport (the TV driver clamps travel
                // to the scroll element's offsetHeight).
                panelEl = html.find('.udxf__panel');
                if (panelEl) {
                    panelBox = document.createElement('div');
                    panelBox.addClass('udxf__prows');
                    panelScroll = new Lampa.Scroll({ mask: true, over: true });
                    panelScroll.append(panelBox);
                    html.find('.udxf__panel__list').append(panelScroll.render(true));
                }
                // Left action: opens the release side window (in-page).
                // Right action: opens the core torrents search page.
                // hover:focus remembers the last touched action so the page
                // refocuses exactly there (start() falls back to the online
                // button while nothing has been focused yet) and keeps it
                // visible inside the scroll viewport; a focus landing on a
                // pill while the window is open (a left/up move from it)
                // closes the window without stealing the focus back.
                var self = this;
                if (onlineBtn) {
                    onlineBtn.find('.udxf__olab').text(L.Lang.translate('ultradox_online'));
                    onlineBtn.on('hover:focus', function () { lastAct = onlineBtn; if (panelOpen) hidePanel(); if (scroll) softTo(scroll, onlineBtn); });
                    onlineBtn.on('hover:enter', function () { self.openReleaseList(); });
                }
                if (torrentsBtn) {
                    torrentsBtn.find('.udxf__tlab').text(L.Lang.translate('ultradox_torrserver'));
                    torrentsBtn.on('hover:focus', function () { lastAct = torrentsBtn; if (panelOpen) hidePanel(); if (scroll) softTo(scroll, torrentsBtn); });
                    torrentsBtn.on('hover:enter', function () { self.openTorrents(); });
                }
                // Down-navigation target: the details strip is a focus element,
                // so pressing down from the action pills scrolls the page to
                // reveal the overview / director / cast (the core has no
                // global focus-scroll hook - each element wires its own).
                // The glide is soft (native-style ~150px steps, softTo).
                var detailsEl = html.find('.udxf__details');
                if (detailsEl) {
                    detailsEl.on('hover:focus', function () { if (scroll) softTo(scroll, detailsEl); });
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

            // Ambience: the film's own fanart (validated by validBackdrop in
            // parseDetail - the pixhost "Picture removed" placeholder is
            // rejected there) or the poster fallback (the pixhost guard above)
            // as the blurred backdrop layer; the opaque root stays the neutral
            // surface when nothing is usable.
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

            // NUM reference order: year first, then a comma, then the country
            // ("2026, США"); whichever of the two is present stands alone.
            var top = [];
            if (d.year) top.push(d.year);
            if (d.country) top.push(d.country);
            slotShow('.udxf__top', top.length ? top.join(', ') : '');

            var line = [];
            if (d.genre) line.push(d.genre);
            if (d.runtime) line.push(d.runtime);
            if (d.translation) line.push(d.translation);
            slotShow('.udxf__line', line.length ? line.join(' • ') : '');

            // Director + cast lines in the meta column (above the action
            // pills - user request 2026-11-05) and the "Детально" heading of
            // the details strip (always visible, NUM reference) with the
            // complete overview (no line clamp).
            slotShow('.udxf__details-head', L.Lang.translate('ultradox_details'));
            slotShow('.udxf__overview', d.overview || '');
            slotShow('.udxf__fact--director', d.director ? L.Lang.translate('ultradox_director') + ': ' + d.director : '');

            // Full cast list: every name the page carries, wrapped - no name
            // cap and no ellipsis truncation.
            var castNames = d.cast ? String(d.cast).split(',').map(function (n) { return n.replace(/\s+/g, ' ').trim(); }).filter(function (n) { return n; }) : [];
            var castShown = castNames.join(', ');
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

        // Left action "Онлайн": opens the release side window over this page
        // (no dedicated full page any more): the item's real releases as
        // quality • size rows with the site's own upload date. Focus moves to
        // the first row; BACK or a left/up move back to a pill closes it. The
        // standard Lampa torrent flow runs only after an explicit row pick.
        this.openReleaseList = function () {
            if (!panelEl) return;
            this.fillPanelRows();
            panelOpen = true;
            lastActBefore = lastAct || onlineBtn;
            panelEl.addClass('udxf__panel--open');
            L.Controller.collectionSet(html);
            L.Controller.collectionFocus(firstPanelRow || panelEl, html);
        };

        // Hide the window (a left/up focus move onto a pill uses this: the
        // Navigator already owns the focus, so no refocus here).
        function hidePanel() {
            if (!panelOpen) return;
            panelOpen = false;
            if (panelEl) panelEl.removeClass('udxf__panel--open');
        }

        // BACK with the window open closes it and refocuses the action the
        // user came from; with it closed, BACK leaves the page (to the
        // catalog on the same card).
        this.closePanel = function () {
            if (!panelOpen) return;
            panelOpen = false;
            if (panelEl) panelEl.removeClass('udxf__panel--open');
            L.Controller.collectionSet(html);
            L.Controller.collectionFocus(lastActBefore || onlineBtn, html);
        };

        // Fill the window rows from the detail payload (memory only - the
        // detail page already fetched it): "quality • size" on the main line,
        // the site's own upload date on the second, the raw release as the
        // inert pick payload.
        this.fillPanelRows = function () {
            if (!panelBox) return;
            panelBox.empty();
            firstPanelRow = null;
            lastPanelRow = null;
            var data = releaseRows(detail);
            if (!data.length) {
                var em = document.createElement('div');
                em.addClass('udx-empty');
                em.text(L.Lang.translate('ultradox_no_link'));
                panelBox.append(em);
                if (panelScroll) L.Layer.visible(panelScroll.render(true));
                return;
            }
            for (var i = 0; i < data.length; i++) this.appendPanelRow(data[i]);
            if (panelScroll) L.Layer.visible(panelScroll.render(true));
        };

        this.appendPanelRow = function (row) {
            var el = document.createElement('div');
            el.addClass('simple-button selector udxf__prow');
            var main = document.createElement('div');
            main.addClass('udxf__prow__main');
            main.text(row.main);
            el.append(main);
            if (row.sub) {
                var sub = document.createElement('div');
                sub.addClass('udxf__prow__sub');
                sub.text(row.sub);
                el.append(sub);
            }
            var self = this;
            el.on('hover:focus', function () {
                lastPanelRow = el;
                if (panelScroll) softTo(panelScroll, el);
            });
            // Explicit row pick only: the standard Lampa torrent flow with the
            // picked release's payload (never by button press or navigation).
            el.on('hover:enter', function () {
                if (!row.release || !row.release.magnet) { L.Noty.show(L.Lang.translate('ultradox_no_link')); return; }
                var movie = {
                    title: item.title,
                    original_title: item.title,
                    img: item.poster || '',
                    number_of_seasons: item.serial ? (tmdbSeasons || 1) : undefined
                };
                startTorrServer(row.release, item, movie);
            });
            if (!firstPanelRow) firstPanelRow = el;
            lastPanelRow = el;
            if (L.Controller.own && L.Controller.own(self)) L.Controller.collectionAppend(el);
            panelBox.append(el);
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
            // Rating badge in the NUM reference format: value + source mark
            // ("8.1 TMDB"), no word prefix.
            if (typeof d.vote_average === 'number' && d.vote_average > 0) {
                slotShow('.udxf__rate', (Math.round(d.vote_average * 10) / 10).toFixed(1) + ' TMDB');
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

            var self = this;
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
                // The core Navigator is spatial only: when focus has nowhere
                // to go the page drives its own scroll in native-sized 150px
                // wheel steps (the core list-page feel), clamped at the edges.
                // An open release window scrolls its own list, never the page
                // behind; at the very top the core may take the focus into the
                // head (normal core behaviour, the top bar is visible here).
                up: function () {
                    if (NavCanMove('up')) NavMove('up');
                    else if (panelOpen && panelScroll && panelScroll.position() < 0) panelScroll.wheel(-SOFT_STEP);
                    else if (scroll && scroll.position() < 0) scroll.wheel(-SOFT_STEP);
                },
                down: function () {
                    if (NavCanMove('down')) NavMove('down');
                    else if (panelOpen && panelScroll) panelScroll.wheel(SOFT_STEP);
                    else if (scroll) scroll.wheel(SOFT_STEP);
                },
                // BACK with the release window open closes it (focus returns
                // to the action strip); only a closed window leaves the page.
                back: function () {
                    if (panelOpen) self.closePanel();
                    else L.Activity.backward();
                }
            });

            L.Controller.toggle('content');
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            if (scroll) scroll.destroy();
            if (panelScroll) panelScroll.destroy();
            html.remove();
            built = false;
            scroll = null;
            onlineBtn = null; torrentsBtn = null; udxRoot = null;
            lastAct = null;
            tmdbSeasons = 0;
            enrichToken++;
            panelEl = null; panelScroll = null; panelBox = null;
            panelOpen = false;
            firstPanelRow = null; lastPanelRow = null;
            lastActBefore = null;
        };
    }

    // Dedicated full-page list screen (NUM-style: the item's info card on the
    // left, the item's real rows on the right). Only the online variant is
    // registered any more (the release-list page was replaced by the in-page
    // release side window inside ultradox_full, user request 2026-11-04); the
    // online page stays available from its own payload (no longer a strip
    // route). It never starts anything by itself:
    //   ultradox_online -> the item's real online embeds, probed read-only
    //                      from its detail page (or a clear empty state when
    //                      the page has none); the standard Lampa player call
    //                      (Lampa.Player.play) runs only from an explicit row
    //                      pick, which is probed read-only first so a dead
    //                      embed shows a message instead of a black screen.
    // Back returns to the page it was opened from.
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

            var posterBackdrop = '';
            var pstr = item.poster ? String(item.poster) : '';
            if (/^https?:\/\//i.test(pstr)) {
                var phost = pstr.match(/^https?:\/\/([^\/?#]+)/i);
                if (!(phost && /(^|\.)pixhost\.cc$/i.test(phost[1]))) posterBackdrop = pstr;
            }
            // Ambience: the same blurred backdrop the detail page uses -
            // fanart first, the non-pixhost poster as fallback; the opaque
            // root stays the neutral surface when nothing is usable.
            var bg = html.find('.udxl__backdrop');
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

            // Online rows carry the item's quality token as the right cell
            // (NUM-style quality marker): the site lists its embeds without
            // per-embed labels, so the page-level quality is the honest one.
            var qTok = mode === 'online' ? releaseQuality((detail && detail.quality) || '') : '';
            var data = mode === 'online'
                ? rows.map(function (u, i) {
                    var host = (u.match(/^https?:\/\/([^\/?#]+)/i) || [])[1] || '';
                    var t = L.Lang.translate('ultradox_online');
                    if (rows.length > 1) t += ' ' + (i + 1);
                    return { main: t, sub: host, q: qTok, data: u };
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
            var body = document.createElement('div');
            body.addClass('udxl__row__body');
            var main = document.createElement('div');
            main.addClass('udxl__row__main');
            main.text(row.main);
            body.append(main);
            if (row.sub) {
                var sub = document.createElement('div');
                sub.addClass('udxl__row__sub');
                sub.text(row.sub);
                body.append(sub);
            }
            el.append(body);
            if (row.q) {
                var q = document.createElement('div');
                q.addClass('udxl__row__q');
                q.text(row.q);
                el.append(q);
            }

            var self = this;
            el.on('hover:focus', function () {
                lastRow = el;
                if (scroll) softTo(scroll, el);
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

        // Explicit row pick only: delegates to the single shared handoff
        // (the top-level startTorrServer - one L.Torrent.start call site).
        this.startTorrServer = function (r) {
            var movie = {
                title: item.title,
                original_title: item.title,
                img: item.poster || '',
                number_of_seasons: item.serial ? (object.seasons || 1) : undefined
            };
            startTorrServer(r, item, movie);
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
