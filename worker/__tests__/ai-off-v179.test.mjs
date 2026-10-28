/* v179 (the security and trust audit, 2026-10-28: "A Pro member who turned AI off still has listings and their own
   reference photo sent to Meta's Muse by Pounce"; alert emails still asked TypeSafe for shop picks): AI off means no
   Pounce judging and no AI shop picks; email send errors are scrubbed before they reach the logs.
   Run: node --test worker/__tests__/ai-off-v179.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const INDEX = readFileSync(new URL("../index.js", import.meta.url), "utf8");
function indexFn(name) {
  const m = new RegExp("^(async )?function " + name + "\\(", "m").exec(INDEX);
  assert.ok(m, name + " is in index.js");
  return INDEX.slice(m.index, INDEX.indexOf("\n}\n", m.index) + 2);
}

test("shop picks in an alert email: none when the member turned AI off, TypeSafe's otherwise", async () => {
  let asked = 0;
  const shopPicks = async () => { asked++; return { json: async () => ({ picks: [1, 2, 3, 4, 5] }) }; };
  const alPrefs = (sub) => ({ noai: sub.prefs && sub.prefs.noai ? 1 : 0 });
  const alPicks = new Function("shopPicks", "alPrefs", "WORKER_BASE", "URL", indexFn("alPicks") + "\nreturn alPicks;")(shopPicks, alPrefs, "https://w", URL);
  assert.deepEqual(await alPicks({}, "pyrex", { prefs: { noai: 1 } }), []);
  assert.equal(asked, 0, "TypeSafe is not asked");
  assert.deepEqual(await alPicks({}, "pyrex", { prefs: {} }), [1, 2, 3, 4]);
  assert.equal(asked, 1);
  for (const call of INDEX.match(/await alPicks\([^)]*\)/g)) assert.match(call, /alPicks\(env, top, sub\)/, "every caller passes the member");
});

test("Pounce: no judging, no carried judging and no new quarry while AI is off", () => {
  assert.match(INDEX, /if \(sub\.quarries && !alPrefs\(sub\)\.noai\) \{[\s\S]{0,120}await pounceRun\(env, sub, h, all, !!only\)/);
  assert.match(INDEX, /held = alPrefs\(sub\)\.noai \? 0 : await pounceCarry\(env, sub, now, !!phoneOnly\);/);
  assert.match(indexFn("pounceSave"), /if \(!removing && !b\.notUrl && alPrefs\(sub\)\.noai\) return json\(\{ error: "Pounce uses the AI helpers\. Turn them on in Den > Settings first\." \}, 400, origin\);/);
  assert.equal((INDEX.match(/await pounceRun\(/g) || []).length, 2, "the run above and pounceTest (owner-only) are the only callers");
});

test("email send errors are scrubbed before they are logged (Resend can echo the address)", () => {
  for (const tag of ["confirm mail", "signin mail", "code mail", "move mail", "test mail"])
    assert.match(INDEX, new RegExp('console\\.error\\("' + tag + '", scrubPII\\(String\\(r\\.error \\|\\| "send failed"\\)\\)\\)'), tag);
  assert.doesNotMatch(INDEX, /console\.error\("[a-z ]+ mail", r\.error\)/);
});
