// Souhlas s cookies a externími službami (§ 89 odst. 3 zákona č. 127/2005 Sb., GDPR).
// Nic, co není nezbytné, se nenačte, dokud návštěvník výslovně nesouhlasí:
//  - externí služby: mapa Google a překladač Google Translate.
// Písma jsou na vlastním serveru, takže se kvůli nim nikam nic nepřenáší.
// Lišta nabízí "Odmítnout vše" stejně snadno jako "Přijmout vše", nic není předem zaškrtnuté a volbu jde kdykoli
// změnit odkazem "Nastavení cookies" v patičce.
// Až se změní účely nebo nástroje, zvýšit VERSION a upravit cookies.html.
(function () {
  'use strict';
  var KEY = 'cv-consent';
  var VERSION = 1;
  var MAX_AGE_DAYS = 365;
  var memory = null; // když prohlížeč nedovolí ukládání, platí volba do zavření stránky

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      var s = raw ? JSON.parse(raw) : memory;
      if (!s || s.v !== VERSION) return null;
      if (Date.now() - new Date(s.at).getTime() > MAX_AGE_DAYS * 864e5) return null;
      return { v: s.v, at: s.at, external: !!s.external };
    } catch (e) { return memory; }
  }

  function clearGoogleCookies() {
    var host = location.hostname;
    var domains = ['', host, '.' + host, '.' + host.split('.').slice(-2).join('.')];
    document.cookie.split(';').map(function (c) { return c.split('=')[0].trim(); })
      .filter(function (n) { return /^googtrans$/.test(n); })
      .forEach(function (n) {
        domains.forEach(function (d) { document.cookie = n + '=; Max-Age=0; path=/' + (d ? '; domain=' + d : ''); });
      });
  }

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

  function save(external) {
    var prev = read();
    var s = { v: VERSION, at: new Date().toISOString(), external: !!external };
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* nevadí */ }
    if (prev && prev.external && !s.external) {
      // odvolání souhlasu: smazat cookie překladače a načíst stránku znovu, aby žádná cizí služba neběžela dál
      clearGoogleCookies();
      try { localStorage.removeItem('cv_lang'); } catch (e) { /* nevadí */ }
      location.reload();
      return;
    }
    if (s.external) activateEmbeds();
    emit(s);
    close();
  }

  // ───────────── lišta ─────────────
  var root = null, box = null, detailOpen = false, ext = false, built = false;

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

  function render() {
    var more = '/cookies';
    var h = '<h2 class="cc-title" id="cc-title">Cookies a externí služby</h2>' +
      '<p class="cc-text">Web funguje bez cookies. Mapu Google a překladač stránky načteme jen s vaším souhlasem, protože při nich vaše údaje putují k Googlu. ' +
      'Bez souhlasu se nenačte nic navíc a volbu můžete kdykoli změnit v patičce. <a href="' + more + '">Více o cookies</a></p>';
    if (detailOpen) {
      h += '<ul class="cc-list">' +
        '<li class="cc-item"><label for="cc-nutne"><strong>Nezbytné</strong><span>Zapamatují si vaši volbu. Bez nich lišta nefunguje, proto jsou vždy zapnuté.</span></label>' +
        '<button type="button" class="cc-switch" id="cc-nutne" role="switch" aria-checked="true" disabled></button></li>' +
        '<li class="cc-item"><label for="cc-ext"><strong>Externí služby</strong><span>Mapa Google v kontaktech a překlad stránky do angličtiny, němčiny a polštiny přes Google Translate.</span></label>' +
        '<button type="button" class="cc-switch" id="cc-ext" role="switch" aria-checked="' + ext + '" data-cc="toggle"></button></li>' +
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
    if (a === 'no') save(false);
    else if (a === 'yes') save(true);
    else if (a === 'save') save(ext);
    else if (a === 'detail') { detailOpen = true; render(); }
    else if (a === 'toggle') { ext = !ext; b.setAttribute('aria-checked', String(ext)); }
  }

  function open(withDetail) {
    build();
    var c = read();
    ext = !!(c && c.external);
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

  // ───────────── spuštění ─────────────
  window.cvConsent = {
    has: function (cat) { var c = read(); return !!(c && c[cat]); },
    asked: function () { return !!read(); },
    open: function () { open(true); },
    accept: function () { save(true); }
  };

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (t) { e.preventDefault(); open(true); return; }
    var g = e.target.closest && e.target.closest('[data-cookie-accept]');
    if (g) { e.preventDefault(); save(true); }
  });

  function start() {
    var c = read();
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
