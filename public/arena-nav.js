/**
 * Shared Mercantec Games navbar (Bomberman + Wizard)
 * Absolute paths — works with <base href="/Bomberman/">
 */
(function () {
  if (document.querySelector('.arena-nav')) return;

  var path = window.location.pathname || '';
  var active =
    /\/Bomberman/i.test(path) ? 'bomber' :
    /\/Wizard/i.test(path) ? 'wizard' :
    /\/guide/i.test(path) ? 'guide' :
    'select';

  function cls(key) {
    return key === active ? ' class="active"' : '';
  }

  var nav = document.createElement('header');
  nav.className = 'arena-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'Mercantec Games');
  nav.innerHTML =
    '<a class="arena-nav-brand" href="/">' +
      '<span class="arena-nav-mark">MERCANTEC</span>' +
      '<span class="arena-nav-sub">GAMES · EST. ARENA</span>' +
    '</a>' +
    '<nav class="arena-nav-links">' +
      '<a href="/"' + cls('select') + '>SELECT</a>' +
      '<a href="/guide"' + cls('guide') + '>GUIDE</a>' +
      '<a href="/Bomberman/"' + cls('bomber') + '>BOMBER</a>' +
      '<a href="/Wizard/"' + cls('wizard') + '>WIZARD</a>' +
    '</nav>';

  document.body.insertBefore(nav, document.body.firstChild);
})();
