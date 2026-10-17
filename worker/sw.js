/* Prowl's service worker (worker v114), served at /apps/prowl/sw.js on the shop through the Shopify app proxy, scope
   /apps/prowl/. It shows Prowl's notifications. v121: the installed app also registers it with scope /pages/prowl-app
   (the worker sends Service-Worker-Allowed) so Android's share sheet can hand it a photo: the fetch handler answers
   only that one POST and caches nothing else, so the pages work exactly as they did. ES5. The worker fills in API, APP and KEY when it serves this file (scripts/build-sw.mjs keeps
   worker/sw-src.js, the copy the worker imports, in step with this file). */
var API = '__PROWL_API__', APP = '__PROWL_APP__', KEY = '__PROWL_VAPID__';
var ICON = 'https://cdn.shopify.com/s/files/1/0807/8537/5486/files/panther_white_eyes_new_tail_clear.png?v=1785688388';   /* the panther */

function keyBytes(s) {
  var t = String(s).replace(/-/g, '+').replace(/_/g, '/'), b = atob(t + '==='.slice((t.length + 3) % 4)), out = new Uint8Array(b.length), i;
  for (i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
function post(path, body) {
  return fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })['catch'](function () {});
}

self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

/* v121 Android share sheet: the app manifest's share_target POSTs the photo to /pages/prowl-app?share-target=1. Keep
   the photo on the phone (Cache Storage, one entry) and send the app to ?shared=1, where the page runs a photo check */
var SHARE_CACHE = 'prowl-share', SHARE_KEY = '/__prowl-share', SHARE_APP = '/pages/prowl-app';
function shareBack(ok) { return Response.redirect(new URL(SHARE_APP + '?shared=' + (ok ? 1 : 0), self.location.origin).href, 303); }
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'POST' || r.url.indexOf('share-target=1') < 0) return;
  e.respondWith(r.formData().then(function (fd) {
    var f = fd.get('photo');
    if (!f || !f.size || !/^image\//.test(f.type || 'image/')) return shareBack(false);
    return caches.open(SHARE_CACHE).then(function (c) {
      return c.put(SHARE_KEY, new Response(f, { headers: { 'Content-Type': f.type || 'image/jpeg' } }));
    }).then(function () { return shareBack(true); });
  })['catch'](function () { return shareBack(false); }));
});

/* payload: { v, title, body, url, img, t, tag }. t is a signed token for this match (14 days); it never holds the
   member's sign-in. Android Chrome shows two buttons; a tap on the note itself is Open it. iPhone shows no buttons. */
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Prowl', body: e.data ? e.data.text() : '' }; }
  var o = { body: d.body || '', tag: d.tag || 'prowl', renotify: true, icon: ICON, data: { url: d.url || APP, t: d.t || '' } };
  if (d.img) o.image = d.img;
  if (d.t) o.actions = [{ action: 'price', title: 'Check price' }, { action: 'notit', title: 'Not it' }];
  e.waitUntil(self.registration.showNotification(d.title || 'Prowl', o));
});

self.addEventListener('notificationclick', function (e) {
  var n = e.notification, d = n.data || {}, u = d.url || APP;
  n.close();
  if (e.action === 'notit') { e.waitUntil(post('push/act', { t: d.t, action: 'notit' })); return; }
  if (e.action === 'price') u += (u.indexOf('?') > -1 ? '&' : '?') + 'fp=1';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    var i;
    for (i = 0; i < list.length; i++) if (list[i].url === u && 'focus' in list[i]) return list[i].focus();
    return self.clients.openWindow(u);
  }));
});

/* the browser replaced the subscription: subscribe again and tell the worker which one it replaces */
self.addEventListener('pushsubscriptionchange', function (e) {
  var old = e.oldSubscription ? e.oldSubscription.endpoint : '';
  e.waitUntil(self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }).then(function (s) {
    return post('push/swap', { old: old, sub: s.toJSON() });
  })['catch'](function () {}));
});
