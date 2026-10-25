/**
 * Prowl admin pages (v78): the sign-in page and the single-page dashboard served at /admin.
 *
 * No imports and no external resources. Everything rides in one <style nonce> and one <script nonce>
 * so the admin CSP can stay at default-src 'none'. The script builds every piece of API data into the
 * DOM with createElement/textContent (never innerHTML), and only https:// links and images get through.
 * The output is plain ASCII (entities in HTML, \u escapes in the script) so a missing charset can't garble it.
 */

/* Escapes text for HTML text and double-quoted attributes. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
    .replace(/[^\x00-\x7f]/g, c => "&#" + c.codePointAt(0) + ";");
}

/* Brand tokens shared by both pages. Status colors are fixed across modes and always ship with an icon + word. */
const BASE_CSS = String.raw`
:root{color-scheme:light;
--bg:#FAF6EE;--card:#FFFFFF;--card2:#FBF6EE;--ink:#2A140C;--ink2:#5A4033;--mu:#735A4B;--ol:#3B1E12;--hair:#ECE3D6;--hair2:#D8CAB7;--field:#8A7262;
--ac:#C2491F;--onac:#FFFFFF;--amber:#F2A743;--chip:#F4ECDF;--chip2:#FBE6DC;--chip3:#FDF0D5;--link:#A63B15;
--req:#2a78d6;--err:#d03b3b;--good:#0ca30c;--warn:#fab219;--ser:#ec835a;--crit:#d03b3b;
--track:#cde2fb;--wtrack:#fbe7bd;--ctrack:#f5d0d0;
--good-bg:#EAF6E8;--warn-bg:#FFF5DD;--crit-bg:#FCEAEA;--danger:#B42E2E;--ondanger:#FFFFFF;
--tipbg:#2A140C;--tipfg:#FAF6EE}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;
--bg:#0B1430;--card:#12204A;--card2:#0F1B3F;--ink:#F1F4FB;--ink2:#C9D3EA;--mu:#A3B1D4;--ol:#9DB7EA;--hair:#24386A;--hair2:#3A528C;--field:#6F86BE;
--ac:#F2A743;--onac:#0B1430;--chip:#1C2D5E;--chip2:#3B2B33;--chip3:#3A3320;--link:#F7C27A;
--req:#6da7ec;--track:#1f3c70;--wtrack:#4a3c18;--ctrack:#4d2232;
--good-bg:#11331F;--warn-bg:#352C12;--crit-bg:#3B1824;--danger:#F08A8A;--ondanger:#2A0B0B;
--tipbg:#F1F4FB;--tipfg:#0B1430}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;overflow-wrap:anywhere}
h1,h2,h3,h4{line-height:1.25;margin:0}
a{color:var(--link)}
:focus-visible{outline:3px solid var(--ac);outline-offset:2px;border-radius:6px}
.card{background:var(--card);border:2px solid var(--ol);border-radius:12px;padding:16px;min-width:0}
.btn{font:inherit;font-weight:650;font-size:14.5px;line-height:1.2;border-radius:10px;border:2px solid var(--ol);background:var(--card);color:var(--ink);
  padding:9px 14px;min-height:42px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--chip)}
.btn-p{background:var(--ac);border-color:var(--ac);color:var(--onac)}
.btn-p:hover{background:var(--ac);filter:brightness(1.07)}
.btn-d{background:var(--danger);border-color:var(--danger);color:var(--ondanger)}
.btn-d:hover{background:var(--danger);filter:brightness(1.07)}
.btn:disabled{opacity:.5;cursor:not-allowed;filter:none}
.btn-s{min-height:36px;padding:6px 11px;font-size:13.5px}
input[type=text],input[type=email],input[type=password],input[type=search],select{font:inherit;font-size:16px;color:var(--ink);background:var(--card);
  border:2px solid var(--field);border-radius:10px;padding:9px 12px;min-height:44px;width:100%;min-width:0}
input:focus-visible,select:focus-visible{border-color:var(--ac);outline-offset:0}
label{font-weight:650}
.hint{color:var(--mu);font-size:13px;margin:8px 0 0}
.sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.mark{width:30px;height:30px;flex:none}
`;

/* ---------- sign-in page ---------- */
const LOGIN_CSS = String.raw`
.lwrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.lcard{width:100%;max-width:380px;display:flex;flex-direction:column;gap:10px;padding:24px 20px}
.lcard h1{display:flex;align-items:center;gap:10px;font-size:24px}
.lcard .sub{margin:0 0 8px;color:var(--ink2)}
.lcard .btn{width:100%;margin-top:6px}
.lmsg{margin:0;padding:10px 12px;border-radius:10px;background:var(--crit-bg);border:1.5px solid var(--crit);font-weight:600}
`;

const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="15" fill="#C2491F"/>' +
  '<path d="M7 9l4 3M25 9l-4 3" stroke="#F2A743" stroke-width="2.4" stroke-linecap="round"/><circle cx="11.5" cy="17" r="4.6" fill="#FAF6EE"/>' +
  '<circle cx="20.5" cy="17" r="4.6" fill="#FAF6EE"/><circle cx="11.5" cy="17" r="2" fill="#2A140C"/><circle cx="20.5" cy="17" r="2" fill="#2A140C"/>' +
  '<path d="M14.6 22.2h2.8L16 24z" fill="#F2A743"/></svg>';

function head(nonce, title, css) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light dark">' +
    '<link rel="manifest" href="/admin/app.webmanifest"><link rel="apple-touch-icon" href="/admin/icon-180.png">' +
    '<meta name="theme-color" content="#C2491F"><meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Prowl admin">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="default">' +
    "<title>" + esc(title) + '</title><style nonce="' + esc(nonce) + '">' + css + "</style></head>";
}

export function loginPage(nonce, message) {
  return head(nonce, "Prowl admin", BASE_CSS + LOGIN_CSS) +
    '<body><main class="lwrap"><form class="card lcard" method="post" action="/admin/login">' +
    "<h1>" + MARK + "Prowl admin</h1>" +
    '<p class="sub">Members, hunts and health for Prowl.</p>' +
    (message ? '<p class="lmsg" role="alert">' + esc(message) + "</p>" : "") +
    '<label for="key">Admin key</label>' +
    '<input id="key" name="key" type="password" autocomplete="current-password" required autofocus spellcheck="false">' +
    '<button class="btn btn-p" type="submit">Sign in</button>' +
    '<p class="hint">Use the admin key from Cloudflare (the ADMIN_KEY secret).</p>' +
    "</form></main></body></html>";
}

/* ---------- dashboard ---------- */
const APP_CSS = String.raw`
.ukpi{font-weight:700;margin:0 0 10px}.ubh{font-size:16px;margin:18px 0 8px}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}
.top{padding-top:12px}
.top-in{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:9px;min-width:0}
.brand h1{font-size:20px}
.ver{font-size:12px;font-weight:650;color:var(--ink2);background:var(--chip);border-radius:999px;padding:2px 8px}
.tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tools form{margin:0}
.upd{font-size:13px;color:var(--mu);font-variant-numeric:tabular-nums}
.tabbar{position:sticky;top:0;z-index:5;background:var(--bg);margin-top:10px;border-bottom:2px solid var(--ol)}
.card,.view{scroll-margin-top:60px}
.tabs{display:flex;justify-content:space-between}
.tab{font:inherit;font-weight:650;font-size:13px;color:var(--ink2);background:none;border:0;border-bottom:4px solid transparent;
  padding:12px 3px 9px;min-height:46px;cursor:pointer;white-space:nowrap;text-align:center}
@media (min-width:600px){.tabs{justify-content:flex-start;gap:4px}.tab{font-size:14.5px;padding:12px 14px 9px}}
@media (max-width:370px){.tab{font-size:12px}}
.tab:hover{color:var(--ink)}
.tab[aria-selected=true]{color:var(--ink);border-bottom-color:var(--ac)}
main.wrap{padding-top:16px;padding-bottom:64px}
.view{display:flex;flex-direction:column;gap:16px}
.view[hidden]{display:none}
.busy{opacity:.6;transition:opacity .2s}
.two{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.stack{display:flex;flex-direction:column;gap:16px;min-width:0}
@media (min-width:860px){.two{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.ch{display:flex;align-items:center;justify-content:space-between;gap:8px 12px;flex-wrap:wrap;margin-bottom:10px}
.ch h2{font-size:17px}
.ch h3{font-size:16px}
.sub{color:var(--ink2);margin:0 0 10px;font-size:14px}
.muted{color:var(--mu)}
.small{font-size:13px}
.loading{color:var(--mu);margin:0;padding:8px 0}
.empty{color:var(--ink2);margin:0;padding:6px 0}
.ic{width:16px;height:16px;flex:none;display:block}
.ic.big{width:28px;height:28px}
.st{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;font-weight:600}
.note{display:flex;align-items:flex-start;gap:8px;margin:0;padding:10px 12px;border-radius:10px;background:var(--card2);border:1.5px solid var(--hair2)}
.note .ic{margin-top:2px}
.note.bad{background:var(--crit-bg);border-color:var(--crit)}
.note.warn{background:var(--warn-bg);border-color:var(--warn)}
.note.ok{background:var(--good-bg);border-color:var(--good)}
.note .btn{margin-left:auto}
.grow{flex:1;min-width:0}
.card>.note+.facts{margin-top:12px}
.hbox>.more{margin-top:20px;padding-top:14px;border-top:1.5px solid var(--hair2)}
.shape{white-space:pre-wrap;word-break:break-word;max-height:360px;overflow:auto;margin:10px 0 0;padding:10px;border:1px solid var(--hair2);border-radius:8px}
.lnk{font:inherit;color:var(--link);background:none;border:0;padding:0;text-decoration:underline;cursor:pointer;font-weight:600}
.banner{display:flex;gap:12px;align-items:flex-start;border:2px solid var(--ol);border-radius:12px;padding:14px 16px}
.banner.ok{background:var(--good-bg)}
.banner.warning{background:var(--warn-bg)}
.banner.critical{background:var(--crit-bg)}
.banner h2{font-size:19px}
.banner p{margin:4px 0 0;color:var(--ink2)}
.banner ul{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:8px}
.banner li{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}
.banner li .st{min-width:92px}
.banner li .txt{flex:1 1 220px}
.tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media (min-width:760px){.tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.tile{background:var(--card);border:2px solid var(--ol);border-radius:12px;padding:12px 14px;min-width:0;display:flex;flex-direction:column}
.tl{font-size:13px;font-weight:650;color:var(--ink2)}
.tv{font-size:26px;font-weight:700;line-height:1.15;margin:4px 0 2px;letter-spacing:-.01em}
.ts{font-size:12.5px;color:var(--mu);display:flex;flex-wrap:wrap;gap:2px 8px;align-items:center}
.ts .st{font-weight:600;color:var(--ink2)}
.spark{margin-top:auto;padding-top:10px}
.sp{position:relative;height:40px;touch-action:pan-y;cursor:crosshair}
.sp svg{display:block;width:100%;height:40px;overflow:visible}
.sl{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.sg{stroke:var(--hair2);stroke-width:1}
.s-req .sl{stroke:var(--req)}.s-req .sa{fill:var(--req);opacity:.1}.s-req .sd,.s-req .se{background:var(--req)}
.s-err .sl{stroke:var(--err)}.s-err .sa{fill:var(--err);opacity:.1}.s-err .sd,.s-err .se{background:var(--err)}
.sx{position:absolute;top:0;bottom:0;width:1px;background:var(--mu);transform:translateX(-.5px);pointer-events:none}
.sd,.se{position:absolute;width:10px;height:10px;border-radius:50%;box-shadow:0 0 0 2px var(--card);transform:translate(-50%,-50%);pointer-events:none}
.sxl{display:flex;justify-content:space-between;font-size:11.5px;color:var(--mu);margin-top:4px}
.tip{position:absolute;bottom:calc(100% + 8px);transform:translateX(-50%);background:var(--tipbg);color:var(--tipfg);padding:5px 9px;border-radius:8px;
  font-size:12.5px;white-space:nowrap;pointer-events:none;z-index:3;box-shadow:0 2px 8px rgba(0,0,0,.18)}
.tip b{font-size:14px;margin-right:4px}
.tip .tl2{opacity:.82}
.tip.l{transform:none}.tip.r{transform:translateX(-100%)}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -16px;padding:0 16px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:14px;overflow-wrap:break-word}
th{text-align:left;font-weight:650;color:var(--ink2);font-size:12.5px;border-bottom:1.5px solid var(--hair2);padding:7px 10px;white-space:nowrap;vertical-align:bottom}
td{padding:8px 10px;border-bottom:1px solid var(--hair);vertical-align:top}
tr:last-child td{border-bottom:0}
th:first-child,td:first-child{padding-left:0}
th:last-child,td:last-child{padding-right:0}
.num{text-align:right;white-space:nowrap}
.nw{white-space:nowrap}
.wide{min-width:180px}
.id{white-space:nowrap}
@media (max-width:640px){
  .tw.stack-on{margin:0;padding:0;overflow:visible}
  .stk thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
  .stk,.stk tbody{display:block}
  .stk tr{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;padding:10px 0;border-bottom:1px solid var(--hair)}
  .stk tr:first-child{padding-top:2px}
  .stk tr:last-child{border-bottom:0}
  .stk td{display:block;border:0;padding:0;text-align:left;font-size:13.5px;min-width:0}
  .stk td::before{content:attr(data-label) "\00a0 ";color:var(--mu);font-size:12px;font-weight:600}
  .stk td:first-child{flex:1 0 55%;font-weight:700;font-size:15px}
  .stk td:first-child::before,.stk td.bare::before{content:none}
  .stk td:nth-child(2){flex:none}
  .stk td.wide{flex:1 0 100%;min-width:0}
  .stk td.nil{display:none}
}
.term{font-weight:600}
.code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:0}
.facts.f4{grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:700px){.facts.f4{grid-template-columns:repeat(4,minmax(0,1fr))}}
.facts div{min-width:0}
.facts dt{font-size:12.5px;color:var(--mu);font-weight:600}
.facts dd{margin:2px 0 0;font-weight:650;font-size:15px}
.kv{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:8px 16px;margin:0}
.kv dt{color:var(--mu);font-size:13.5px;font-weight:600}
.kv dd{margin:0}
.meters{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.mh{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:14px;margin-bottom:5px}
.mh .v{font-variant-numeric:tabular-nums;color:var(--ink2);display:inline-flex;gap:8px;align-items:center}
.meter{height:8px;border-radius:4px;background:var(--track);overflow:hidden}
.meter i{display:block;height:100%;border-radius:4px;background:var(--req)}
.meter.w{background:var(--wtrack)}.meter.w i{background:var(--warn)}
.meter.c{background:var(--ctrack)}.meter.c i{background:var(--crit)}
.seg{display:inline-flex;border:2px solid var(--ol);border-radius:10px;overflow:hidden}
.seg button{font:inherit;font-size:13.5px;font-weight:650;background:var(--card);color:var(--ink);border:0;padding:6px 12px;min-height:34px;cursor:pointer}
.seg button+button{border-left:2px solid var(--ol)}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--bg)}
.bar{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.bar i{display:block;height:6px;border-radius:3px;background:var(--req);min-width:2px}
.bar .bt{width:70px;flex:none;display:flex;justify-content:flex-start}
@media (max-width:480px){.bar .bt{width:44px}}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{font:inherit;font-size:13.5px;font-weight:650;color:var(--ink);background:var(--card);border:2px solid var(--hair2);border-radius:999px;padding:6px 13px;min-height:36px;cursor:pointer}
.chip[aria-pressed=true]{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.bdg{display:inline-flex;align-items:center;gap:4px;font-size:12px;font-weight:650;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--ink);white-space:nowrap;line-height:1.5;max-width:100%}
.badges .bdg{white-space:normal}
.bdg .ic{width:13px;height:13px}
.b-pro{background:var(--chip2)}
.b-trial{background:var(--chip3)}
.b-out{border:1.5px solid var(--hair2);background:transparent}
.badges{display:flex;flex-wrap:wrap;gap:5px}
.find form{display:block}
.frow{display:flex;gap:8px;margin-top:6px}
.frow input{flex:1}
.msg{margin:8px 0 0;font-weight:600}
.msg:empty{display:none}
.mtools{display:flex;flex-direction:column;gap:12px}
.mtools .sort{display:flex;align-items:center;gap:8px;font-size:14px}
.mtools .sort select{width:auto;min-height:38px;padding:6px 10px;font-size:14px}
.mcount{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:center;color:var(--ink2);font-size:14px}
.mlist{display:flex;flex-direction:column}
.mrow,.mhead{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center;width:100%;text-align:left;font:inherit;color:var(--ink);background:none;border:0;
  border-bottom:1px solid var(--hair);padding:12px 4px;font-variant-numeric:tabular-nums}
.mrow{cursor:pointer;border-radius:0}
.mrow:hover{background:var(--card2)}
.mrow:last-child{border-bottom:0}
.mhead{display:none;font-size:12.5px;font-weight:650;color:var(--ink2);border-bottom:1.5px solid var(--hair2);padding-top:0}
.c-id{font-weight:700}
.c-plan{display:inline-flex;flex-wrap:wrap;gap:4px}
.c-meta{display:flex;flex-wrap:wrap;gap:2px 12px;width:100%;font-size:13.5px;color:var(--ink2)}
.c-flags{display:flex;flex-wrap:wrap;gap:5px;width:100%}
.c-flags:empty{display:none}
.lbl{color:var(--mu)}
@media (min-width:860px){
  .mrow,.mhead{display:grid;grid-template-columns:130px 110px 80px 70px 110px 110px minmax(0,1fr);gap:12px;padding:10px 6px}
  .mhead{display:grid}
  .c-meta{display:contents}
  .lbl{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
  .c-flags:empty{display:block}
}
@media (max-width:859px){.mgrid .stack{display:contents}.o1{order:1}.o2{order:2}.o3{order:3}.o4{order:4}.o5{order:5}.o6{order:6}}
.dhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dhead h2{font-size:22px}
.dline{color:var(--ink2);margin:6px 0 12px;font-size:14px}
.flags{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.flags li{display:flex;gap:10px;align-items:flex-start}
.flags b{display:block}
.flags .ic{margin-top:2px}
.hunts{list-style:none;margin:0;padding:0}
.hunts li{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--hair)}
.hunts li:last-child{border-bottom:0}
.hunts .hb{min-width:0;flex:1}
.hunts .ht{font-weight:650;margin-bottom:4px}
.hunts .ht.hid{font-style:italic;color:var(--mu);font-weight:500}
.acts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.acts li{padding:12px 0;border-bottom:1px solid var(--hair);display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.acts li:first-child{padding-top:0}
.acts li:last-child{border-bottom:0;padding-bottom:0}
.acts p{margin:0;color:var(--ink2);font-size:13.5px}
.conf{display:flex;flex-direction:column;gap:6px;width:100%;padding:10px;border-radius:10px;background:var(--card2);border:1.5px solid var(--hair2)}
.conf .frow{margin:0;flex-wrap:wrap}
.conf .frow input{flex:1 1 160px}
.lastmsg{margin:0 0 12px}
.gform{display:flex;flex-direction:column;gap:12px}
.ggrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:760px){.ggrid{grid-template-columns:minmax(0,3fr) minmax(0,3fr) minmax(0,2fr)}}
.ggrid label{display:block;margin-bottom:6px}
.gform .btn{align-self:flex-start}
.affp{border-top:1px solid var(--hair);padding:16px 0 4px}
.affp:first-child{border-top:0;padding-top:4px}
.affp .ggrid{margin:4px 0 2px}
.affrow{display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap}
.gform .ck,.gbox .ck{align-self:flex-start}
.gl-h{margin:18px 0 6px;padding-top:14px;border-top:1.5px solid var(--hair2)}
.gbox{display:flex;flex-direction:column;gap:8px;margin-top:14px;padding-top:12px;border-top:1.5px solid var(--hair2)}
.gbox h4{font-size:15px}
.gbox .frow{margin:0;flex-wrap:wrap;align-items:center}
.gbox label{font-size:14px}
.gbox select{width:auto;min-height:38px;padding:6px 10px;font-size:15px}
.gbox .hint{margin:0}
.waits{display:flex;flex-direction:column;gap:14px}
.waits h4{font-size:15px;margin-bottom:6px}
.samp{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:14px}
.dform{display:flex;flex-direction:column;gap:12px}
.dgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media (min-width:760px){.dgrid{grid-template-columns:minmax(0,2fr) minmax(0,1fr)}}
.dgrid label,.dform legend{display:block;margin-bottom:6px}
.opt{font-weight:500;color:var(--mu)}
fieldset{border:0;padding:0;margin:0;min-width:0}
.checks{display:flex;flex-wrap:wrap;gap:8px}
.ck{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:14px;padding:6px 12px 6px 9px;border:2px solid var(--hair2);border-radius:999px;cursor:pointer;min-height:38px}
.ck input{width:18px;height:18px;margin:0;accent-color:var(--ac)}
.dfrom{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;background:var(--card2);border:1.5px solid var(--hair2);font-size:14px}
.drun{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.legend{font-size:13.5px}
.legend summary{cursor:pointer;font-weight:650;min-height:32px;display:flex;align-items:center}
.legend dl{display:grid;grid-template-columns:minmax(0,max-content) minmax(0,1fr);gap:8px 12px;margin:10px 0 0;align-items:start}
.legend dd{margin:0;color:var(--ink2)}
@media (max-width:520px){.legend dl{grid-template-columns:minmax(0,1fr);gap:3px}.legend dd{margin-bottom:9px}}
.dsum{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin:0}
@media (min-width:760px){.dsum{grid-template-columns:repeat(5,minmax(0,1fr))}}
.dsum dt{font-size:12.5px;color:var(--mu);font-weight:600}
.dsum dd{margin:2px 0 0;font-size:22px;font-weight:700}
.srch{display:flex;align-items:center;gap:8px 14px;flex-wrap:wrap}
.srch h3{font-size:17px}
.cnt{color:var(--ink2);font-size:13.5px;margin:4px 0 10px}
.items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:0 20px}
@media (min-width:860px){.items{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}
.item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--hair);min-width:0}
.item img,.noimg{width:64px;height:64px;border-radius:8px;object-fit:cover;flex:none;background:var(--chip);border:1px solid var(--hair)}
.item .ib{min-width:0;flex:1;display:flex;flex-direction:column;gap:4px}
.item .it{font-weight:650;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.item .ip{font-size:13.5px;color:var(--ink2);font-variant-numeric:tabular-nums}
.item.out .it{color:var(--ink2)}
.item.out img{opacity:.55}
.io{font-size:13px}
.more{margin-top:10px}
.out-ov{position:fixed;inset:0;z-index:20;background:rgba(11,20,48,.55);display:flex;align-items:center;justify-content:center;padding:16px}
.out-ov[hidden]{display:none}
.out-ov .card{max-width:400px;width:100%;display:flex;flex-direction:column;gap:10px}
.out-ov p{margin:0;color:var(--ink2)}
.toast{position:fixed;left:50%;bottom:16px;transform:translate(-50%,20px);z-index:15;max-width:calc(100% - 32px);width:max-content;
  background:var(--tipbg);color:var(--tipfg);border-radius:12px;padding:11px 14px;font-weight:600;font-size:14.5px;display:flex;gap:9px;align-items:flex-start;
  box-shadow:0 6px 20px rgba(0,0,0,.25);opacity:0;pointer-events:none;transition:opacity .2s,transform .2s}
.toast.on{opacity:1;transform:translate(-50%,0)}
.toast .ic{margin-top:2px}
.skip{position:absolute;left:-999px;top:8px;z-index:30;background:var(--card);padding:8px 12px;border:2px solid var(--ol);border-radius:8px}
.skip:focus{left:16px}
@media (prefers-reduced-motion:reduce){.toast,.busy{transition:none}}
@media (max-width:420px){.brand h1{font-size:18px}.tools .btn{padding:7px 10px;min-height:38px;font-size:13.5px}}
`;

/* The dashboard script. String.raw keeps its regexes and \u escapes exactly as written; it must not contain
   backticks or dollar-brace, and it never uses innerHTML. */
const APP_JS = String.raw`
try { if ("serviceWorker" in navigator) navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin" }).catch(function () {}); } catch (e) {}
(() => {
"use strict";
const D = document, $ = (s, r) => (r || D).querySelector(s);
const SS = {
  get: k => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) { /* private mode: just don't remember */ } }
};
const TABS = ["overview", "members", "diagnose", "errors", "searches", "affiliates"];
const S = { tab: "", aData: null, ov: null, ovAt: 0, ovSeq: 0, out: false, health: null, sales: null, routesAll: false, top: "today",
  mFilter: "all", mSort: "created", mData: null, mAt: 0, mSeq: 0, member: null, memberId: "", pushed: false, lastMsg: null,
  late: null, diag: null, dSel: null, diagRes: null, diagShow: "all", diagSeq: 0, errSeq: 0, sDays: 7, sSeq: 0, uSeq: 0, uAt: 0, toastT: 0,
  gData: null, gAt: 0, gSeq: 0, giftsAll: false, glen: null };

/* ---------- DOM: API data only ever lands in textContent or vetted https attributes ---------- */
function h(tag, a, kids) {
  if (a != null && (Array.isArray(a) || typeof a !== "object" || a.nodeType)) { kids = a; a = null; }   /* h(tag, kids) */
  const e = D.createElement(tag);
  if (a) for (const k of Object.keys(a)) {
    const v = a[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = String(v);
    else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : String(v));
  }
  return put(e, kids);
}
function put(e, kids) {
  if (kids == null || kids === false) return e;
  if (Array.isArray(kids)) { kids.forEach(k => put(e, k)); return e; }
  e.appendChild(typeof kids === "object" && kids.nodeType ? kids : D.createTextNode(String(kids)));
  return e;
}
function fill(e, kids) { e.textContent = ""; return put(e, kids); }
const NS = "http://www.w3.org/2000/svg";
function sv(tag, a) { const e = D.createElementNS(NS, tag); for (const k of Object.keys(a || {})) e.setAttribute(k, String(a[k])); return e; }
function https(u) { u = String(u || ""); return /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : ""; }

/* Status icons: a distinct shape per level so the state never rests on colour alone. */
const STC = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b" };
function icon(lv, big) {
  const s = sv("svg", { viewBox: "0 0 16 16", class: "ic" + (big ? " big" : ""), "aria-hidden": "true", focusable: "false" });
  const c = STC[lv], dark = "#2A140C", line = { fill: "none", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };
  if (lv === "good") {
    s.appendChild(sv("circle", { cx: 8, cy: 8, r: 7.5, fill: c }));
    s.appendChild(sv("path", Object.assign({ d: "M4.6 8.3l2.2 2.2 4.6-4.8", stroke: "#fff" }, line)));
  } else if (lv === "critical") {
    s.appendChild(sv("circle", { cx: 8, cy: 8, r: 7.5, fill: c }));
    s.appendChild(sv("path", Object.assign({ d: "M5.4 5.4l5.2 5.2M10.6 5.4l-5.2 5.2", stroke: "#fff" }, line)));
  } else if (lv === "serious" || lv === "warning") {
    s.appendChild(sv("path", { d: lv === "serious" ? "M8 .5l7.5 7.5L8 15.5.5 8z" : "M8 1.2l7.3 13.3H.7z", fill: c }));
    s.appendChild(sv("path", Object.assign({ d: lv === "serious" ? "M8 4.6v4" : "M8 6.2v3.6", stroke: dark }, line)));
    s.appendChild(sv("circle", { cx: 8, cy: lv === "serious" ? 11.3 : 12.2, r: 1.1, fill: dark }));
  } else {
    s.appendChild(sv("circle", { cx: 8, cy: 8, r: 7, fill: "none", stroke: "currentColor", "stroke-width": 1.6 }));
    s.appendChild(sv("path", Object.assign({ d: "M8 7.2v4.2", stroke: "currentColor" }, line)));
    s.appendChild(sv("circle", { cx: 8, cy: 4.8, r: 1.1, fill: "currentColor" }));
  }
  return s;
}
function st(lv, word) { return h("span", { class: "st" }, [icon(lv), h("span", { text: word })]); }
function note(kind, text, retry) {
  const lv = kind === "bad" ? "critical" : kind === "warn" ? "warning" : kind === "ok" ? "good" : "info";
  return h("div", { class: "note " + kind, role: kind === "bad" ? "alert" : null }, [icon(lv), h("span", { text: text }),
    retry ? h("button", { class: "btn btn-s", type: "button", text: "Try again", onclick: retry }) : null]);
}
function loading(text) { return h("p", { class: "loading", text: text || "Loading\u2026" }); }

/* ---------- numbers and times (browser local time; hour keys from the server are UTC) ---------- */
const NF = new Intl.NumberFormat();
function num(n) { return n == null || n === "" || isNaN(n) ? "\u2014" : NF.format(Math.round(Number(n))); }
function pc(n) { if (n == null || isNaN(n)) return "\u2014"; n = Number(n); return (n >= 99.95 || n === 0 ? Math.round(n) : n >= 10 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100) + "%"; }
function secs(ms) { ms = Number(ms) || 0; return (ms < 1000 ? Math.round(ms / 10) / 100 : ms < 10000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000)) + " s"; }
/* Percentiles come from histogram buckets, so a value is the bucket's upper edge: "under 0.5 s". */
function band(ms) { ms = Number(ms) || 0; return !ms ? "\u2014" : ms >= 8000 ? "8 s or more" : "under " + secs(ms); }
function cap(s) { s = String(s); return s.charAt(0).toUpperCase() + s.slice(1); }
function plural(n, one, many) { return num(n) + " " + (Number(n) === 1 ? one : many); }
const EDGES = [100, 250, 500, 1000, 2000, 4000, 8000];
function pctl(a, p) {
  if (!a) return 0;
  const k = p === 0.5 ? "p50" : "p95";
  if (a[k] != null) return a[k];
  const hh = Array.isArray(a.h) ? a.h : [], tot = hh.reduce((s, x) => s + (Number(x) || 0), 0);
  if (!tot) return 0;
  let c = 0;
  for (let i = 0; i < 8; i++) { c += Number(hh[i]) || 0; if (c >= Math.ceil(tot * p)) return EDGES[Math.min(i, 6)]; }
  return 8000;
}
function errPct(a) { return !a ? 0 : a.errPct != null ? Number(a.errPct) : a.n ? a.e5 / a.n * 100 : 0; }
function toDate(x) {
  if (x == null || x === "") return null;
  if (typeof x === "number") return new Date(x);
  const s = String(x);
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(s)) return new Date(s + ":00:00Z");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
  if (/^\d{10,}$/.test(s)) return new Date(+s);
  const d = new Date(s);
  return isNaN(d) ? null : d;
}
function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function fmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function fmtDay(x) {
  const d = toDate(x); if (!d) return "\u2014";
  const now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function fmtWhen(x) {
  const d = toDate(x); if (!d) return "\u2014";
  const day = fmtDay(d);
  return (day === "Today" ? "" : day + ", ") + fmtTime(d);
}
function fmtHour(k) { const d = toDate(k); return d ? d.toLocaleTimeString([], { hour: "numeric" }) : ""; }
function hourSpan(k) { const d = toDate(k); if (!d) return ""; const e = new Date(d.getTime() + 3600000); return fmtHour(d.getTime()) + "\u2013" + fmtHour(e.getTime()); }
function clock(hr) { hr = Number(hr); if (isNaN(hr)) return "\u2014"; return hr === 0 ? "12 AM" : hr < 12 ? hr + " AM" : hr === 12 ? "12 PM" : (hr - 12) + " PM"; }
function ago(min) {
  min = Math.max(0, Math.round(Number(min) || 0));
  if (min < 1) return "just now";
  if (min < 60) return min + " min ago";
  if (min < 48 * 60) return Math.floor(min / 60) + " h " + (min % 60 ? (min % 60) + " min " : "") + "ago";
  return Math.round(min / 1440) + " days ago";
}

/* ---------- plain words ---------- */
const SRC = { shopgoodwill: "ShopGoodwill", ebay: "eBay", etsy: "Etsy", chairish: "Chairish", poshmark: "Poshmark", poshsold: "Poshmark (sold)",
  depop: "Depop", vinted: "Vinted", grailed: "Grailed", hibid: "HiBid" };
const DEFAULT_SOURCES = ["shopgoodwill", "ebay", "etsy", "chairish", "poshmark", "vinted", "grailed"];
function srcName(s) { return SRC[s] || String(s || "?"); }
const ROUTES = { "ai:fairprice": "Fair price check", "ai:photo": "Photo check", "ai:research": "Research", "ai:guide": "Field Guide",
  "ai:where": "Where to look", "ai:huntcheck": "Hunt name check", "shop:picks": "Shop picks", "store:login": "Store sign-in (Shopify)", "fb:finds": "Facebook finds", "fb:ingest": "Facebook sweep (from Prowl)", art: "Page art (Uranium hero)", other: "Other pages",
  "alerts:subscribe": "Alerts: sign up", "alerts:confirm": "Alerts: confirm address", "alerts:signin": "Alerts: send sign-in link", "alerts:in": "Alerts: open sign-in link",
  "alerts:status": "Alerts: member page", "alerts:prefs": "Alerts: save settings", "alerts:mail": "Alerts: emails on/off", "alerts:delete": "Alerts: delete account",
  "alerts:move": "Alerts: change address", "alerts:move-confirm": "Alerts: confirm new address", "alerts:unsub": "Alerts: unsubscribe", "alerts:test": "Alerts: test email",
  "alerts:other": "Alerts: other" };
function routeName(r) { r = String(r || ""); return ROUTES[r] || (r.indexOf("live:") === 0 ? "Search: " + srcName(r.slice(5)) : r.indexOf("alerts:") === 0 ? "Alerts: " + r.slice(7) : r || "\u2014"); }
function codeWord(s) { s = Number(s); return s === 500 ? "Server error" : s === 502 ? "Bad answer upstream" : s === 503 ? "Unavailable" : s === 504 ? "Timed out" : s >= 500 ? "Server error" : s === 429 ? "Too many requests" : s >= 400 ? "Refused" : ""; }
const PLAN = { pro: "Pro", trial: "Trial", free: "Free", "free (legacy)": "Free (legacy)" };
function planOf(m) {
  if (!m) return "free";
  const pl = m.plan && typeof m.plan === "object" ? m.plan : {};
  const p = typeof m.plan === "string" ? m.plan : m.planName || pl.name || "";
  return p ? String(p) : m.pro ? (pl.trial ? "trial" : "pro") : "free";
}
function planBadge(p) { p = String(p || "free"); return h("span", { class: "bdg" + (p === "pro" ? " b-pro" : p === "trial" ? " b-trial" : ""), text: PLAN[p] || cap(p) }); }
const VIA = { list: "Free Pro from the Cloudflare list (PRO_EMAILS)", gift: "Free Pro gift (from you)", order: "Shop order", subscription: "Shop subscription", trial: "Free trial", manual: "Added by hand" };
const FREQ = { daily: "Every day", mwf: "Mon, Wed and Fri", weekly: "Mondays" };
const FLAGS = {
  "emails off": "They turned emails off or unsubscribed. Nothing is sent until emails are back on.",
  "paused": "They paused their alerts. Emails start again on the date they picked, or when you unpause them.",
  "no hunts": "They have no hunts saved, so there is nothing to search for.",
  "email late": "Today's email is due and their send hour has passed, but it has not gone out yet.",
  "pro check failing": "Prowl could not confirm their Pro membership with the shop. Try Re-check Pro.",
  "sign-in link waiting": "A sign-in link was emailed and has not been used yet. It works once, for 24 hours.",
  "moved address": "They changed their email address. Old addresses are never shown here.",
  "hunts over plan limit": "They have more hunts than their plan checks, so only the first few are searched.",
  "record unreadable": "Their saved record could not be read. Ask a developer to look at it.",
  "gift ended": "Their free Pro gift has ended. Their plan switches at the next daily check, or press Re-check Pro to do it now."
};
const ISSUE_FLAGS = ["email late", "pro check failing", "no hunts", "record unreadable"];
function flagChip(f) { return h("span", { class: "bdg" + (ISSUE_FLAGS.indexOf(f) >= 0 ? "" : " b-out") }, [ISSUE_FLAGS.indexOf(f) >= 0 ? icon("warning") : null, f]); }
const AI = { match: "Match", lot: "Lot or set", reproduction: "Reproduction", part: "Part or accessory", wrong_item: "Wrong item" };
const AUDIT = { login: "Admin sign-in", logout: "Admin sign-out", "signin-link": "Sent a sign-in link", "refresh-pro": "Re-checked Pro",
  "recheck-today": "Re-check hunts today", "resend-today": "Send today's email again", "mail-on": "Turned emails on", "mail-off": "Turned emails off",
  unpause: "Unpaused", "signout-all": "Signed out all devices", "clear-seen": "Cleared already-sent memory", delete: "Deleted a member",
  find: "Looked up a member", diagnose: "Ran Diagnose", healthcheck: "Ran a health check", salescheck: "Checked the garage-sale sites",
  "aff-on": "Turned an affiliate on", "aff-off": "Turned an affiliate off", "aff-ids": "Saved affiliate IDs", "gift-add": "Gifted Pro", "gift-remove": "Turned off a gift", "gift-on": "Gifted Pro to a member", "gift-off": "Turned off free Pro" };
const ISSUES = { members: "member counts", alerts: "alert emails", metrics: "speed, errors and uptime", traffic: "speed and errors", uptime: "uptime",
  ai: "AI usage", pools: "AI usage", searches: "top searches", audit: "admin activity", errors: "recent errors" };

/* ---------- API ---------- */
function ApiErr(msg, status) { const e = new Error(msg); e.status = status; return e; }
function friendly(s) {
  return s === 429 ? "Too many tries for now. Wait a few minutes and try again."
    : s === 403 ? "Prowl refused that request. Reload the page and try again."
    : s === 404 ? "Not found."
    : s === 413 ? "That was too much to send at once."
    : s >= 500 ? "Prowl hit a problem answering (" + s + "). Try again in a minute."
    : "Something went wrong (" + s + ").";
}
async function api(path, body) {
  const o = { credentials: "same-origin", headers: { Accept: "application/json" }, cache: "no-store" };
  if (body !== undefined) { o.method = "POST"; o.headers["Content-Type"] = "application/json"; o.headers["X-Prowl-Admin"] = "1"; o.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(path, o); } catch (e) { throw ApiErr("Could not reach Prowl. Check the connection and try again.", 0); }
  if (r.status === 401) { signedOut(); throw ApiErr("You are signed out.", 401); }
  let j = null;
  try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw ApiErr((j && typeof j.error === "string" && j.error) || (j && typeof j.message === "string" && j.message) || friendly(r.status), r.status);
  if (!j || typeof j !== "object") throw ApiErr("Prowl sent an answer this page could not read. Try again.", r.status);
  return j;
}
function signedOut() { if (S.out) return; S.out = true; const o = $("#out"); o.hidden = false; const a = $("a", o); if (a) a.focus(); }
function stamp() { $("#upd").textContent = "Updated " + fmtTime(new Date()); }
function toast(text, bad) {
  const t = $("#toast");
  fill(t, [icon(bad ? "critical" : "good"), h("span", { text: text })]);
  t.classList.add("on");
  clearTimeout(S.toastT);
  S.toastT = setTimeout(() => { t.classList.remove("on"); }, 9000);
}

/* ---------- tabs and history (#overview, #members, #member/M-..., #diagnose, ...) ---------- */
const tabBtns = Array.prototype.slice.call(D.querySelectorAll("[data-tab]"));
function selectTab(tab, detail) {
  if (TABS.indexOf(tab) < 0) tab = "overview";
  S.tab = tab;
  SS.set("prowl-admin-tab", tab);
  tabBtns.forEach(b => { const on = b.getAttribute("data-tab") === tab; b.setAttribute("aria-selected", on ? "true" : "false"); b.tabIndex = on ? 0 : -1; });
  TABS.forEach(t => { $("#v-" + t).hidden = t !== tab; });
  D.title = (detail ? S.memberId : $("[data-tab=" + tab + "]").textContent) + " \u00b7 Prowl admin";
  if (tab === "members" && !detail) {
    $("#mlist").hidden = false; $("#mdetail").hidden = true; S.memberId = ""; S.pushed = false;
    if (!S.mData || Date.now() - S.mAt > 60000) loadMembers();
    if (!S.gData || Date.now() - S.gAt > 60000) loadGifts();
  }
  if (tab === "overview" && (!S.ov || Date.now() - S.ovAt > 60000)) loadOverview();
  if (tab === "diagnose") prepDiag();
  if (tab === "errors") loadErrors();
  if (tab === "searches") { loadSearches(); if (!S.uAt || Date.now() - S.uAt > 300000) loadUsage(); }
  if (tab === "affiliates") loadAff();
}
function go(tab) { history.replaceState(null, "", "#" + tab); selectTab(tab); }
/* Member ids are lower-case hex on the server; accept any case typed or pasted. */
function normId(id) { id = String(id || "").trim(); return /^M-[0-9a-f]{8}$/i.test(id) ? "M-" + id.slice(2).toLowerCase() : ""; }
function route() {
  if (S.out) return;
  let hs = "";
  try { hs = decodeURIComponent(location.hash.replace(/^#/, "")); } catch (e) { hs = ""; }   /* a mangled link must not stop the page */
  const m = /^member\/(M-[0-9a-f]{8})$/i.exec(hs);
  if (m) { openMember(m[1], true); return; }
  selectTab(TABS.indexOf(hs) >= 0 ? hs : (SS.get("prowl-admin-tab") || "overview"));
}
tabBtns.forEach((b, i) => {
  b.addEventListener("click", () => go(b.getAttribute("data-tab")));
  b.addEventListener("keydown", e => {
    const k = e.key, n = tabBtns.length;
    const j = k === "ArrowRight" ? (i + 1) % n : k === "ArrowLeft" ? (i + n - 1) % n : k === "Home" ? 0 : k === "End" ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); tabBtns[j].focus(); go(tabBtns[j].getAttribute("data-tab"));
  });
});
addEventListener("popstate", route);
$("#refresh").addEventListener("click", () => {
  if (S.tab === "overview") loadOverview();
  else if (S.tab === "members") { if (S.memberId) openMember(S.memberId, true); else { loadMembers(true); loadGifts(); } }
  else if (S.tab === "errors") loadErrors();
  else if (S.tab === "searches") { loadSearches(); loadUsage(); }
  else if (S.tab === "diagnose") { if (!S.ov) loadOverview(); stamp(); }
  else if (S.tab === "affiliates") loadAff();
});
/* Every 60 s while this browser tab is in view and the overview is open; catch up when it comes back into view. */
setInterval(() => { if (!S.out && D.visibilityState === "visible" && S.tab === "overview") loadOverview(); }, 60000);
D.addEventListener("visibilitychange", () => { if (!S.out && D.visibilityState === "visible" && S.tab === "overview" && Date.now() - S.ovAt > 60000) loadOverview(); });

/* ---------- 1. Overview ---------- */
async function loadOverview() {
  const box = $("#ov"), seq = ++S.ovSeq;
  if (!S.ov) fill(box, loading("Loading the latest numbers\u2026"));
  box.classList.add("busy"); box.setAttribute("aria-busy", "true");
  try {
    const ov = await api("/admin/api/overview");
    if (seq !== S.ovSeq) return;
    renderOverview(ov);   /* kept only once it has drawn, so a failed first draw shows an error instead of "Loading" forever */
    S.ov = ov; S.ovAt = Date.now(); stamp();
    if (S.tab === "diagnose") prepDiag();
  } catch (e) {
    if (e.status === 401 || seq !== S.ovSeq) return;
    if (S.ov) toast("Could not refresh: " + e.message, true);
    else fill(box, note("bad", "Could not load the overview. " + e.message, loadOverview));
  } finally { if (seq === S.ovSeq) { box.classList.remove("busy"); box.removeAttribute("aria-busy"); } }
}
function renderOverview(ov) {
  fill($("#ov"), [banner(ov), tiles(ov), marketsCard(ov), h("div", { class: "two" }, [alertsCard(ov), aiCard(ov)]),
    routesCard(ov), errorsCard(ov), h("div", { class: "two" }, [topCard(ov), auditCard(ov)])]);
  /* the late list reads every member, so it loads when the owner asks for it (then at most every 5 minutes) */
  const a = ov.alerts;
  if (!(a && a.late > 0)) { S.late = null; S.lateOpen = false; }
  else if (S.lateOpen && (!S.late || Date.now() - S.lateAt > 300000)) loadLate();
}
function pools(ov) { return ov && ov.ai && Array.isArray(ov.ai.pools) ? ov.ai.pools : null; }
function poolPct(p) { return p.pct != null ? Number(p.pct) : p.limit ? (Number(p.used) || 0) / p.limit * 100 : 0; }
function problems(ov) {
  const p = [];
  const iss = Array.isArray(ov.issues) ? ov.issues : [];
  iss.forEach(x => {
    const k = String(x && typeof x === "object" ? x.section || x.what || x.error || "" : x);
    p.push({ lv: "warning", text: ISSUES[k] ? "Could not load " + ISSUES[k] + "." : k });
  });
  (Array.isArray(ov.uptime) ? ov.uptime : []).forEach(u => {
    if (u && u.down) p.push({ lv: "critical", go: "markets", text: srcName(u.source) + " is down: its last test search " + (u.lastErr ? "failed (" + u.lastErr + ")." : "found nothing.") });
  });
  const t = ov.traffic && ov.traffic.totals;
  if (t && t.n > 0 && errPct(t) > 5) p.push({ lv: "critical", go: "errors", text: pc(errPct(t)) + " of requests failed in the last 24 hours (" + plural(t.e5, "error", "errors") + ")." });
  const a = ov.alerts;
  if (a) {
    const c = a.lastCron;
    /* cronRuns24h is null when the run log itself could not be read; that is reported via issues, not as "no runs" */
    if (!c) { if (a.cronRuns24h != null) p.push({ lv: "warning", go: "alerts", text: "No alert email run has been recorded yet. They normally run every few minutes." }); }
    else if (Number(c.ageMin) > 15) p.push({ lv: "critical", go: "alerts", text: "Alert emails last ran " + ago(c.ageMin) + ". They normally run every few minutes." });
    if (a.late > 0) p.push({ lv: "warning", go: "alerts", text: plural(a.late, "member's email is", "members' emails are") + " late today." });
    if (a.cronFails24h > 0) p.push({ lv: "warning", go: "alerts", text: plural(a.cronFails24h, "alert run", "alert runs") + " hit a problem in the last 24 hours." });
  }
  (pools(ov) || []).forEach(x => {
    const v = poolPct(x);
    if (v >= 90) p.push({ lv: v >= 100 ? "critical" : "warning", go: "ai", text: (x.name || x.key) + (v >= 100 ? " has used all of today's limit (" : " has used " + pc(v) + " of today's limit (") + num(x.used) + " of " + num(x.limit) + ")." });
  });
  return p;
}
function jump(where) {
  if (where === "errors") { go("errors"); return; }
  const el = $("#ov-" + where);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); el.focus({ preventScroll: true }); }
}
function banner(ov) {
  const p = problems(ov);
  /* before the first hourly check (a fresh deploy) there is nothing to say about the marketplaces yet */
  const unchecked = Array.isArray(ov.uptime) && !ov.uptime.length;
  if (!p.length) return h("section", { class: "banner ok", "aria-label": "Status" }, [icon("good", true), h("div", [h("h2", { text: unchecked ? "No problems found" : "All systems normal" }),
    h("p", { text: unchecked ? "No marketplace has been checked yet (a test search runs every hour, or press Run health check now). Alert emails are on time and nothing is near a limit."
      : "Every marketplace answered its last check, alert emails are on time and nothing is near a limit." })])]);
  const worst = p.some(x => x.lv === "critical") ? "critical" : "warning";
  p.sort((x, y) => (x.lv === "critical" ? 0 : 1) - (y.lv === "critical" ? 0 : 1));
  return h("section", { class: "banner " + worst, "aria-label": "Status" }, [icon(worst, true), h("div", { class: "grow" }, [
    h("h2", { text: plural(p.length, "problem", "problems") }),
    h("ul", p.map(x => h("li", [st(x.lv, x.lv === "critical" ? "Urgent" : "Heads up"), h("span", { class: "txt" }, [x.text, " ",
      x.go ? h("button", { class: "lnk", type: "button", text: x.go === "errors" ? "See errors" : "Show", onclick: () => jump(x.go) }) : null])])))])]);
}
function tile(label, value, sub, extra) {
  return h("div", { class: "tile" }, [h("div", { class: "tl", text: label }), h("div", { class: "tv", text: value }),
    sub ? h("div", { class: "ts" }, sub) : null, extra || null]);
}
function tiles(ov) {
  const m = ov.members, a = ov.alerts, tr = ov.traffic, up = Array.isArray(ov.uptime) ? ov.uptime : null;
  const live = tr && (tr.live || null), tot = tr && tr.totals, ser = tr && tr.series;
  const T = [];
  T.push(tile("Members", m ? num(m.total) : "\u2014", m ? [num(m.pro) + " Pro" + (m.gifted ? " (" + num(m.gifted) + " free Pro)" : ""), m.trial ? num(m.trial) + " on trial" : null,
    num(m.new7d) + " new this week"].filter(Boolean).join(" \u00b7 ") : "Could not load"));
  const counts = a && a.sentToday != null ? a : null;   /* per-member counts are null when the member list failed */
  const checked = counts && (a.checkedToday != null ? a.checkedToday : a.huntsCheckedToday);
  T.push(tile("Active hunts", m ? num(m.activeHunts) : "\u2014", m && counts ? [checked != null ? num(checked) + " checked today" : null,
    num(a.huntsLeftToday) + " left today"].filter(Boolean).join(" \u00b7 ") : m ? num(m.hunts) + " saved" : "Could not load"));
  T.push(tile("Emails sent today", counts ? num(a.sentToday) : "\u2014", counts ? [h("span", { text: num(a.dueToday) + " due today" }),
    a.late > 0 ? st("warning", num(a.late) + " late") : st("good", "None late")] : "Could not load"));
  if (up && up.length) {
    const vals = up.map(u => u.pct24).filter(v => v != null), down = up.filter(u => u.down).length;
    const avg = vals.length ? vals.reduce((s, v) => s + Number(v), 0) / vals.length : null;
    T.push(tile("Uptime (24 h)", avg == null ? "\u2014" : pc(avg), down ? st("critical", down + " of " + up.length + " down") : st("good", "All " + up.length + " up")));
  } else T.push(tile("Uptime (24 h)", "\u2014", up ? "No checks yet" : "Could not load"));
  T.push(tile("Requests (24 h)", tot ? num(tot.n) : "\u2014", tot ? "Pages, searches and AI" : "Could not load",
    ser && Array.isArray(ser.req) ? spark(ser.req, ser.hours || [], "req", "requests", "Requests per hour") : null));
  T.push(tile("Errors (24 h)", tot ? num(tot.e5) : "\u2014", tot ? [h("span", { text: pc(errPct(tot)) + " of requests" }), errPct(tot) > 5 ? st("critical", "High") : null] : "Could not load",
    ser && Array.isArray(ser.err5) ? spark(ser.err5, ser.hours || [], "err", "errors", "Errors per hour") : null));
  const has = live && live.n > 0;
  T.push(tile("Typical speed", has ? cap(band(pctl(live, 0.5))) : "\u2014", has ? "Half of live searches are faster" : tr ? "No live searches yet" : "Could not load"));
  T.push(tile("Slowest 5%", has ? cap(band(pctl(live, 0.95))) : "\u2014", has ? "1 in 20 live searches takes this long" : tr ? "No live searches yet" : "Could not load"));
  return h("section", { class: "tiles", "aria-label": "Key numbers" }, T);
}
/* A tap outside a sparkline closes its tooltip. One document listener for all of them (the overview re-renders
   every minute, so a listener per sparkline would pile up); entries for sparklines no longer on the page are dropped. */
const SPARKS = new Map();
D.addEventListener("pointerdown", e => { SPARKS.forEach((hide, el) => { if (!el.isConnected) SPARKS.delete(el); else if (!el.contains(e.target)) hide(); }); });
/* One series per sparkline, one hue, 2px line; the crosshair snaps to the nearest hour on hover, tap or arrow keys. */
function spark(values, keys, kind, unit, title) {
  const v = values.map(x => Number(x) || 0), n = v.length;
  if (!n || !v.some(x => x > 0)) return null;   /* a flat line at zero says nothing the value doesn't */
  const max = Math.max(1, Math.max.apply(null, v)), H = 40, pad = 4;
  const X = i => n === 1 ? 50 : i / (n - 1) * 100, Y = x => pad + (H - pad * 2) * (1 - x / max);
  const pts = v.map((x, i) => X(i).toFixed(2) + "," + Y(x).toFixed(2)).join(" ");
  const s = sv("svg", { viewBox: "0 0 100 " + H, preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  s.appendChild(sv("line", { x1: 0, x2: 100, y1: H - pad, y2: H - pad, class: "sg", "vector-effect": "non-scaling-stroke" }));
  s.appendChild(sv("polygon", { points: "0," + (H - pad) + " " + pts + " 100," + (H - pad), class: "sa" }));
  s.appendChild(sv("polyline", { points: pts, class: "sl", "vector-effect": "non-scaling-stroke" }));
  const end = h("i", { class: "se" }), hair = h("i", { class: "sx", hidden: true }), dot = h("i", { class: "sd", hidden: true }), tip = h("div", { class: "tip", hidden: true });
  end.style.left = X(n - 1) + "%"; end.style.top = (Y(v[n - 1]) / H * 100) + "%";
  const peak = v.indexOf(Math.max.apply(null, v));
  const area = h("div", { class: "sp", tabindex: "0", role: "img",
    "aria-label": title + ", last 24 hours: " + num(v[n - 1]) + " in the latest hour, most " + num(v[peak]) + (keys[peak] ? " (" + hourSpan(keys[peak]) + ")" : "") + ". Use the arrow keys for each hour." },
    [s, end, hair, dot, tip]);
  let cur = -1;
  function show(i) {
    cur = Math.max(0, Math.min(n - 1, i));
    const x = X(cur);
    hair.style.left = x + "%"; dot.style.left = x + "%"; dot.style.top = (Y(v[cur]) / H * 100) + "%";
    fill(tip, [h("b", { text: num(v[cur]) }), h("span", { text: unit }), h("span", { class: "tl2", text: keys[cur] ? " \u00b7 " + hourSpan(keys[cur]) : "" })]);
    hair.hidden = dot.hidden = tip.hidden = false; end.hidden = true;
    /* centred on the hour but kept on screen: on a phone a tile is narrower than its tooltip */
    const r = area.getBoundingClientRect(), vw = D.documentElement.clientWidth, tw = tip.offsetWidth;
    tip.className = "tip l";
    tip.style.left = Math.max(8 - r.left, Math.min(x / 100 * r.width - tw / 2, vw - 8 - r.left - tw)) + "px";
  }
  function hide() { cur = -1; hair.hidden = dot.hidden = tip.hidden = true; end.hidden = false; }
  const at = e => { const r = area.getBoundingClientRect(); return Math.round((e.clientX - r.left) / Math.max(1, r.width) * (n - 1)); };
  area.addEventListener("pointermove", e => show(at(e)));
  area.addEventListener("pointerdown", e => show(at(e)));
  area.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide(); });
  area.addEventListener("focus", () => { if (cur < 0) show(n - 1); });   /* keyboard focus; a tap or click focuses too, after its pointerdown chose the hour */
  area.addEventListener("blur", hide);
  area.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); show((cur < 0 ? n - 1 : cur) + (e.key === "ArrowLeft" ? -1 : 1)); }
    else if (e.key === "Escape") hide();
  });
  SPARKS.forEach((_, el) => { if (!el.isConnected) SPARKS.delete(el); });
  SPARKS.set(area, () => { if (cur >= 0) hide(); });
  /* the same numbers as a table for screen readers (tables ignore overflow, so the wrapper does the hiding) */
  const table = h("div", { class: "sr" }, h("table", [h("caption", { text: title + " (local time)" }), h("tbody", v.map((x, i) => h("tr", [h("th", { text: hourSpan(keys[i]) || String(i + 1) }), h("td", { text: num(x) })])))]));
  return h("div", { class: "spark s-" + kind }, [area, h("div", { class: "sxl", "aria-hidden": "true" }, [h("span", { text: "24 h ago" }), h("span", { text: "now" })]), table]);
}
function card(id, title, tools, body, sub) {
  return h("section", { class: "card", id: id ? "ov-" + id : null, tabindex: id ? "-1" : null, "aria-labelledby": id ? "h-" + id : null }, [
    h("div", { class: "ch" }, [h("h2", { id: id ? "h-" + id : null, text: title }), tools || null]),
    sub ? h("p", { class: "sub", text: sub }) : null, body]);
}
/* stack: on phones each row becomes a labelled block instead of a sideways-scrolling table (roles keep it a table for screen readers) */
function tableOf(cols, rows, caption, stack) {
  const R = stack ? n => n : null;
  return h("div", { class: "tw" + (stack ? " stack-on" : "") }, h("table", { class: stack ? "stk" : null, role: R && "table" }, [caption ? h("caption", { class: "sr", text: caption }) : null,
    h("thead", { role: R && "rowgroup" }, h("tr", { role: R && "row" }, cols.map(c => h("th", { class: c.num ? "num" : null, scope: "col", role: R && "columnheader", text: c.t })))),
    h("tbody", { role: R && "rowgroup" }, rows.map(r => h("tr", { role: R && "row" }, r.map((x, i) => {
      const nil = x == null || x === "" || (x.nodeType && !x.textContent);
      return h("td", { class: [cols[i].num ? "num" : cols[i].cls || "", nil ? "nil" : "", cols[i].bare ? "bare" : ""].join(" ").trim() || null, role: R && "cell", "data-label": stack ? cols[i].t : null }, x);
    }))))]));
}
function marketsCard(ov) {
  const up = Array.isArray(ov.uptime) ? ov.uptime : null;
  const hbox = h("div", { class: "hbox" }, healthView());
  /* the overview redraws every minute; a check still running keeps the new button disabled too */
  const btn = h("button", { class: "btn btn-s", type: "button", text: "Run health check now", disabled: !!(S.health && S.health.busy) });
  btn.addEventListener("click", async () => {
    if (S.health && S.health.busy) return;
    btn.disabled = true; S.health = { busy: true }; fill(hbox, healthView());
    try {
      const j = await api("/admin/api/healthcheck", {});
      S.health = { at: Date.now(), results: Array.isArray(j.results) ? j.results : [] };
    } catch (e) { S.health = e.status === 401 ? null : { error: e.message }; }
    btn.disabled = false; fill(hbox, healthView());
    if (S.health && S.health.results) {
      const R = S.health.results, ok = R.filter(r => r.ok).length;
      toast("Health check done: " + ok + " of " + R.length + " marketplaces answered.", ok < R.length);
      loadOverview();
    } else if (S.health && S.health.error) toast("Health check failed. " + S.health.error, true);
  });
  let body;
  if (!up) body = note("warn", "Uptime could not be loaded right now.");
  else if (!up.length) body = h("p", { class: "empty", text: "No checks yet. A test search runs on each marketplace every hour, or press Run health check now." });
  else body = tableOf([{ t: "Marketplace" }, { t: "Status", bare: 1 }, { t: "Up (24 h)", num: 1 }, { t: "Up (7 days)", num: 1 }, { t: "Last check" }, { t: "Speed", num: 1 }, { t: "Listings", num: 1 }, { t: "Note", cls: "wide" }],
    up.map(u => [h("span", { class: "term", text: srcName(u.source) }), u.down ? st("critical", "Down") : st("good", "Up"),
      u.pct24 == null ? "\u2014" : pc(u.pct24), u.pct7d == null ? "\u2014" : pc(u.pct7d),
      h("span", { class: "nw", text: lastCheck(u) }), u.lastMs == null ? "\u2014" : secs(u.lastMs), num(u.lastN),
      u.lastErr || u.down ? h("span", { class: "small", text: (u.lastErr || "Last test search failed") + (u.down ? ". " + (u.lastOkAt ? "Last worked " + fmtWhen(u.lastOkAt) + "." : "No good check in 7 days.") : "") }) : ""]),
    "Marketplaces", true);
  /* v99: the garage-sale finders, on demand */
  const sbox = h("div", { class: "hbox" }, salesView());
  const sbtn = h("button", { class: "btn btn-s", type: "button", text: "Check garage-sale sites", disabled: !!(S.sales && S.sales.busy) });
  sbtn.addEventListener("click", async () => {
    if (S.sales && S.sales.busy) return;
    sbtn.disabled = true; S.sales = { busy: true }; fill(sbox, salesView());
    try { const j = await api("/admin/api/salescheck", {}); S.sales = { at: Date.now(), results: Array.isArray(j.results) ? j.results : [] }; }
    catch (e) { S.sales = e.status === 401 ? null : { error: e.message }; }
    sbtn.disabled = false; fill(sbox, salesView());
  });
  return card("markets", "Marketplaces", btn, [body, hbox, h("div", { class: "more" }, [sbtn]), sbox], "A small test search runs on each marketplace every hour.");
}
/* lastAt = when the latest test search ran (ms); older data only has the hour it last worked */
function lastCheck(u) { const at = u.lastAt || u.lastOkAt; return at ? fmtWhen(at) : "\u2014"; }
function healthView() {
  const H = S.health;
  if (!H) return null;
  if (H.busy) return loading("Running a test search on every marketplace\u2026 this can take up to 30 seconds.");
  if (H.error) return note("bad", "Health check failed. " + H.error);
  const ok = H.results.filter(r => r.ok).length;
  return h("div", { class: "more" }, [h("h3", { class: "small", text: "Health check at " + fmtTime(new Date(H.at)) + ": " + ok + " of " + H.results.length + " answered" }),
    tableOf([{ t: "Marketplace" }, { t: "Result", bare: 1 }, { t: "Speed", num: 1 }, { t: "Listings", num: 1 }, { t: "Note", cls: "wide" }],
      H.results.map(r => [srcName(r.source), r.ok ? st("good", "Up") : st("critical", "Down"), secs(r.ms), num(r.n), r.err || (r.status && r.status !== 200 ? "Answered " + r.status : "")]),
      "Health check results", true)]);
}
const SALES_NAMES = { "estatesales-city": "EstateSales.net (Novi)", "craigslist-gms": "Craigslist garage sales (Detroit)", "craigslist-gms-rss": "Craigslist garage sales, RSS feed", yardsalesearch: "YardSaleSearch.com" };
function salesView() {
  const X = S.sales;
  if (!X) return null;
  if (X.busy) return loading("Asking the garage-sale sites from Cloudflare\u2026 up to 10 seconds.");
  if (X.error) return note("bad", "Check failed. " + X.error);
  const ok = X.results.filter(r => r.readable).length;
  return h("div", { class: "more" }, [h("h3", { class: "small", text: "Garage-sale sites at " + fmtTime(new Date(X.at)) + ": " + ok + " of " + X.results.length + " readable by Prowl" }),
    tableOf([{ t: "Site" }, { t: "Result", bare: 1 }, { t: "Answer", num: 1 }, { t: "Size", num: 1 }, { t: "Note", cls: "wide" }],
      X.results.map(r => [SALES_NAMES[r.name] || r.name, r.readable ? st("good", "Readable") : r.wall ? st("critical", "Bot wall") : st("warning", "Not readable"),
        r.status ? String(r.status) : "\u2014", num(r.bytes), r.err || (r.wall ? "It shows a robot check to Prowl." : r.readable ? "A page with content came back." : r.status === 200 ? "Almost empty page." : "")]),
      "Garage-sale sites", true)].concat(X.results.filter(r => r.shape).map(r => {
      /* v102: what the page carries, to copy and send */
      const pre = h("pre", { class: "small shape", text: r.shape });
      const cp = h("button", { class: "btn btn-s", type: "button", text: "Copy page details" });
      cp.addEventListener("click", () => { try { navigator.clipboard.writeText(r.shape).then(() => toast("Copied. Paste it to Claude."), () => toast("Could not copy. Select the text and copy it.", true)); } catch (e) { toast("Could not copy. Select the text and copy it.", true); } });
      return h("div", { class: "more" }, [h("h3", { class: "small", text: "What the " + (SALES_NAMES[r.name] || r.name) + " page carries" }), cp, pre]);
    })));
}
function alertsCard(ov) {
  const a = ov.alerts;
  if (!a) return card("alerts", "Alert emails", null, note("warn", "Alert email numbers could not be loaded right now."));
  const c = a.lastCron;
  const run = !c ? note("warn", a.cronRuns24h == null ? "The alert run log could not be loaded right now." : "No alert run recorded yet. The alert clock normally runs every few minutes.")
    : h("p", { class: "dline" }, [Number(c.ageMin) <= 15 ? st("good", "On time") : st("critical", "Late"), " Last run " + ago(c.ageMin) + (c.ms != null ? ", took " + secs(c.ms) : "") + "."]);
  const lateBox = h("div", { id: "late" });
  if (a.late > 0) fill(lateBox, lateView());
  return card("alerts", "Alert emails", null, [run,
    ov.countsAt ? h("p", { class: "hint", text: "Member numbers as of " + fmtWhen(ov.countsAt) + " (they are worked out by each alert run, every few minutes)." }) : null,
    h("dl", { class: "facts" }, [
      fact("Due today", num(a.dueToday)), fact("Sent today", num(a.sentToday)), fact("Late", a.late > 0 ? st("warning", num(a.late)) : num(a.late)),
      fact("Hunts left to check today", num(a.huntsLeftToday)), fact("Runs in last 24 h", num(a.cronRuns24h)), fact("Runs with problems (24 h)", a.cronFails24h > 0 ? st("warning", num(a.cronFails24h)) : num(a.cronFails24h))]),
    c ? h("p", { class: "hint", text: "Last run: looked at " + plural(c.members, "member", "members") + ", checked " + plural(c.checked, "hunt", "hunts") + ", sent " + plural(c.sent, "email", "emails") + (c.failed ? ", " + num(c.failed) + " failed." : ", none failed.") }) : null,
    c && Array.isArray(c.errors) && c.errors.length ? h("div", { class: "more" }, [h("h3", { class: "small", text: "Problems in the last run" }),
      h("ul", { class: "samp" }, c.errors.slice(0, 5).map(e => h("li", { class: "small", text: e })))]) : null,
    lateBox]);
}
function fact(k, v) { return h("div", [h("dt", { text: k }), h("dd", null, v)]); }
async function loadLate() {
  S.lateOpen = true; S.lateAt = Date.now();
  if (!S.late) { const b0 = $("#late"); if (b0) fill(b0, lateView()); }
  try {
    const j = await api("/admin/api/members?filter=late&sort=lastSent");
    S.late = Array.isArray(j.members) ? j.members : [];
  } catch (e) { S.late = e.status === 401 ? null : { error: e.message }; }
  const box = $("#late");
  if (box) fill(box, lateView());
}
function lateView() {
  const L = S.late;
  const head = h("h3", { class: "small more", text: "Late today" });
  if (!S.lateOpen) return [head, h("button", { class: "btn btn-s", type: "button", text: "Show who is late", onclick: loadLate })];
  if (!L) return [head, loading("Finding who is late\u2026")];
  if (L.error) return [head, note("warn", "Could not list late members. " + L.error)];
  if (!L.length) return [head, h("p", { class: "empty small", text: "No one is late any more." })];
  return [head, h("ul", { class: "samp" }, L.slice(0, 12).map(m => h("li", [h("button", { class: "lnk id", type: "button", text: m.id, onclick: () => openMember(m.id) }),
    h("span", { class: "muted", text: " due " + clock(m.slotHour) + (m.tz ? " " + m.tz.replace(/^.*\//, "").replace(/_/g, " ") + " time" : "") })]))),
    L.length > 12 ? h("p", { class: "hint", text: "and " + (L.length - 12) + " more on the Members tab (Late email)." }) : null];
}
function aiCard(ov) {
  const P = pools(ov);
  if (!P) return card("ai", "AI usage today", null, note("warn", "AI usage could not be loaded right now."));
  if (!P.length) return card("ai", "AI usage today", null, h("p", { class: "empty", text: "No AI limits are set." }));
  return card("ai", "AI usage today", null, h("ul", { class: "meters" }, P.map(p => {
    const v = poolPct(p), cls = v >= 100 ? " c" : v >= 90 ? " w" : "";
    const bar = h("i");
    bar.style.width = (v > 0 ? Math.min(100, Math.max(1, v)) : 0) + "%";
    return h("li", [h("div", { class: "mh" }, [h("span", { text: p.name || p.key }), h("span", { class: "v" }, [
      v >= 100 ? st("critical", "Full") : v >= 90 ? st("warning", "Nearly full") : null, num(p.used) + " of " + num(p.limit)])]),
      h("div", { class: "meter" + cls, role: "meter", "aria-valuemin": "0", "aria-valuemax": String(p.limit || 0), "aria-valuenow": String(Number(p.used) || 0), "aria-label": (p.name || p.key) + " used today" }, bar)]);
  })), "Daily limits reset at " + utcMidnight().time + " your time (midnight UTC).");
}
/* The daily limits and "today" in Top searches follow the UTC day: in Detroit it starts at 8 PM (7 PM in winter). */
function utcMidnight(prev) {
  const n = new Date(), d = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + (prev ? 0 : 1)));
  const time = d.getHours() || d.getMinutes() ? d.toLocaleTimeString([], d.getMinutes() ? { hour: "numeric", minute: "2-digit" } : { hour: "numeric" }) : "midnight";
  return { time: time, yesterday: !sameDay(d, n) };
}
function todayHint() { const u = utcMidnight(true); return "\u201cToday\u201d counts from " + u.time + (u.yesterday ? " yesterday" : "") + " your time (midnight UTC)."; }
function routesCard(ov) {
  const tr = ov.traffic;
  if (!tr) return card("routes", "Speed by page", null, note("warn", "Speed numbers could not be loaded right now."));
  const R = Array.isArray(tr.routes) ? tr.routes : [];
  if (!R.length) return card("routes", "Speed by page", null, h("p", { class: "empty", text: "No traffic recorded in the last 24 hours." }));
  const list = S.routesAll ? R : R.slice(0, 10);
  const more = R.length > 10 ? h("button", { class: "btn btn-s more", type: "button", text: S.routesAll ? "Show the busiest 10" : "Show all " + R.length, onclick: () => {
    S.routesAll = !S.routesAll; const old = $("#ov-routes"), nw = routesCard(S.ov); old.replaceWith(nw); $(".more", nw).focus(); } }) : null;
  return card("routes", "Speed by page", null, [tableOf([{ t: "Page" }, { t: "Requests", num: 1 }, { t: "From cache", num: 1 }, { t: "Typical", num: 1 }, { t: "Slowest 5%", num: 1 }, { t: "Errors", num: 1 }],
    list.map(r => [h("span", { title: r.route, text: routeName(r.route) }), num(r.n), r.hitPct == null ? "\u2014" : pc(r.hitPct), band(pctl(r, 0.5)), band(pctl(r, 0.95)),
      r.e5 ? h("span", [num(r.e5) + " (" + pc(errPct(r)) + ")"]) : "0"]), "Speed by page", true), more],
    "Last 24 hours, busiest first. \u201cFrom cache\u201d answers were saved from an earlier search, so they are instant.");
}
function errorRows(E) {
  return E.map(e => [h("span", { class: "nw", text: fmtWhen(e.t) }), routeName(e.r), h("span", { class: "nw", text: (e.s || "") + " " + codeWord(e.s) }),
    e.m ? h("span", { class: "small", text: e.m }) : "", e.q ? h("span", { class: "term", text: e.q }) : ""]);
}
const ERR_COLS = [{ t: "When" }, { t: "Page", bare: 1, cls: "nw" }, { t: "Code" }, { t: "What happened", cls: "wide" }, { t: "Search" }];
function errorsCard(ov) {
  const E = Array.isArray(ov.errors) ? ov.errors : null;
  const all = h("button", { class: "btn btn-s", type: "button", text: "All errors", onclick: () => go("errors") });
  if (!E) return card("errors", "Recent errors", all, note("warn", "Recent errors could not be loaded right now."));
  if (!E.length) return card("errors", "Recent errors", all, h("p", { class: "empty" }, st("good", "No server errors recorded recently.")));
  return card("errors", "Recent errors", all, tableOf(ERR_COLS, errorRows(E.slice(0, 8)), "Recent errors", true));
}
function topRows(T) {
  const max = Math.max(1, Math.max.apply(null, T.map(x => Number(x.requests) || 0)));
  return T.map((x, i) => {
    const b = h("i"); b.style.width = Math.max(2, (Number(x.requests) || 0) / max * 70) + "px";
    return [String(i + 1), h("span", { class: "term", text: x.term || "\u2014" }), num(x.visitors != null ? x.visitors : x.visitorDays),
      h("span", { class: "bar" }, [h("span", { text: num(x.requests) }), h("span", { class: "bt", "aria-hidden": "true" }, b)])];
  });
}
const TOP_COLS = [{ t: "#", num: 1 }, { t: "Search" }, { t: "Visitors", num: 1 }, { t: "Searches", num: 1 }];
const TRIP_COLS = [{ t: "#", num: 1 }, { t: "Going to" }, { t: "Visitors", num: 1 }, { t: "Trips", num: 1 }];
function topCard(ov) {
  const s = ov.searches;
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Period" }, [["today", "Today"], ["week", "This week"]].map(o =>
    h("button", { type: "button", "aria-pressed": S.top === o[0] ? "true" : "false", "data-k": o[0], text: o[1], onclick: () => {
      S.top = o[0]; const old = $("#ov-top"), nw = topCard(S.ov); old.replaceWith(nw); $("[data-k=" + o[0] + "]", nw).focus(); } })));
  const T = s && Array.isArray(s[S.top]) ? s[S.top] : null;   /* each period is null on its own when it failed */
  const hint = S.top === "today" ? h("p", { class: "hint", text: todayHint() }) : null;
  if (!T) return card("top", "Top searches", seg, note("warn", "Top searches could not be loaded right now."));
  return card("top", "Top searches", seg, [T.length ? tableOf(TOP_COLS, topRows(T), "Top searches") : h("p", { class: "empty", text: "No searches recorded yet for this period." }), hint]);
}
function auditRows(A) {
  return A.map(x => [h("span", { class: "nw", text: fmtWhen(x.t) }), AUDIT[x.action] || String(x.action || "\u2014"),
    /^M-[0-9a-f]{8}$/i.test(x.id || "") ? h("button", { class: "lnk id", type: "button", text: x.id, onclick: () => openMember(x.id) })
      : /^[0-9a-f]{10}$/.test(x.id || "") ? h("span", { class: "code small nw", text: "gift " + x.id }) : "",
    x.ok === false ? st("critical", "Failed") : st("good", "Done"), x.note ? h("span", { class: "small", text: x.note }) : ""]);
}
function auditCard(ov) {
  const A = Array.isArray(ov.audit) ? ov.audit : null;
  if (!A) return card("audit", "Admin activity", null, note("warn", "Admin activity could not be loaded right now."));
  if (!A.length) return card("audit", "Admin activity", null, h("p", { class: "empty", text: "Nothing yet. Sign-ins and member actions show up here." }));
  return card("audit", "Admin activity", null, tableOf([{ t: "When" }, { t: "What", bare: 1 }, { t: "Member" }, { t: "Result" }, { t: "Note" }], auditRows(A.slice(0, 15)), "Admin activity", true));
}

/* ---------- 2. Members ---------- */
const FILTER_NAMES = { all: "All", pro: "Pro", trial: "Trial", free: "Free", late: "Late email", mailoff: "Emails off", paused: "Paused", issues: "Has issues" };
D.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
  S.mFilter = b.getAttribute("data-filter");
  D.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  loadMembers();
}));
$("#msort").addEventListener("change", e => { S.mSort = e.target.value; loadMembers(); });
$("#findf").addEventListener("submit", async e => {
  e.preventDefault();
  const inp = $("#find-email"), msg = $("#find-msg"), email = inp.value.trim();
  inp.value = "";   /* gone from the page as soon as it is sent */
  if (!email) { msg.textContent = "Type the member's email address first."; return; }
  msg.textContent = "Looking\u2026";
  try {
    const j = await api("/admin/api/find", { email: email });
    msg.textContent = "";
    /* the list (and this box) is hidden once the member opens, so say it where the owner is looking */
    if (j.moved) toast("Found " + j.id + " by an email address they used before. They use a different one now.");
    if (j.id) openMember(j.id);
  } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
});
/* ---------- Affiliates (v89): one switch per program ---------- */
async function loadAff() {
  const box = $("#affbox");
  if (!S.aData) fill(box, loading("Loading affiliates\u2026"));
  try { const j = await api("/admin/api/affiliates"); S.aData = j; renderAff(j); stamp(); }
  catch (e) { if (e.status === 401) return; fill(box, note("bad", "Could not load the affiliates. " + e.message, loadAff)); }
}
function renderAff(j) {
  const P = Array.isArray(j.programs) ? j.programs : [];
  fill($("#affbox"), P.length ? P.map(affBlock) : h("p", { class: "empty", text: "No affiliate programs are set up." }));
}
/* v90: one block per program: its IDs (Save IDs), its state, and Turn on / Turn off (only once the IDs are complete) */
function affBlock(p) {
  const F = Array.isArray(p.fields) ? p.fields : [];
  const ins = F.map(f => h("input", { id: "aff-" + p.id + "-" + f.k, type: "text", autocomplete: "off", spellcheck: "false", maxlength: "48",
    value: f.value || "", placeholder: f.hint || "", "aria-describedby": "aff-" + p.id + "-" + f.k + "-hint" }));
  const save = h("button", { class: "btn btn-s", type: "submit", text: "Save IDs", "aria-label": "Save " + p.name + " IDs" });
  const form = h("form", { class: "gform", autocomplete: "off" }, [
    h("div", { class: "ggrid" }, F.map((f, i) => h("div", null, [h("label", { for: ins[i].id, text: f.label }), ins[i],
      h("p", { class: "hint", id: ins[i].id + "-hint", text: f.hint || "" })]))), save]);
  form.addEventListener("submit", e => { e.preventDefault(); saveAffIds(p, F, ins, save); });
  const b = h("button", { class: "btn btn-s" + (p.on ? "" : " btn-p"), type: "button", text: p.on ? "Turn off" : "Turn on", "aria-label": (p.on ? "Turn off " : "Turn on ") + p.name + " affiliate links" });
  if (!p.on && !p.ready) { b.disabled = true; b.title = "Save complete IDs first"; }
  b.addEventListener("click", () => setAff(p, b));
  return h("div", { class: "affp" }, [h("div", { class: "ch" }, [h("h3", { text: p.name }), h("span", { class: "muted small", text: p.net + (p.mail ? " \u00b7 Prowl page and alert emails" : " \u00b7 Prowl page only") })]), form,
    h("div", { class: "affrow" }, [p.on ? st("good", "On: links are tagged") : p.ready ? st("info", "Off: plain links") : st("warning", "Off: needs its IDs"), b])]);
}
async function saveAffIds(p, F, ins, btn) {
  const values = {};
  F.forEach((f, i) => { values[f.k] = ins[i].value.trim(); });
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving\u2026";
  try {
    const j = await api("/admin/api/affiliate/ids", { id: p.id, values: values });
    const text = j.message || "Saved.";
    $("#aff-msg").textContent = text; toast(text, j.ok === false);
    S.aData = j; renderAff(j);
  } catch (e) {
    if (e.status === 401) return;
    toast(e.message, true); $("#aff-msg").textContent = e.message; btn.disabled = false; btn.textContent = was;
  }
}
async function setAff(p, btn) {
  if (!window.confirm((p.on ? "Turn off " : "Turn on ") + p.name + " affiliate links?" + (p.on ? " Links to " + p.name + " go out plain, and no disclosure names it." : " Links to " + p.name + (p.mail ? "" : " on the Prowl page") + " go out through " + p.net + ", and " + (p.mail ? "the disclosures name it." : "the page's disclosure names it; alert emails keep plain links.")))) return;
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = "Working\u2026";
  try {
    const j = await api("/admin/api/affiliate", { id: p.id, on: !p.on });
    const text = j.message || "Saved.";
    $("#aff-msg").textContent = text; toast(text, j.ok === false);
    S.aData = j; renderAff(j);
  } catch (e) {
    if (e.status === 401) return;
    toast(e.message, true); btn.disabled = false; btn.textContent = was;
  }
}

/* ---------- Gift Pro (free service) ---------- */
const GIFT_LEN = [[0, "Forever"], [1, "1 month"], [3, "3 months"], [6, "6 months"], [12, "12 months"]];
$("#giftf").addEventListener("submit", async e => {
  e.preventDefault();
  const inp = $("#gift-email"), nt = $("#gift-note"), len = $("#gift-len"), tell = $("#gift-tell"), msg = $("#gift-msg"), btn = $("#gift-go");
  const email = inp.value.trim(), months = Number(len.value) || 0, text = nt.value.trim();
  inp.value = "";   /* gone from the page as soon as it is sent */
  if (!email) { msg.textContent = "Type their email address first."; inp.focus(); return; }
  btn.disabled = true; msg.textContent = "Saving\u2026";
  try {
    const j = await api("/admin/api/gift", { email: email, note: text, months: months, tell: !!tell.checked });
    nt.value = ""; tell.checked = true;
    if (j.emailed || !/gift them again/.test(j.message || "")) len.value = "0";   /* after a failed email the length stays, for the retry */
    fill(msg, [j.message || "Gift saved.", j.memberId ? [" ", h("button", { class: "lnk", type: "button", text: "Open " + j.memberId, onclick: () => openMember(j.memberId) })] : null]);
    S.mData = null; loadGifts(); loadMembers();
  } catch (err) { if (err.status !== 401) msg.textContent = err.message; }
  finally { btn.disabled = false; }
});
async function loadGifts() {
  const box = $("#glist"), seq = ++S.gSeq;
  if (!S.gData) fill(box, loading("Loading gifts\u2026"));
  box.classList.add("busy");
  try {
    const j = await api("/admin/api/gifts");
    if (seq !== S.gSeq) return;
    S.gData = j; S.gAt = Date.now(); renderGifts(j);
  } catch (e) {
    if (e.status === 401 || seq !== S.gSeq) return;
    fill(box, note("bad", "Could not load the gift list. " + e.message, loadGifts));
  } finally { if (seq === S.gSeq) box.classList.remove("busy"); }
}
const GIFT_COLS = [{ t: "Note" }, { t: "Status", bare: 1 }, { t: "Member" }, { t: "Added" }, { t: "Ends" }, { t: "", bare: 1 }];
function renderGifts(j) {
  const G = Array.isArray(j.gifts) ? j.gifts : [], on = G.filter(g => g.active).length;
  const off = Number(j.listOff) || 0, left = Math.max(0, (Number(j.listCount) || 0) - off);
  const list = S.giftsAll ? G : G.slice(0, 5);
  const more = G.length > 5 ? h("button", { class: "btn btn-s more", type: "button", text: S.giftsAll ? "Show the newest 5" : "Show all " + G.length, onclick: () => {
    S.giftsAll = !S.giftsAll; renderGifts(S.gData); const b = $("#glist button.more"); if (b) b.focus(); } }) : null;
  fill($("#glist"), [h("div", { class: "ch gl-h" }, [h("h3", { text: "Gifts" }), G.length ? h("span", { class: "muted small", text: num(on) + " active" + (G.length > on ? ", " + num(G.length - on) + " ended" : "") }) : null]),
    G.length ? tableOf(GIFT_COLS, list.map(giftRow), "Gifts", true) : h("p", { class: "empty", text: "No gifts yet. People you gift Pro to show up here, even before they sign up." }),
    more,
    left ? h("p", { class: "hint", text: plural(left, "more person gets", "more people get") + " free Pro from the PRO_EMAILS list in Cloudflare \u2014 turn any of them off from their member page." +
      (off ? " (" + plural(off, "address is", "addresses are") + " turned off here.)" : "") }) : null,
    j.truncated ? h("p", { class: "hint" }, st("warning", "Only the first 2,000 gifts are listed.")) : null]);
}
function giftRow(g) {
  const who = g.note ? " \u201c" + g.note + "\u201d" : g.memberId ? " for " + g.memberId : "";
  const b = h("button", { class: "btn btn-s", type: "button", text: g.active ? "Turn off" : "Remove", "aria-label": (g.active ? "Turn off the gift" : "Remove the ended gift") + who });
  b.addEventListener("click", () => removeGift(g, b));
  return [h("span", { class: g.note ? "term" : "muted", text: g.note || "(no note)" }), g.active ? st("good", "Active") : st("info", "Ended"),
    g.memberId ? h("button", { class: "lnk id", type: "button", text: g.memberId, onclick: () => openMember(g.memberId) }) : h("span", { class: "muted", text: "Not signed up yet" }),
    h("span", { class: "nw", text: g.added ? fmtDay(g.added) : "\u2014" }), h("span", { class: "nw", text: g.until ? fmtDay(g.until) : "No end" }), b];
}
async function removeGift(g, btn) {
  const who = g.memberId || (g.note ? "\u201c" + g.note + "\u201d" : "this person");
  if (!window.confirm(g.active ? "Turn off free Pro for " + who + "? They go back to the free plan unless they pay." : "Remove the ended gift for " + who + " from the list?")) return;
  const was = btn.textContent;
  btn.disabled = true; btn.textContent = "Working\u2026";
  try {
    const j = await api("/admin/api/gift/remove", { gid: g.gid });
    const text = j.message || "Gift turned off.";
    $("#gift-msg").textContent = text; toast(text, j.ok === false);
    S.mData = null; loadGifts(); loadMembers();
  } catch (e) {
    if (e.status === 401) return;
    toast(e.message, true); btn.disabled = false; btn.textContent = was;
  }
}
/* fresh: the Refresh button reads every member again now (otherwise the server keeps the list up to 10 minutes) */
async function loadMembers(fresh) {
  const box = $("#mrows"), seq = ++S.mSeq;
  if (!S.mData) fill(box, loading("Loading members\u2026"));
  box.classList.add("busy");
  try {
    const j = await api("/admin/api/members?filter=" + encodeURIComponent(S.mFilter) + "&sort=" + encodeURIComponent(S.mSort) + (fresh === true ? "&fresh=1" : ""));
    if (seq !== S.mSeq) return;
    S.mData = j; S.mAt = Date.now(); renderMembers(j); stamp();
  } catch (e) {
    if (e.status === 401 || seq !== S.mSeq) return;
    fill(box, note("bad", "Could not load members. " + e.message, loadMembers));
  } finally { if (seq === S.mSeq) box.classList.remove("busy"); }
}
function renderMembers(j) {
  const L = Array.isArray(j.members) ? j.members : [];
  const total = Number(j.total);
  const count = h("div", { class: "mcount" }, [h("span", { text: (S.mFilter === "all" ? "" : FILTER_NAMES[S.mFilter] + ": ") +
    (total > L.length ? num(L.length) + " of " + num(total) : plural(L.length, "member", "members")) }),
    j.truncated ? st("warning", "Only the first 5,000 members are listed") : null]);
  if (!L.length) {
    fill($("#mrows"), [count, h("p", { class: "empty" }, S.mFilter === "all" ? "No members yet. When someone signs up for Prowl Alerts they show up here." : "No members match \u201c" + FILTER_NAMES[S.mFilter] + "\u201d.")]);
    return;
  }
  fill($("#mrows"), [count, h("div", { class: "mlist" }, [
    h("div", { class: "mhead", "aria-hidden": "true" }, ["Member", "Plan", "Hunts", "Emails", "Last email", "Checked today", "Notes"].map(t => h("span", { text: t }))),
    L.map(mrow)])]);
}
function mrow(m) {
  return h("button", { class: "mrow", type: "button", onclick: () => openMember(m.id) }, [
    h("span", { class: "c-id", text: m.id }), h("span", { class: "c-plan" }, [planBadge(planOf(m)),
      m.via === "gift" || m.via === "list" ? h("span", { class: "bdg b-out", text: m.via === "gift" ? "Gift" : "List", title: m.via === "gift" ? "Free Pro gift" : "Free Pro from the PRO_EMAILS list" }) : null]),
    h("span", { class: "c-meta" }, [
      h("span", [h("span", { class: "lbl", text: "Hunts " }), num(m.active) + " / " + num(m.hunts)]),
      h("span", [h("span", { class: "lbl", text: "Emails " }), m.mail === "off" ? "Off" : "On"]),
      h("span", [h("span", { class: "lbl", text: "Last email " }), m.lastSent ? fmtDay(m.lastSent) : "None recorded"]),
      h("span", [h("span", { class: "lbl", text: "Checked today " }), num(m.checkedToday) + " / " + num(m.activeToday)])]),
    h("span", { class: "c-flags" }, (Array.isArray(m.flags) ? m.flags : []).map(flagChip))]);
}

/* ---------- 3. Member detail ---------- */
$("#mback").addEventListener("click", () => { if (S.pushed) history.back(); else go("members"); });
async function openMember(id, fromRoute) {
  id = normId(id);
  if (!id) return;
  /* "All members" may step back in history only when the list is the page we came from */
  if (!fromRoute) { const fromList = S.tab === "members" && !S.memberId; history.pushState(null, "", "#member/" + id); S.pushed = fromList; }
  const fresh = S.memberId !== id;
  S.memberId = id;
  $("#find-msg").textContent = "";
  selectTab("members", true);
  $("#mlist").hidden = true; $("#mdetail").hidden = false;
  const body = $("#mbody");
  if (fresh) { S.lastMsg = null; fill(body, loading("Loading " + id + "\u2026")); window.scrollTo(0, 0); }
  body.classList.add("busy");
  try {
    const m = await api("/admin/api/member?id=" + encodeURIComponent(id));
    if (S.memberId !== id) return;
    S.member = m; renderMember(m); stamp();
    if (fresh) { const t = $("#mtitle"); if (t) t.focus({ preventScroll: true }); }
  } catch (e) {
    if (e.status === 401 || S.memberId !== id) return;
    fill(body, e.status === 404 ? note("warn", "No member with id " + id + ". They may have been deleted.") : note("bad", "Could not load " + id + ". " + e.message, () => openMember(id, true)));
  } finally { body.classList.remove("busy"); }
}
function yesNo(b) { return b ? "Yes" : "No"; }
function money(amount, cur) {
  if (amount == null || amount === "") return "\u2014";
  const n = Number(amount);
  if (isNaN(n)) return String(amount) + (cur ? " " + cur : "");
  try { return new Intl.NumberFormat([], { style: "currency", currency: cur || "USD" }).format(n); } catch (e) { return n.toFixed(2) + (cur ? " " + cur : ""); }
}
function renderMember(m) {
  const plan = planOf(m), P = m.prefs || {}, pl = m.plan && typeof m.plan === "object" ? m.plan : {};
  const hunts = Array.isArray(m.hunts) ? m.hunts : [], flags = Array.isArray(m.flags) ? m.flags : [];
  const headCard = h("section", { class: "card" }, [
    h("div", { class: "dhead" }, [h("h2", { id: "mtitle", tabindex: "-1", text: m.id }), planBadge(plan), m.mail === "off" ? st("critical", "Emails off") : st("good", "Emails on"),
      m.paused ? st("warning", "Paused") : null]),
    h("p", { class: "dline", text: (m.created ? "Member since " + fmtDay(m.created) + ". " : "") + (FREQ[m.freq || P.freq] || "Emails") + " at " + clock(m.slotHour != null ? m.slotHour : P.slotHour) +
      " their time" + ((m.tz || P.tz) ? " (" + (m.tz || P.tz) + ")" : "") + "." }),
    h("dl", { class: "facts f4" }, [fact("Hunts active", num(m.active) + " of " + num(Array.isArray(m.hunts) ? m.hunts.length : m.hunts)),
      fact("Last email", m.lastSent ? fmtDay(m.lastSent) : "None recorded"), fact("Checked today", num(m.checkedToday) + " of " + num(m.activeToday)),
      fact("Email due today", m.late ? st("warning", "Late") : m.dueToday ? "Yes" : "No")])]);
  const flagsCard = h("section", { class: "card" }, [h("div", { class: "ch" }, h("h3", { text: "What needs attention" })),
    flags.length ? h("ul", { class: "flags" }, flags.map(f => h("li", [ISSUE_FLAGS.indexOf(f) >= 0 ? icon("warning") : icon("info"), h("div", [h("b", { text: cap(f) }), h("span", { class: "muted small", text: FLAGS[f] || "" })])])))
      : h("p", { class: "empty" }, st("good", "Nothing looks wrong with this account."))]);
  const huntsCard = h("section", { class: "card" }, [h("div", { class: "ch" }, [h("h3", { text: "Hunts" }), h("span", { class: "muted small", text: num(m.active) + " active of " + num(hunts.length) })]),
    hunts.length ? h("ul", { class: "hunts" }, hunts.map((x, i) => h("li", [h("div", { class: "hb" }, [
      h("div", { class: "ht" + (x.hidden ? " hid" : ""), text: x.text }),
      h("div", { class: "badges" }, [h("span", { class: "bdg" + (x.active ? "" : " b-out"), text: x.active ? "Active" : x.muted ? "Muted" : "Not active" }),
        x.active && x.muted ? h("span", { class: "bdg b-out", text: "Muted" }) : null,
        x.local ? h("span", { class: "bdg b-out", text: "Local (eBay near them)" }) : null,
        x.active ? (x.checkedToday ? h("span", { class: "bdg" }, [icon("good"), "Checked today"]) : h("span", { class: "bdg b-out", text: "Not checked yet today" })) : null])]),
      h("button", { class: "btn btn-s", type: "button", text: "Diagnose", "aria-label": "Diagnose hunt " + (i + 1), onclick: () => startDiag({ id: m.id, hunt: i, text: x.hidden ? "" : x.text, hidden: !!x.hidden }) })])))
      : h("p", { class: "empty", text: "No hunts saved." })]);
  /* two columns on wide screens; on phones the cards interleave so the actions come right after the hunts */
  [flagsCard, huntsCard].forEach((c, i) => c.classList.add("o" + (i + 1)));
  const wait = waitingCard(m), acts = actionsCard(m), set = settingsCard(m, P), pln = planCard(m, pl, plan);
  wait.classList.add("o4"); acts.classList.add("o3"); set.classList.add("o5"); pln.classList.add("o6");
  fill($("#mbody"), [headCard, h("div", { class: "two mgrid" }, [h("div", { class: "stack" }, [flagsCard, huntsCard, wait]), h("div", { class: "stack" }, [acts, set, pln])])]);
}
function settingsCard(m, P) {
  const src = Array.isArray(P.sources) ? P.sources : [];
  return h("section", { class: "card" }, [h("div", { class: "ch" }, h("h3", { text: "Settings" })), h("dl", { class: "kv" }, [
    h("dt", { text: "Emails" }), h("dd", { text: (FREQ[P.freq] || P.freq || "\u2014") + " at " + clock(P.slotHour) }),
    h("dt", { text: "Time zone" }), h("dd", { text: P.tz || "\u2014" }),
    h("dt", { text: "Marketplaces" }), h("dd", { text: src.length ? src.map(srcName).join(", ") : "All" }),
    h("dt", { text: "Max price" }), h("dd", { text: P.maxPrice ? "$" + num(P.maxPrice) : "No limit" }),
    h("dt", { text: "Skip words" }), h("dd", null, Array.isArray(P.skipWords) && P.skipWords.length ? h("span", { class: "badges" }, P.skipWords.map(w => h("span", { class: "bdg b-out", text: w }))) : "None"),
    h("dt", { text: "Paused until" }), h("dd", { text: P.pauseUntil ? fmtDay(P.pauseUntil) : "Not paused" }),
    h("dt", { text: "AI sorting" }), h("dd", { text: P.aiOff ? "Off (they turned it off)" : "On" }),
    P.filtersApply != null ? [h("dt", { text: "Their filters" }), h("dd", { text: P.filtersApply ? "In use" : "Not in use (sites, max price and skip words are Pro features)" })] : null,
    m.mailOffDay ? [h("dt", { text: "Emails off since" }), h("dd", { text: fmtDay(m.mailOffDay) })] : null,
    h("dt", { text: "Local hunts" }), h("dd", { text: P.zipSet ? "ZIP code set, within " + num(P.radius) + " miles, " + plural(P.localHunts, "local hunt", "local hunts") : "No ZIP code set" })])]);
}
/* What free Pro this member has, in plain words: the gift (with its end and note) and the Cloudflare list. */
function giftLines(g) {
  const L = [];
  if (!g || typeof g !== "object") return L;
  if (g.listed) L.push(g.listOff ? "In the Cloudflare list (PRO_EMAILS), but turned off here" : "Free Pro from the Cloudflare list");
  if (g.source === "gift" || g.ended || g.added) L.push((g.ended ? "Free Pro gift ended " + (g.until ? fmtDay(g.until) : "") : "Free Pro gift \u2014 " + (g.until ? "ends " + fmtDay(g.until) : "no end")) +
    (g.note ? " (" + g.note + ")" : ""));
  if (g.earlier && L.length) L.push("This is for an email address they used before.");
  return L;
}
const GIFT_ON = { a: "gift-on", t: "Gift Pro", box: "mplan" }, GIFT_OFF = { a: "gift-off", t: "Turn off free Pro", box: "mplan" };
function giftBox(m) {
  const g = m.gift;
  if (!g || typeof g !== "object") return null;
  const sel = h("select", { id: "gl-len" }, GIFT_LEN.map(o => h("option", { value: String(o[0]), text: o[1] })));
  if (S.glen && S.glen.id === m.id) sel.value = S.glen.v;   /* the length last picked for this member stays, e.g. for a retry */
  sel.addEventListener("change", () => { S.glen = { id: m.id, v: sel.value }; });
  const on = h("button", { class: "btn btn-s btn-p", type: "button", text: g.source === "gift" ? "Gift Pro again" : "Gift Pro", "aria-describedby": "gl-help" });
  const tell = h("input", { id: "gl-tell", type: "checkbox", checked: true });
  on.addEventListener("click", () => doAction(m.id, GIFT_ON, null, on, { months: Number(sel.value) || 0, tell: !!tell.checked }));
  const off = g.active ? h("button", { class: "btn btn-s", type: "button", text: "Turn off free Pro", "aria-describedby": "gl-help" }) : null;
  if (off) off.addEventListener("click", () => {
    if (window.confirm("Turn off free Pro for " + m.id + "? They go back to the free plan unless they pay.")) doAction(m.id, GIFT_OFF, null, off);
  });
  const help = g.source === "list" ? "Their address is in the PRO_EMAILS list in Cloudflare. Turn off free Pro stops that here, without editing Cloudflare."
    : g.source === "gift" ? "Gift Pro again sets a new end, counted from today. Turn off free Pro ends the gift now; they keep Pro only if they pay."
    : "Gives them Prowl Pro free, starting now. Forever means until you turn it off." + (g.listOff ? " It also turns the Cloudflare list back on for them." : "");
  return h("div", { class: "gbox" }, [h("h4", { text: "Gift Pro (free service)" }),
    h("div", { class: "frow" }, [h("label", { for: "gl-len", text: "How long" }), sel, on]),
    h("label", { class: "ck" }, [tell, "Email them that Pro is on"]), off ? h("div", off) : null,
    h("p", { id: "gl-help", class: "hint", text: help })]);
}
function planCard(m, pl, plan) {
  const last = S.lastMsg && S.lastMsg.id === m.id && S.lastMsg.box === "mplan" ? note(S.lastMsg.ok ? "ok" : "bad", S.lastMsg.text) : null;
  if (last) last.classList.add("lastmsg");
  const gl = giftLines(m.gift);
  return h("section", { class: "card", id: "mplan" }, [h("div", { class: "ch" }, h("h3", { text: "Plan and sign-in" })), last, h("dl", { class: "kv" }, [
    h("dt", { text: "Plan" }), h("dd", null, planBadge(plan)),
    h("dt", { text: "How" }), h("dd", { text: VIA[pl.via || m.via] || pl.via || m.via || "\u2014" }),
    m.gift ? [h("dt", { text: "Free Pro" }), h("dd", null, gl.length ? gl.map(t => h("div", { text: t })) : "None")] : null,
    h("dt", { text: "Trial" }), h("dd", { text: pl.trial === true ? "Yes" : pl.trial ? String(pl.trial) : "No" }),
    h("dt", { text: "Paid" }), h("dd", { text: pl.paidDay ? fmtDay(pl.paidDay) : "\u2014" }),
    h("dt", { text: "Renews" }), h("dd", { text: pl.renewsDay ? fmtDay(pl.renewsDay) : "\u2014" }),
    h("dt", { text: "Amount" }), h("dd", { text: money(pl.amount, pl.currency) }),
    h("dt", { text: "Order" }), h("dd", { text: pl.order || "\u2014" }),
    pl.hadPro != null ? [h("dt", { text: "Had Pro before" }), h("dd", { text: yesNo(pl.hadPro) })] : null,
    pl.checkedDay ? [h("dt", { text: "Pro last checked" }), h("dd", { text: fmtDay(pl.checkedDay) })] : null,
    h("dt", { text: "Sign-in link waiting" }), h("dd", { text: yesNo(m.signinWaiting) }),
    h("dt", { text: "Address confirm waiting" }), h("dd", { text: yesNo(m.confirmWaiting) }),
    h("dt", { text: "Address change waiting" }), h("dd", { text: yesNo(m.moveWaiting) }),
    h("dt", { text: "Earlier addresses" }), h("dd", { text: num(m.previousAddresses || 0) + (m.movedAt ? ", last change " + fmtDay(m.movedAt) : "") }),
    h("dt", { text: "Listings already emailed" }), h("dd", { text: num(m.seenCount || 0) })]), giftBox(m)]);
}
function waitingCard(m) {
  const W = m.pending || {}, list = Array.isArray(W.hunts) ? W.hunts : [];
  return h("section", { class: "card" }, [h("div", { class: "ch" }, [h("h3", { text: "Waiting for the next email" }), h("span", { class: "muted small", text: plural(W.total || 0, "listing", "listings") })]),
    list.length ? h("div", { class: "waits" }, list.map(x => h("div", [h("h4", { text: (x.text || "\u2014") + " (" + num(x.n) + ")" }),
      h("ul", { class: "samp" }, (Array.isArray(x.sample) ? x.sample : []).slice(0, 3).map(s => {
        const u = https(s.url);
        return h("li", [u ? h("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: s.title || "(no title)" }) : h("span", { text: s.title || "(no title)" }),
          h("span", { class: "muted", text: " \u00b7 " + [s.price, srcName(s.src)].filter(Boolean).join(" \u00b7 ") })]);
      }))])))
      : h("p", { class: "empty", text: "Nothing waiting. New listings the checks find collect here until their email goes out." })]);
}
const ACTIONS = [
  { a: "signin-link", t: "Send sign-in link", p: "Emails them a one-time link to their alerts page. Use it when they cannot sign in. It works once, for 24 hours." },
  { a: "refresh-pro", t: "Re-check Pro", p: "Asks the shop again whether they have Prowl Pro. Use it when they paid but still see the free plan." },
  { a: "recheck-today", t: "Re-check hunts today", p: "Starts today's checks over, so every hunt is searched again over the next alert runs (every few minutes). If today's email has not gone out yet, it still goes today." },
  { a: "resend-today", t: "Send today's email again", p: "If today's email went out, sends it again in a few minutes (for example when it never arrived), with anything new added. If no email went out today, it only checks their hunts again, and sends one only if something new turns up." },
  { a: "mail-off", t: "Turn emails off", p: "Stops their alert emails. Their hunts and plan stay as they are; listings waiting for their next email are dropped.", when: m => m.mail !== "off" },
  { a: "mail-on", t: "Turn emails on", p: "Starts their alert emails again (for example after an accidental unsubscribe), from their next email day after today.", when: m => m.mail === "off" },
  { a: "unpause", t: "Unpause", p: "Ends their pause now, so emails start again on their next email day.", when: m => !!m.paused },
  { a: "signout-all", t: "Sign out all devices", p: "Signs them out everywhere, for example if they think someone else has access. They can sign back in with a new link.", confirm: true },
  { a: "clear-seen", t: "Clear \u201calready sent\u201d memory", p: "Prowl remembers every listing it has emailed so it never sends one twice. Clearing this lets older listings come back in their next email.", confirm: true },
  { a: "delete", t: "Delete member", p: "Removes their account, hunts, settings and waiting listings for good. This cannot be undone.", confirm: true, danger: true }
];
function actionsCard(m) {
  const last = S.lastMsg && S.lastMsg.id === m.id && S.lastMsg.box === "acts" ? note(S.lastMsg.ok ? "ok" : "bad", S.lastMsg.text) : null;
  if (last) last.classList.add("lastmsg");
  return h("section", { class: "card", id: "acts" }, [h("div", { class: "ch" }, h("h3", { text: "Help this member" })), last,
    h("ul", { class: "acts" }, ACTIONS.filter(x => !x.when || x.when(m)).map(x => actionItem(m, x)))]);
}
function actionItem(m, x) {
  const li = h("li");
  const btn = h("button", { class: "btn btn-s" + (x.danger ? " btn-d" : ""), type: "button", text: x.t });
  put(li, [btn, h("p", { text: x.p })]);
  if (!x.confirm) { btn.addEventListener("click", () => doAction(m.id, x, null, btn)); return li; }
  btn.addEventListener("click", () => {
    if ($(".conf", li)) return;
    const inp = h("input", { type: "text", autocomplete: "off", spellcheck: "false", id: "cf-" + x.a, "aria-describedby": "cfh-" + x.a });
    const go2 = h("button", { class: "btn btn-s" + (x.danger ? " btn-d" : " btn-p"), type: "button", text: "Confirm", disabled: true });
    const cancel = h("button", { class: "btn btn-s", type: "button", text: "Cancel" });
    const box = h("div", { class: "conf" }, [h("label", { for: "cf-" + x.a, text: "Type " + m.id + " to confirm" }),
      h("p", { id: "cfh-" + x.a, class: "small muted", text: x.danger ? "This cannot be undone." : "This makes sure the right member is changed." }),
      h("div", { class: "frow" }, [inp, go2, cancel])]);
    inp.addEventListener("input", () => { go2.disabled = inp.value.trim().toUpperCase() !== m.id.toUpperCase(); });
    inp.addEventListener("keydown", e => { if (e.key === "Enter" && !go2.disabled) go2.click(); });
    cancel.addEventListener("click", () => { box.remove(); btn.disabled = false; btn.focus(); });
    go2.addEventListener("click", () => doAction(m.id, x, m.id, go2));
    btn.disabled = true; li.appendChild(box); inp.focus();
  });
  return li;
}
/* extra: more fields for the request (a gift's length); x.box: the card that shows the result ("acts" or "mplan") */
async function doAction(id, x, confirm, btn, extra) {
  const was = btn.textContent, box = x.box || "acts";
  btn.disabled = true; btn.textContent = "Working\u2026";
  try {
    const body = Object.assign({ id: id, action: x.a }, extra || {});
    if (confirm) body.confirm = confirm;
    const j = await api("/admin/api/member/action", body);
    const text = j.message || (j.ok ? "Done." : "That did not work.");
    S.lastMsg = { id: id, ok: j.ok !== false, text: text, box: box };
    toast(text, j.ok === false);
    S.mData = null;   /* the list is out of date now */
    if (box === "mplan") S.gData = null;
    if (x.a === "delete" && j.ok !== false) { S.member = null; go("members"); return; }
    if (j.member && j.member.id === id) { S.member = j.member; renderMember(j.member); } else openMember(id, true);
    const a = $("#" + box); if (a) a.scrollIntoView({ block: "nearest" });
  } catch (e) {
    if (e.status === 401) return;
    S.lastMsg = { id: id, ok: false, text: e.message, box: box };
    toast(e.message, true);
    btn.disabled = false; btn.textContent = was;
    if (S.member) renderMember(S.member);
  }
}

/* ---------- 4. Diagnose ---------- */
function sourcesKnown() {
  const ls = S.ov && Array.isArray(S.ov.liveSources) ? S.ov.liveSources.filter(Boolean) : [];
  const up = S.ov && Array.isArray(S.ov.uptime) ? S.ov.uptime.map(u => u.source).filter(Boolean) : [];
  const list = ls.length ? ls : up.length ? up : DEFAULT_SOURCES.slice();
  return list.filter((s, i) => list.indexOf(s) === i);
}
function prepDiag() {
  if (!S.ov && !S.ovSeq) loadOverview();
  const box = $("#dsrc"), list = sourcesKnown();
  if (!S.dSel) S.dSel = {};
  fill(box, list.map(s => {
    const c = h("input", { type: "checkbox", value: s, checked: S.dSel[s] !== false });
    c.addEventListener("change", () => { S.dSel[s] = c.checked; });
    return h("label", { class: "ck" }, [c, srcName(s)]);
  }));
  const f = S.diag, from = $("#dfrom"), term = $("#dterm");
  if (f && f.hunt != null) {
    fill(from, [h("span", [h("b", { text: "Hunt " + (f.hunt + 1) }), " of ", h("b", { text: f.id }), f.hidden ? " (the hunt text is hidden because it looks personal)" : ""]),
      h("button", { class: "lnk", type: "button", text: "Back to member", onclick: () => openMember(f.id) }),
      h("button", { class: "lnk", type: "button", text: "Type a different search", onclick: () => { S.diag = null; term.disabled = false; term.value = ""; prepDiag(); term.focus(); } })]);
    from.hidden = false;
  } else { from.hidden = true; fill(from, null); }
}
$("#dall").addEventListener("click", () => {
  const boxes = Array.prototype.slice.call(D.querySelectorAll("#dsrc input"));
  const on = !boxes.every(b => b.checked);
  boxes.forEach(b => { b.checked = on; S.dSel[b.value] = on; });
});
$("#dterm").addEventListener("input", () => { if (S.diag && S.diag.hunt != null && !S.diag.hidden) { S.diag = { id: S.diag.id }; prepDiag(); } });
function startDiag(ctx) {
  S.diag = ctx;
  history.pushState(null, "", "#diagnose");
  selectTab("diagnose");
  const term = $("#dterm");
  term.value = ctx.hidden ? "" : ctx.text || "";
  term.disabled = !!ctx.hidden;
  term.placeholder = ctx.hidden ? "(hidden hunt)" : "e.g. roseville pottery";
  $("#dmember").value = ctx.id || "";
  runDiag();
}
$("#dform").addEventListener("submit", e => { e.preventDefault(); runDiag(); });
async function runDiag() {
  const out = $("#dout"), msg = $("#dmsg");
  const term = $("#dterm").value.trim(), typed = $("#dmember").value.trim(), mid = normId(typed) || typed;
  const sources = Array.prototype.slice.call(D.querySelectorAll("#dsrc input")).filter(b => b.checked).map(b => b.value);
  const body = { sources: sources };
  const f = S.diag;
  msg.textContent = "";
  if (f && f.hunt != null && (!mid || mid === f.id)) { body.id = f.id; body.hunt = f.hunt; }
  else {
    if (!term) { msg.textContent = "Type a search term, or open a member and press Diagnose on one of their hunts."; return; }
    body.term = term;
    if (mid) { if (!/^M-[0-9a-f]{8}$/i.test(mid)) { msg.textContent = "Member ids look like M-1a2b3c4d. Leave it empty to search without anyone's filters."; return; } body.id = mid; }
  }
  if (!sources.length) { msg.textContent = "Pick at least one marketplace."; return; }
  const seq = ++S.diagSeq, run = $("#drun");
  run.disabled = true;
  const say = $("#dstatus");
  say.textContent = "Searching " + plural(sources.length, "marketplace", "marketplaces") + "\u2026";
  fill(out, loading("Searching " + plural(sources.length, "marketplace", "marketplaces") + " live\u2026 this can take up to 30 seconds."));
  try {
    const j = await api("/admin/api/diagnose", body);
    if (seq !== S.diagSeq) return;
    S.diagRes = j; S.diagShow = "all"; renderDiag(j);
    const sm = j.summary || {}, live = aiLive(j);
    say.textContent = "Done: " + num(sm.ok) + " of " + num(sm.sources) + " marketplaces answered, " + plural(sm.items, "listing", "listings") + " found, " +
      (live ? "AI hides " + num(sm.aiDropped) : "AI would hide " + num(sm.aiWould != null ? sm.aiWould : sm.aiDropped) + " if AI sorting were on") + ".";
  } catch (e) {
    if (e.status === 401 || seq !== S.diagSeq) return;
    say.textContent = "";
    fill(out, note("bad", "Diagnose did not finish. " + e.message, runDiag));
  } finally { if (seq === S.diagSeq) run.disabled = false; }
}
function aiBadge(it) {
  if (!it.ai) return null;
  let p = it.aiP == null ? null : Number(it.aiP);
  if (p != null && p <= 1) p = p * 100;
  return h("span", { class: "bdg" }, "AI: " + (AI[it.ai] || it.ai) + (p == null || isNaN(p) ? "" : " " + Math.round(p) + "%"));
}
/* jevClean's info.status per marketplace. Diagnose runs it in shadow mode, so "tagged" is the normal good answer;
   "off for this member" is already explained once above the results. */
const AI_FINE = /^(ok|tagged|on|shadow|done|live|empty|off for this member)$/i;
const AI_STATUS = { "no key": "AI sorting is not set up (no AI key), so the AI did not check these listings.",
  "daily cap": "AI sorting reached today's limit, so the AI did not check these listings.",
  "jev failed": "The AI check did not answer, so the AI did not check these listings.",
  "AI check failed": "The AI check failed, so the AI did not check these listings.",
  off: "AI sorting is switched off, so the AI did not check these listings." };
function leftOut(it) { return !!(it.aiDrop || it.memberDrop || it.notExact || it.alreadySent); }
/* the server says whether the AI really hides listings right now (JEV_RESULTS "on", and for a member's emails ALERT_JEV
   and their own switch); older answers without it are read as on */
function aiLive(j) { return !(j && j.ai && j.ai.live === false); }
function itemRow(it) {
  const u = https(it.url), img = https(it.image), out = leftOut(it);
  return h("li", { class: "item" + (out ? " out" : "") }, [
    img ? h("img", { src: img, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer", width: "64", height: "64" }) : h("span", { class: "noimg", "aria-hidden": "true" }),
    h("div", { class: "ib" }, [
      u ? h("a", { class: "it", href: u, target: "_blank", rel: "noopener noreferrer", text: it.title || "(no title)" }) : h("span", { class: "it", text: it.title || "(no title)" }),
      h("div", { class: "ip", text: [it.price, srcName(it.src)].filter(Boolean).join(" \u00b7 ") }),
      h("div", { class: "badges" }, [aiBadge(it), it.aiDrop ? h("span", { class: "bdg b-pro", text: "AI hides" }) : it.aiWould ? h("span", { class: "bdg b-out", text: "AI would hide (not on)" }) : null,
        it.memberDrop ? h("span", { class: "bdg b-trial", text: "Their filter: " + it.memberDrop }) : null,
        it.notExact ? h("span", { class: "bdg b-out", text: "Not an exact match" }) : null,
        it.alreadySent ? h("span", { class: "bdg b-out", text: "Already emailed" }) : null,
        it.waiting ? h("span", { class: "bdg b-out", text: "Waiting for their next email" }) : null]),
      h("div", { class: "io" }, out ? st("serious", "Left out") : st("good", "Kept"))])]);
}
function legend() {
  const rows = [["AI: Match", "Prowl's AI thinks it is what was searched for."], ["AI: Lot or set", "A bundle that includes the item among other things."],
    ["AI: Reproduction", "Likely a new copy, reissue or 'style' piece rather than an original."], ["AI: Part or accessory", "A part, lid, manual or box rather than the piece itself."],
    ["AI: Wrong item", "Only shares a word with the search (a person, a card, a different object)."], ["AI: Match 85%", "The number is how sure the AI is."],
    ["AI hides", "Part or wrong item, 70% sure or more: left out of emails and live results while AI sorting is switched on."],
    ["AI would hide (not on)", "The AI flags it, but AI sorting is not switched on where these results go, so it is still shown and emailed."],
    ["Their filter", "The member's own settings leave it out (their sites, max price or skip words)."],
    ["Already emailed", "They were sent this listing before, so it is not sent again."],
    ["Waiting for their next email", "An earlier check already found it, so it goes out in their next email."]];
  const d = h("details", { class: "legend card", open: S.legendOpen !== false }, [h("summary", { text: "What the badges mean" }),
    h("dl", rows.map(r => [h("dt", null, h("span", { class: "bdg" + (r[0] === "AI hides" ? " b-pro" : r[0] === "Their filter" ? " b-trial" : r[0] === "Already emailed" || r[0] === "AI would hide (not on)" || r[0] === "Waiting for their next email" ? " b-out" : ""), text: r[0] })), h("dd", { text: r[1] })]))]);
  d.addEventListener("toggle", () => { S.legendOpen = d.open; });
  return d;
}
function renderDiag(j) {
  const sm = j.summary || {}, R = Array.isArray(j.results) ? j.results : [], mb = j.member;
  const notes = [];
  if (mb) {
    const fl = mb.filters || {};
    const parts = [Array.isArray(fl.sources) && fl.sources.length ? "sites: " + fl.sources.map(srcName).join(", ") : "all sites",
      fl.maxPrice ? "max price $" + num(fl.maxPrice) : "no max price",
      Array.isArray(fl.skipWords) && fl.skipWords.length ? "skip words: " + fl.skipWords.join(", ") : "no skip words"];
    notes.push(note("info", "Using " + mb.id + "'s settings (" + parts.join("; ") + ")" + (mb.pro ? ", Pro member." : ".")));
    if (mb.aiOff) notes.push(note("warn", "This member turned AI sorting off, so the AI was not run and hides nothing for them."));
  } else notes.push(note("info", "No member chosen, so only the AI is applied (as in live results on the Prowl page)."));
  const live = aiLive(j), ai = j.ai || {};
  if (!live && !(mb && mb.aiOff)) notes.push(note("warn", ai.mode !== "on" ? "AI sorting is not switched on (JEV_RESULTS is \u201c" + (ai.mode || "off") + "\u201d in Cloudflare): the AI labels listings but hides nothing, in live results or emails."
    : "AI sorting is switched off for alert emails (ALERT_JEV is \u201coff\u201d in Cloudflare): the AI labels listings but hides nothing from emails."));
  if (j.hunt === "muted") notes.push(note("warn", "They muted this hunt, so their emails do not search it at all."));
  else if (j.hunt === "over plan limit") notes.push(note("warn", "This hunt is past the number of hunts their plan checks, so their emails do not search it at all."));
  if (j.local) notes.push(note("info", j.localOnly ? "This is a local hunt: their emails search only eBay, near their ZIP code, so that is what was searched here (the ZIP is not shown)."
    : "This is a local hunt: their emails search eBay near their ZIP code (the ZIP is not shown)."));
  const summary = h("section", { class: "card" }, [h("div", { class: "ch" }, h("h2", { text: "Results for \u201c" + (j.term || "") + "\u201d" })),
    h("dl", { class: "dsum" }, [fact("Marketplaces answered", num(sm.ok) + " of " + num(sm.sources)), fact("Listings found", num(sm.items)),
      live ? fact("AI hides", num(sm.aiDropped)) : fact("AI would hide (not on)", num(sm.aiWould != null ? sm.aiWould : sm.aiDropped)),
      fact("Their filters hide", mb ? num(sm.memberDropped) : "\u2014"), fact("Not exact (left out)", mb ? num(sm.notExact) : "\u2014"), fact("Already emailed", mb ? num(sm.alreadySent) : "\u2014")]),
    h("div", { class: "stack more" }, notes)]);
  const show = h("div", { class: "chips", role: "group", "aria-label": "Show listings" }, [["all", "All listings"], ["out", "Left out"], ["kept", "Kept"]].map(o =>
    h("button", { class: "chip", type: "button", "aria-pressed": S.diagShow === o[0] ? "true" : "false", "data-k": o[0], text: o[1], onclick: () => {
      S.diagShow = o[0]; renderDiag(S.diagRes); const b = $("#dout [data-k=" + o[0] + "]"); if (b) b.focus(); } })));
  fill($("#dout"), [summary, legend(), R.length ? show : null, R.length ? R.map(sourceCard) : note("warn", "No marketplaces were searched.")]);
}
function sourceCard(r) {
  const ok = r.status === 200 && !r.err;
  const items = Array.isArray(r.items) ? r.items : [];
  const shown = items.filter(it => S.diagShow === "all" || (S.diagShow === "out" ? leftOut(it) : !leftOut(it)));
  const live = aiLive(S.diagRes), ai = items.filter(it => live ? it.aiDrop : it.aiWould).length, mine = items.filter(it => it.memberDrop).length, sent = items.filter(it => it.alreadySent).length, wait = items.filter(it => it.waiting).length;
  const list = h("ul", { class: "items" });
  const LIMIT = 12;
  put(list, shown.slice(0, LIMIT).map(itemRow));
  const more = shown.length > LIMIT ? h("button", { class: "btn btn-s more", type: "button", text: "Show all " + shown.length }) : null;
  if (more) more.addEventListener("click", () => { put(list, shown.slice(LIMIT).map(itemRow)); more.remove(); });
  return h("section", { class: "card" }, [
    h("div", { class: "srch" }, [h("h3", { text: srcName(r.source) }), ok ? st("good", "Answered") : st("critical", "Failed"), h("span", { class: "muted small", text: r.ms != null ? "in " + secs(r.ms) : "" })]),
    h("p", { class: "cnt", text: [num(r.count != null ? r.count : items.length) + " found", ai + (live ? " AI hides" : " AI would hide (not on)"), mine + " their filters hide", sent + " already emailed"].concat(wait ? [wait + " waiting for their next email"] : [],
      [num(r.kept != null ? r.kept : items.length - items.filter(leftOut).length) + " kept"]).join(" \u00b7 ") }),
    !ok ? note("bad", r.err || ("Answered " + (r.status || "nothing"))) : null,
    r.ai && !AI_FINE.test(r.ai) && items.length ? note("warn", AI_STATUS[r.ai] || "AI: " + r.ai) : null,
    r.aiAllFlagged ? note("info", "The AI flagged every listing here, so it hides none of them (it never empties a list).") : null,
    ok && !items.length ? h("p", { class: "empty", text: "No listings came back for this search." }) : null,
    items.length && !shown.length ? h("p", { class: "empty", text: "None in this view." }) : null,
    shown.length ? list : null, more]);
}

/* ---------- 5. Errors ---------- */
async function loadErrors() {
  const box = $("#errbox"), seq = ++S.errSeq;
  if (!box.firstChild) fill(box, loading());
  box.classList.add("busy");
  try {
    const j = await api("/admin/api/errors?limit=100");
    if (seq !== S.errSeq) return;
    const E = Array.isArray(j.errors) ? j.errors : [];
    fill(box, E.length ? tableOf(ERR_COLS, errorRows(E), "Errors", true) : h("p", { class: "empty" }, st("good", "No server errors recorded in the last 30 days.")));
    stamp();
  } catch (e) { if (e.status !== 401 && seq === S.errSeq) fill(box, note("bad", "Could not load errors. " + e.message, loadErrors)); }
  finally { if (seq === S.errSeq) box.classList.remove("busy"); }
}

/* ---------- 6. Searches ---------- */
D.querySelectorAll("[data-days]").forEach(b => b.addEventListener("click", () => {
  S.sDays = Number(b.getAttribute("data-days"));
  D.querySelectorAll("[data-days]").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
  loadSearches();
}));
/* v127: Visitors (moved here from the page's Den, where the owner key showed it): people searching and searches per UTC
   day for 14 days, and where the page's visitors came from (Cloudflare Web Analytics, last 7 days). */
const USE_COLS = [{ t: "Day (UTC)" }, { t: "People", num: 1 }, { t: "Searches", num: 1 }];
const REF_COLS = [{ t: "Came from" }, { t: "Page views", num: 1 }];
async function loadUsage() {
  const box = $("#ubox"), seq = ++S.uSeq;
  if (!box.firstChild) fill(box, loading());
  box.classList.add("busy");
  try {
    const j = await api("/admin/api/usage");
    if (seq !== S.uSeq) return;
    const d = Array.isArray(j.days) ? j.days : null, r = j.refs || {}, out = [];
    if (d) {
      const wk = d.slice(-7), sum = k => wk.reduce((a, x) => a + (Number(x[k]) || 0), 0);
      out.push(h("p", { class: "ukpi", text: num(sum("people")) + " people-days and " + num(sum("searches")) + " searches in the last 7 days" }));
      out.push(tableOf(USE_COLS, d.slice().reverse().map(x => [x.day, num(x.people), num(x.searches)]), "People and searches per day", true));
    } else out.push(note("warn", "People and searches could not be loaded right now."));
    out.push(h("h3", { class: "ubh", text: "Where visitors came from, last 7 days" }));
    if (r.off) out.push(h("p", { class: "empty", text: "Not connected yet. Add CF_API_TOKEN, CF_ACCOUNT_ID and CF_SITE_TAG to the worker in Cloudflare." }));
    else if (r.error) out.push(note("warn", r.error));
    else {
      const L = Array.isArray(r.list) ? r.list : [];
      out.push(L.length ? tableOf(REF_COLS, L.map(x => [x.host || "Direct, or an app that hides it", num(x.views)]), "Where visitors came from")
        : h("p", { class: "empty", text: "No visits recorded in the last 7 days yet." }));
    }
    fill(box, out);
    S.uAt = Date.now(); stamp();
  } catch (e) { if (e.status !== 401 && seq === S.uSeq) fill(box, note("bad", "Could not load visitors. " + e.message, loadUsage)); }
  finally { if (seq === S.uSeq) box.classList.remove("busy"); }
}
async function loadSearches() {
  const box = $("#sbox"), seq = ++S.sSeq;
  if (!box.firstChild) fill(box, loading());
  box.classList.add("busy");
  try {
    const j = await api("/admin/api/searches?days=" + S.sDays);
    if (seq !== S.sSeq) return;
    const T = Array.isArray(j.top) ? j.top : [];
    fill(box, [T.length ? tableOf(TOP_COLS, topRows(T), "Top searches") : h("p", { class: "empty", text: "No searches recorded for this period yet." }),
      S.sDays === 1 ? h("p", { class: "hint", text: todayHint() }) : null]);
    const R = Array.isArray(j.trips) ? j.trips : null, rb = $("#rbox");
    if (rb) fill(rb, !R ? note("warn", "Road trips could not be loaded right now.") : R.length ? tableOf(TRIP_COLS, topRows(R), "Road trips")
      : h("p", { class: "empty", text: "No road trips recorded for this period yet." }));
    stamp();
  } catch (e) { if (e.status !== 401 && seq === S.sSeq) fill(box, note("bad", "Could not load searches. " + e.message, loadSearches)); }
  finally { if (seq === S.sSeq) box.classList.remove("busy"); }
}

route();
})();
`;

/* Static frame; the script fills every view. No inline handlers or style attributes (CSP). */
function appBody() {
  const tab = (id, label) => '<button class="tab" role="tab" type="button" id="t-' + id + '" data-tab="' + id + '" aria-controls="v-' + id + '" aria-selected="false" tabindex="-1">' + label + "</button>";
  const panel = (id, inner) => '<section class="view" id="v-' + id + '" role="tabpanel" aria-labelledby="t-' + id + '" hidden>' + inner + "</section>";
  const chip = (k, label) => '<button class="chip" type="button" data-filter="' + k + '" aria-pressed="' + (k === "all") + '">' + label + "</button>";
  const day = (n, label) => '<button type="button" data-days="' + n + '" aria-pressed="' + (n === 7) + '">' + label + "</button>";
  return '<a class="skip" href="#main">Skip to content</a>' +
    '<header class="top"><div class="wrap top-in"><div class="brand">' + MARK + '<h1>Prowl admin</h1><span class="ver" id="ver"></span></div>' +
    '<div class="tools"><span class="upd" id="upd">Loading&hellip;</span>' +
    '<button class="btn btn-s" id="refresh" type="button">Refresh</button>' +
    '<form method="post" action="/admin/logout"><button class="btn btn-s" type="submit">Sign out</button></form></div></div></header>' +
    /* outside the header: a sticky element only sticks within its parent, and the header is just as tall as itself */
    '<div class="tabbar"><div class="wrap"><nav class="tabs" role="tablist" aria-label="Admin sections">' +
    tab("overview", "Overview") + tab("members", "Members") + tab("diagnose", "Diagnose") + tab("errors", "Errors") + tab("searches", "Searches") + tab("affiliates", "Affiliates") +
    "</nav></div></div>" +
    '<main id="main" class="wrap">' +
    panel("overview", '<div class="view" id="ov"></div>') +
    panel("members",
      '<div class="view" id="mlist">' +
      '<form class="card find" id="findf" autocomplete="off"><label for="find-email">Find a member by email</label>' +
      '<div class="frow"><input id="find-email" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="name@example.com" aria-describedby="find-hint">' +
      '<button class="btn btn-p" type="submit">Find</button></div>' +
      '<p class="hint" id="find-hint">The email is only used for this one lookup. It is not stored, logged or shown, and the box clears as soon as you press Find.</p>' +
      '<p class="msg" id="find-msg" aria-live="polite"></p></form>' +
      '<section class="card" id="giftc" aria-labelledby="gift-h"><div class="ch"><h2 id="gift-h">Gift Pro (free service)</h2></div>' +
      '<p class="sub">Give someone Prowl Pro for free, for a while or for good. It works even before they sign up: Pro starts as soon as they join Prowl Alerts with that email.</p>' +
      '<form class="gform" id="giftf" autocomplete="off"><div class="ggrid">' +
      '<div><label for="gift-email">Their email</label><input id="gift-email" type="email" inputmode="email" autocomplete="off" spellcheck="false" placeholder="name@example.com" aria-describedby="gift-hint"></div>' +
      '<div><label for="gift-note">Note <span class="opt">(optional, only for you)</span></label><input id="gift-note" type="text" maxlength="60" autocomplete="off" placeholder="e.g. helped test Prowl"></div>' +
      '<div><label for="gift-len">How long</label><select id="gift-len">' +
      [[0, "Forever"], [1, "1 month"], [3, "3 months"], [6, "6 months"], [12, "12 months"]].map(o => '<option value="' + o[0] + '">' + o[1] + "</option>").join("") + "</select></div></div>" +
      '<label class="ck" for="gift-tell"><input id="gift-tell" type="checkbox" checked aria-describedby="gift-tell-hint"> Email them how to start</label>' +
      '<p class="hint" id="gift-tell-hint">They get a short email from Owl &amp; Twig Vintage with a button that signs them up with Pro already on (or opens Prowl, if they are already a member).</p>' +
      '<button class="btn btn-p" id="gift-go" type="submit">Gift Pro</button>' +
      '<p class="hint" id="gift-hint">The email is only used to switch Pro on and, if the box is ticked, to send them that one email. It is not stored or shown, and the box clears as soon as you press Gift Pro. Keep email addresses and phone numbers out of the note.</p>' +
      '<p class="msg" id="gift-msg" aria-live="polite"></p></form><div id="glist"></div></section>' +
      '<section class="card"><div class="mtools"><div class="chips" role="group" aria-label="Show members">' +
      chip("all", "All") + chip("pro", "Pro") + chip("trial", "Trial") + chip("free", "Free") + chip("late", "Late email") +
      chip("mailoff", "Emails off") + chip("paused", "Paused") + chip("issues", "Has issues") + "</div>" +
      '<label class="sort" for="msort">Sort by <select id="msort"><option value="created">Newest first</option><option value="hunts">Most hunts</option>' +
      '<option value="lastSent">Last email</option></select></label><div id="mrows"></div></div></section></div>' +
      '<div class="view" id="mdetail" hidden><div><button class="btn btn-s" id="mback" type="button">&larr; All members</button></div><div class="view" id="mbody"></div></div>') +
    panel("diagnose",
      '<section class="card"><div class="ch"><h2>Why am I seeing wrong results?</h2></div>' +
      '<p class="sub">Runs the search live on each marketplace right now, then shows which listings Prowl&rsquo;s AI would hide, which the member&rsquo;s own settings leave out, and which they were already emailed.</p>' +
      '<form class="dform" id="dform" autocomplete="off"><div class="dfrom" id="dfrom" hidden></div>' +
      '<div class="dgrid"><div><label for="dterm">Search term</label><input id="dterm" type="text" maxlength="120" spellcheck="false" placeholder="e.g. roseville pottery"></div>' +
      '<div><label for="dmember">Member id <span class="opt">(optional: applies their filters)</span></label><input id="dmember" type="text" maxlength="12" spellcheck="false" placeholder="M-1a2b3c4d"></div></div>' +
      '<fieldset><legend>Marketplaces <button class="lnk small" id="dall" type="button">All / none</button></legend><div class="checks" id="dsrc"></div></fieldset>' +
      '<div class="drun"><button class="btn btn-p" id="drun" type="submit">Run</button><p class="msg" id="dmsg" role="alert"></p></div></form></section>' +
      '<p class="sr" id="dstatus" role="status"></p><div class="view" id="dout"></div>') +
    panel("errors",
      '<section class="card"><div class="ch"><h2>Errors</h2></div><p class="sub">Server errors from the last 30 days, newest first. Email addresses and long numbers are removed from the messages.</p>' +
      '<div id="errbox"></div></section>') +
    panel("searches",
      '<section class="card"><div class="ch"><h2>Visitors</h2></div><p class="sub">People who searched Prowl, each counted once a day (no names or addresses), and the sites that sent visitors to the Prowl page.</p><div id="ubox"></div></section>' +
      '<section class="card"><div class="ch"><h2>Top searches</h2><div class="seg" role="group" aria-label="Period">' + day(1, "Today") + day(7, "7 days") + day(30, "30 days") + "</div></div>" +
      '<p class="sub">What people search for on Prowl. Visitors count each person once a day. Searches that look personal are never recorded.</p><div id="sbox"></div></section>' +
      '<section class="card"><div class="ch"><h2>Road trips</h2></div><p class="sub">Where people plan road trips to under Near me, for the same period as Top searches. Street addresses are never recorded.</p><div id="rbox"></div></section>') +
    panel("affiliates",
      '<section class="card"><div class="ch"><h2>Affiliates</h2></div>' +
      '<p class="sub">Each affiliate program has its IDs and an on/off switch. Paste the IDs from the network, press Save IDs, then Turn on. Off means links to that site go out plain and no disclosure names it. The Prowl page follows within about 5 minutes, and the alert emails too for the programs marked so (the others keep plain links in email). IDs are public (they are in every affiliate link), so nothing secret goes here.</p>' +
      '<div id="affbox"></div><p class="msg" id="aff-msg" aria-live="polite"></p></section>') +
    "</main>" +
    '<div class="toast" id="toast" role="status" aria-live="polite"></div>' +
    '<div class="out-ov" id="out" hidden><div class="card" role="alertdialog" aria-modal="true" aria-labelledby="out-h"><h2 id="out-h">You are signed out</h2>' +
    "<p>Admin sign-ins last 12 hours, and changing the admin key signs everyone out.</p>" +
    '<a class="btn btn-p" href="/admin">Sign in again</a></div></div>';
}

export function adminPage(nonce, version) {
  const n = esc(nonce), v = esc(version || "");
  /* function replacers, so a "$" in the version can never be read as a replacement pattern */
  return head(nonce, "Prowl admin", BASE_CSS + APP_CSS).replace("<html", () => '<html data-version="' + v + '"') +
    "<body>" + appBody().replace('<span class="ver" id="ver"></span>', () => '<span class="ver" id="ver">' + v + "</span>") +
    '<script nonce="' + n + '">' + APP_JS + "</script></body></html>";
}
