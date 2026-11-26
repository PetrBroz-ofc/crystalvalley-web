// Souhlas s cookies a externími službami (§ 89 odst. 3 zákona č. 127/2005 Sb., GDPR).
// Nic, co není nezbytné, se nenačte, dokud návštěvník výslovně nesouhlasí:
//  - analytické: Google Analytics 4,
//  - externí služby: mapa Google a překladač Google Translate.
// Písma jsou na vlastním serveru, takže se kvůli nim nikam nic nepřenáší.
// Lišta nabízí "Odmítnout vše" stejně snadno jako "Přijmout vše", nic není předem zaškrtnuté a volbu jde kdykoli
// změnit odkazem "Nastavení cookies" v patičce.
// Až se změní účely nebo nástroje, zvýšit VERSION a upravit cookies.html.
(function () {
  'use strict';
  var KEY = 'cv-consent';
  var VERSION = 2; // zvýšením se lidé zeptají znovu
  var GA_ID = 'G-W0J0EKJJ24';
  var MAX_AGE_DAYS = 365;
  var memory = null; // když prohlížeč nedovolí ukládání, platí volba do zavření stránky

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var s = raw ? JSON.parse(raw) : memory;
      if (!s || s.v !== VERSION) return null;
      if (Date.now() - new Date(s.at).getTime() > MAX_AGE_DAYS * 864e5) return null;
      return { v: s.v, at: s.at, analytics: !!s.analytics, external: !!s.external };
    } catch (e) { return memory; }
  }

  function clearCookies(re) {
    var host = location.hostname;
    var domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); })
      .filter(function (n) { return re.test(n); })
      .forEach(function (n) {
        domains.forEach(function (d) { document.cookie = n + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : ''); });
      });
  }

  // ───────────── Google Analytics 4 ─────────────
  // Značka od Googlu se do stránky nevkládá natvrdo: skript se stáhne až po souhlasu s analytickými cookies.
  var gaLoaded = false;

  function startAnalytics() {
    if (gaLoaded) return;
    gaLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); }; // gtag.js čte objekt arguments, ne pole
    // reklamní účely web nepoužívá, proto zůstávají zakázané
    window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.gtag('js', new Date());
    window.gtag('config', GA_ID, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
  }

  // kliknutí na kontakty a odkazy ven (jen když analytika běží, tedy se souhlasem)
  function trackClick(e) {
    if (!gaLoaded) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var href = a.getAttribute('href') || '';
    var name = /^tel:/.test(href) ? 'klik_telefon'
      : /^mailto:/.test(href) ? 'klik_email'
      : /(maps\.google\.|google\.[a-z.]+\/maps)/.test(href) ? 'klik_mapa'
      : /facebook\.com/.test(href) ? 'klik_facebook'
      : /kocicibydleni\.cz/.test(href) ? 'klik_eshop'
      : null;
    if (!name) return;
    var where = a.closest('section[id], header, nav, footer');
    window.gtag('event', name, { umisteni: where ? (where.id || where.tagName.toLowerCase()) : 'web' });
  }
  document.addEventListener('click', trackClick, true);

  function emit(c) {
    window.dispatchEvent(new CustomEvent('cv-consent', { detail: { external: !!(c && c.external) } }));
  }

  // Mapa a další vložený obsah: v HTML leží v <template>, a tím se nenačítá, dokud nejde souhlas
  function activateEmbeds() {
    document.querySelectorAll('[data-consent-embed]').forEach(function (el) {
      var tpl = el.querySelector('template');
      if (!tpl) return;
      el.removeAttribute('data-consent-embed');
      el.classList.remove('embed-gate');
      el.textContent = '';
      el.appendChild(tpl.content.cloneNode(true));
    });
  }

  function save(choice) {
    var prev = read();
    var s = { v: VERSION, at: new Date().toISOString(), analytics: !!choice.analytics, external: !!choice.external };
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* nevadí */ }
    var droppedAnalytics = gaLoaded && !s.analytics;
    var droppedExternal = !!(prev && prev.external && !s.external);
    if (droppedAnalytics || droppedExternal) {
      // odvolání souhlasu: smazat cookies nástrojů a načíst stránku znovu, aby žádná cizí služba neběžela dál
      if (droppedAnalytics) {
        window['ga-disable-' + GA_ID] = true; // ať Analytics při zavírání stránky nezapíše cookies znovu
        clearCookies(/^_ga(_|$)/);
      }
      if (droppedExternal) {
        clearCookies(/^googtrans$/);
        try { localStorage.removeItem('cv_lang'); } catch (e) { /* nevadí */ }
      }
      location.reload();
      return;
    }
    if (s.analytics) startAnalytics();
    if (s.external) activateEmbeds();
    emit(s);
    close();
  }

  // ───────────── lišta ─────────────
  var root = null, box = null, detailOpen = false, pick = { analytics: false, external: false }, built = false;

  var PAW = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="5.4" cy="10.6" rx="2" ry="2.5"/><ellipse cx="9.3" cy="5.9" rx="2" ry="2.6"/>' +
    '<ellipse cx="14.7" cy="5.9" rx="2" ry="2.6"/><ellipse cx="18.6" cy="10.6" rx="2" ry="2.5"/>' +
    '<path d="M12 11.4c-3 0-6 3.9-6 6.6 0 1.6 1.2 2.5 2.7 2.5 1.2 0 2.1-.7 3.3-.7s2.1.7 3.3.7c1.5 0 2.7-.9 2.7-2.5 0-2.7-3-6.6-6-6.6z"/></svg>';

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (html) n.innerHTML = html;
    return n;
  }

  function build() {
    if (built) return;
    built = true;
    root = el('div', { 'class': 'cc', hidden: '' });
    box = el('div', { 'class': 'cc-box', tabindex: '-1', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'cc-title' });
    root.appendChild(box);
    document.body.appendChild(root);
    box.addEventListener('click', onBoxClick);
  }

  function item(id, title, text, checked, key) {
    return '<li class="cc-item"><label for="' + id + '"><strong>' + title + '</strong><span>' + text + '</span></label>' +
      '<button type="button" class="cc-switch" id="' + id + '" role="switch" aria-checked="' + checked + '" ' +
      (key ? 'data-cc="toggle" data-key="' + key + '"' : 'disabled') + '></button></li>';
  }

  function render() {
    var h = '<div class="cc-head"><span class="cc-paw">' + PAW + '</span><h2 class="cc-title" id="cc-title">Cookies na našem webu</h2></div>' +
      '<p class="cc-text">Rádi bychom věděli, jak web používáte. K tomu slouží Google Analytics. Mapu a překladač od Googlu také zapneme jen s vaším souhlasem. ' +
      'Bez něj web funguje dál, jen bez mapy a překladu, a volbu můžete kdykoli změnit v patičce. <a href="/cookies">Více o cookies</a></p>';
    if (detailOpen) {
      h += '<ul class="cc-list">' +
        item('cc-nutne', 'Nezbytné', 'Zapamatují si vaši volbu. Bez nich lišta nefunguje, proto jsou vždy zapnuté.', true, null) +
        item('cc-analytika', 'Analytické', 'Google Analytics nám ukáže, kolik lidí web navštíví a co je na něm zajímá.', pick.analytics, 'analytics') +
        item('cc-ext', 'Externí služby', 'Mapa Google v kontaktech a překlad stránky do angličtiny, němčiny a polštiny přes Google Translate.', pick.external, 'external') +
        '</ul>';
    }
    h += '<div class="cc-actions">' +
      '<button type="button" class="cc-btn cc-no" data-cc="no">Odmítnout vše</button>' +
      '<button type="button" class="cc-btn cc-yes" data-cc="yes">Přijmout vše</button>' +
      (detailOpen
        ? '<button type="button" class="cc-btn cc-save cc-wide" data-cc="save">Uložit moji volbu</button>'
        : '<button type="button" class="cc-btn cc-more cc-wide" data-cc="detail">Nastavení</button>') +
      '</div>';
    box.innerHTML = h;
  }

  function onBoxClick(e) {
    var b = e.target.closest('[data-cc]');
    if (!b) return;
    var a = b.getAttribute('data-cc');
    if (a === 'no') save({ analytics: false, external: false });
    else if (a === 'yes') save({ analytics: true, external: true });
    else if (a === 'save') save(pick);
    else if (a === 'detail') { detailOpen = true; render(); box.focus(); }
    else if (a === 'toggle') {
      var key = b.getAttribute('data-key');
      pick[key] = !pick[key];
      b.setAttribute('aria-checked', String(pick[key]));
    }
  }

  function open(withDetail) {
    build();
    var c = read();
    pick = { analytics: !!(c && c.analytics), external: !!(c && c.external) };
    detailOpen = !!withDetail;
    render();
    root.hidden = false;
    // další snímek, aby se přechod přehrál
    requestAnimationFrame(function () { requestAnimationFrame(function () { root.classList.add('is-open'); }); });
    if (withDetail) box.focus();
  }

  function close() {
    if (!root) return;
    root.classList.remove('is-open');
    setTimeout(function () { if (!root.classList.contains('is-open')) root.hidden = true; }, 500);
  }

  // tlačítko u mapy povolí jen externí služby, volbu analytiky nemění
  function allowExternal() {
    var c = read();
    save({ analytics: !!(c && c.analytics), external: true });
  }

  // ───────────── spuštění ─────────────
  window.cvConsent = {
    has: function (cat) { var c = read(); return !!(c && c[cat]); },
    asked: function () { return !!read(); },
    open: function () { open(true); },
    accept: allowExternal
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (t) { e.preventDefault(); open(true); return; }
    var g = e.target.closest && e.target.closest('[data-cookie-accept]');
    if (g) { e.preventDefault(); allowExternal(); }
  });

  function start() {
    var c = read();
    if (c && c.analytics) startAnalytics();
    else clearCookies(/^_ga(_|$)/); // zbytky po odmítnutí nebo po vypršení souhlasu
    if (c && c.external) activateEmbeds();
    emit(c);
    if (location.hash === '#nastaveni-cookies') {
      history.replaceState(null, '', location.pathname + location.search);
      open(true);
    } else if (!c) {
      // vyskočí chvilku po načtení, ať nepřebije první pohled na web
      setTimeout(function () { if (!read()) open(false); }, 900);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
