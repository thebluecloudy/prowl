// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
// Runs only on the Prowl pages of owlandtwigvintage.com. Hands the Prowl
// Alerts sign-in the page already holds to the extension so a Pro member does
// not have to sign in twice. Nothing else on the page is read.
// 1.7.0: also the sign-ins Facebook watches report with, as the page holds
// them right now (the store sign-in prowl.session and the Prowl Alerts pair;
// signed out on the page means signed out for watches too), a mark on the page
// that the extension is here (data-prowl-ext, so the Den can say whether
// watches can run in this browser), and the page's "my watches changed" so a
// new watch takes its first look straight away.
(function () {
  var tries = 0, sess = null;
  try { document.documentElement.setAttribute('data-prowl-ext', chrome.runtime.getManifest().version); } catch (err) {}
  function send(m) { try { chrome.runtime.sendMessage(m); return true; } catch (err) { return false; } }
  function session() {
    var s = '', e = '', t = '';
    try {
      s = localStorage.getItem('prowl.session') || '';
      e = localStorage.getItem('prowl.alertEmail') || '';
      t = localStorage.getItem('prowl.alertTok') || '';
    } catch (err) { return; }
    var k = s + '|' + e + '|' + t;
    if (k !== sess && send({ type: 'session', s: s, e: e, t: t })) sess = k;
  }
  function read() {
    var e = '', t = '';
    session();
    try {
      e = localStorage.getItem('prowl.alertEmail') || '';
      t = localStorage.getItem('prowl.alertTok') || '';
    } catch (err) { return false; }
    if (!e || !t) return false;
    return send({ type: 'member', e: e, t: t });
  }
  window.addEventListener('message', function (ev) {
    if (ev.source !== window || !ev.data) return;
    if (ev.data.prowl === 'session') session();   // signed in or out on the page
    else if (ev.data.prowl === 'watches-changed') { session(); send({ type: 'watchesChanged' }); }
  });
  if (read()) return;
  var timer = setInterval(function () {
    tries++;
    if (read() || tries > 30) clearInterval(timer);
  }, 2000);
})();
