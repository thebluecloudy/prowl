# Prowl privacy pack — paste-ready for Claude (and 2 admin steps for Matthew)

Closes the five gaps from the 2026-10-02 privacy review. Each item says who
does it and gives exact text/code. Nothing here needs inventing.

Conventions used below:
- `[POSTAL ADDRESS]` — Matthew fills in his real postal address (PO box is
  fine). Required by CAN-SPAM in every commercial email.
- `hello@owlandtwigvintage.com` — already the support address on the /prowl
  page; used for the mailto unsubscribe.

---

## 1. Cookie banner — MATTHEW (admin, ~2 min)

Shopify admin → **Settings → Customer privacy → Cookie banner** → turn it on
and configure it for the EU/UK and California. It renders store-wide, which
includes `/pages/prowl`. No theme code needed.

**Claude, verify (no new code unless this fails):** the /prowl page itself sets
no cookies of its own — state lives in `localStorage`, which is not a cookie
and needs no banner. Confirm the page fires no non-essential tracker before
consent (current page: Google Fonts + Shopify's own analytics only). If the
theme does not render Shopify's banner on pages for any reason, say so instead
of building a custom banner.

---

## 2. Alert email footer + one-click unsubscribe — CLAUDE (worker)

Every Prowl Alert email must carry this footer. Append to both the HTML and
text bodies. Replace `[POSTAL ADDRESS]` and `{UNSUB_URL}` per send.

**Text footer:**

```
---
You're getting Prowl Alerts because you signed up at owlandtwigvintage.com.
Owl & Twig Vintage · [POSTAL ADDRESS]
Unsubscribe instantly: {UNSUB_URL}
Or just reply "unsubscribe" to this email.
```

**HTML footer** (append before `</body>`):

```html
<hr>
<p style="font-size:12px;color:#666">
You're getting Prowl Alerts because you signed up at
<a href="https://www.owlandtwigvintage.com/pages/prowl">owlandtwigvintage.com</a>.<br>
Owl &amp; Twig Vintage · [POSTAL ADDRESS]<br>
<a href="{UNSUB_URL}">Unsubscribe instantly</a> · or reply "unsubscribe" to this email.
</p>
```

**`{UNSUB_URL}`** = the existing per-subscriber link:
`https://prowl.thebluecloud.workers.dev/alerts/unsub?e={email}&t={tok}`
(URL-encode both values; reuse the token already issued at subscribe time —
do not invent a second token scheme.)

**One-click (RFC 8058) headers** on the Resend send call:

```js
await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${RESEND_API_KEY}`,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    from: "Prowl Alerts <alerts@owlandtwigvintage.com>",
    to: sub.email,
    subject: subject,
    html: htmlBody,   // includes the HTML footer above
    text: textBody,   // includes the text footer above
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>, <mailto:hello@owlandtwigvintage.com?subject=unsubscribe>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    }
  })
});
```

**Handler change:** one-click clients send an HTTP POST (not GET) to the
unsubscribe URL. Make the existing `/alerts/unsub` route accept POST as well
as GET, reading `e`/`t` from the query string or the POST body, verifying the
token exactly as the GET path does, then running the same unsubscribe + KV
purge (item 4). Return 200 with a one-line confirmation either way.

**Reply handling:** if a recipient replies "unsubscribe", treat it as an
unsubscribe request and purge per item 4 (manual step until/unless automated).

---

## 3. Privacy policy paragraph — MATTHEW (paste into the policy page)

Shopify admin → Settings → Policies → Privacy policy → add this section
(the page is currently Shopify's template, last updated 2026-10-01, and says
nothing about Prowl Alerts):

> **Prowl Alerts.** If you sign up for Prowl Alerts on our Prowl page, we
> collect your email address, the search terms you save as hunts, and a
> sign-in token. We use them only to send you the alert emails you asked for —
> nothing else. Your alert data is stored by our service providers Cloudflare
> (which runs the alert system) and Resend (which sends the emails). We keep
> it until you unsubscribe; unsubscribing deletes your alert record. Every
> alert email contains an unsubscribe link and our postal address. To ask what
> we hold about you, or to have it deleted, email
> hello@owlandtwigvintage.com.

---

## 4. Purge the KV record on unsubscribe — CLAUDE (worker)

In the `/alerts/unsub` handler (GET and the new POST path), after the token
verifies, delete the subscriber's server-side record. Adjust the key names to
the actual key layout in the worker — the shapes below cover the likely ones;
delete whichever exist:

```js
// after e/t verification succeeds:
const email = String(params.e || "").toLowerCase();
await ALERTS_KV.delete("sub:" + email);
await ALERTS_KV.delete("alert:" + email);
await ALERTS_KV.delete("tok:" + params.t);
// if hunts/settings are stored under separate keys, delete those too —
// the rule is: after unsubscribe, no KV key may still map to this email.
```

Then send the confirmation. Log the purge (key deleted, timestamp) for the
Monday report, not the email address itself.

---

## 5. Resend DPA — MATTHEW (dashboard, ~1 min)

Resend dashboard → **Settings → Compliance → DPA**. Resend's Data Processing
Addendum becomes binding when you accept their service agreement; the executed
copy is available in the dashboard. Download it and file it somewhere durable
(e.g. a private Drive folder). No code, no Claude.

---

## Done checklist

- [ ] Cookie banner on in Shopify admin (Matthew)
- [ ] Footer + List-Unsubscribe headers live on alert emails (Claude)
- [ ] `/alerts/unsub` accepts POST for one-click (Claude)
- [ ] KV purge on unsubscribe, both methods (Claude)
- [ ] Privacy policy paragraph pasted (Matthew)
- [ ] Resend DPA downloaded and filed (Matthew)
- [ ] `[POSTAL ADDRESS]` replaced with the real address in the footer (both)
