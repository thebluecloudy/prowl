// Prowl by Owl & Twig. (c) 2026 Owl & Twig Vintage. All rights reserved.
// Runs only on the Prowl pages of owlandtwigvintage.com. Hands the Prowl
// Alerts sign-in the page already holds to the extension so a Pro member does
// not have to sign in twice. Nothing else on the page is read.
(function () {
  var tries = 0;
  function read() {
    var e = '', t = '';
    try {
      e = localStorage.getItem('prowl.alertEmail') || '';
      t = localStorage.getItem('prowl.alertTok') || '';
    } catch (err) { return false; }
    if (!e || !t) return false;
    try { chrome.runtime.sendMessage({ type: 'member', e: e, t: t }); } catch (err) { return false; }
    return true;
  }
  if (read()) return;
  var timer = setInterval(function () {
    tries++;
    if (read() || tries > 30) clearInterval(timer);
  }, 2000);
})();
