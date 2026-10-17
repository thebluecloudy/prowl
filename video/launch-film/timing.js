/* Shared timing for the Prowl launch film. Loaded by index.html (window.PROWL_TIMING)
   and by scripts/build-audio.mjs (globalThis.PROWL_TIMING), so every sound sits on the
   frame of the thing it belongs to. All cue times are in frames at 60 fps.
   100 BPM: one beat = 0.6 s = 36 frames. Scene changes land on beats. */
(function (root) {
  var FPS = 60;
  var BEAT = 36;
  var b = function (n) { return n * BEAT; };

  var scenes = {
    hook: [0, b(5)],          // 0.0 - 3.0
    capture: [b(5), b(13)],   // 3.0 - 7.8
    connect: [b(13), b(22)],  // 7.8 - 13.2
    resurface: [b(22), b(28)],// 13.2 - 16.8
    logo: [b(28), 1200]       // 16.8 - 20.0
  };

  var query = "ceramic panther";
  var typeStart = 198; // 3.3 s
  var keys = [];
  for (var i = 0; i < query.length; i++) keys.push(typeStart + Math.round(i * 4.5));

  var cues = {
    breathe: [0, b(2)],              // the mark breathes on the first beats
    walkStart: b(1),                 // 0.6 s the panther steps off
    unfold: [b(3), b(5)],            // 1.8 - 3.0 the mark unfolds into the app window
    keys: keys,                      // one key tick per typed letter
    huntPress: b(8),                 // 4.8 s the Hunt button
    huntLine: [b(8) + 3, b(10)],     // the hunt line draws across the chips
    chips: [297, 306, 314, 323, 331, 340, 349, 357],
    cards: [b(10), b(11), b(12)],    // 6.0 6.6 7.2 result cards land
    glide: [b(13), b(16)],           // camera glides down the day's finds
    open: [b(16), b(16) + 27],       // a card opens (9.6 - 10.05)
    live: b(17),                     // ShopGoodwill live badge
    flags: [b(18), b(19)],           // repaired, possible reproduction
    heart: b(20),                    // 12.0 s heart tap, saved
    toast: b(20) + 12,
    fold: [b(22), b(22) + 27],       // 13.20 - 13.65 the saved card folds into an email
    fly: [b(22) + 27, b(23) + 18],   // 13.65 - 14.10 paper whoosh, it arrives on the and of 23
    newPill: b(23) + 30,             // 14.30 "3 new matches"
    unfoldMail: [b(25) + 18, b(26) + 18], // 15.30 - 15.90 unfolds into a fresh find
    melt: [b(28), b(29)],            // 16.8 - 17.4 the card melts back into the mark
    wash: [b(29), b(30)],            // 17.4 - 18.0 background flips to the uranium night
    logoLand: b(30),                 // 18.0 warm low chord + glow swell
    wordmark: b(30) + 27,
    tagline: b(32)                   // 19.2 tagline and Available now settle
  };

  /* Panther locomotion, shared so footfalls can be heard where paws land.
     Units: rig units (body nose-to-rump about 113). */
  var WALK = { cycleUnits: 66, duty: 0.62, offsets: { lh: 0, lf: 0.25, rh: 0.5, rf: 0.75 } };

  function clamp(x, a, c) { return x < a ? a : x > c ? c : x; }
  function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

  // walking speed in rig units per second
  function speed(t) {
    var s = 55;
    if (t < 0.6) return 0;
    if (t < 1.1) return s * smooth((t - 0.6) / 0.5);
    if (t > 17.35) return s * (1 - smooth((t - 17.35) / 0.62));
    return s;
  }
  // px per rig unit
  function scale(t) {
    var a = 1.98, c = 1.7;
    if (t <= 1.8) return a;
    if (t >= 3.0) return c;
    return a + (c - a) * smooth((t - 1.8) / 1.2);
  }
  // share of the walk that moves the panther on screen (the rest is the camera tracking it)
  function screenShare(t) {
    if (t < 1.8) return 1;
    if (t < 3.0) return 1 + (0.28 - 1) * smooth((t - 1.8) / 1.2);
    if (t < 16.6) return 0.28;
    if (t < 17.2) return 0.28 + 0.72 * smooth((t - 16.6) / 0.6);
    return 1;
  }
  // integrals with a fixed step so every sub-frame sample is deterministic
  function integrate(t, f) {
    if (t <= 0) return 0;
    var n = Math.max(8, Math.ceil(t * 240)), h = t / n, s = f(0) + f(t);
    for (var i = 1; i < n; i++) s += f(i * h) * (i % 2 ? 4 : 2);
    return s * h / 3;
  }
  function distUnits(t) { return integrate(t, speed); }
  function distPx(t) { return integrate(t, function (x) { return speed(x) * scale(x); }); }
  function screenTravel(t) { return integrate(t, function (x) { return speed(x) * scale(x) * screenShare(x); }); }

  // the moments each paw touches the ground (frames), for the soft footfall sounds
  function footfalls() {
    var out = [], prev = {}, legs = ["lh", "lf", "rh", "rf"];
    for (var f = 0; f <= 1200; f++) {
      var c = distUnits(f / FPS) / WALK.cycleUnits;
      for (var j = 0; j < legs.length; j++) {
        var ph = c + 1 - WALK.offsets[legs[j]];
        var k = Math.floor(ph);
        if (prev[legs[j]] !== undefined && k > prev[legs[j]] && speed(f / FPS) > 5) out.push({ f: f, leg: legs[j] });
        prev[legs[j]] = k;
      }
    }
    return out;
  }

  root.PROWL_TIMING = {
    FPS: FPS, BEAT: BEAT, DURATION: 1200, scenes: scenes, cues: cues, query: query, WALK: WALK,
    speed: speed, scale: scale, screenShare: screenShare,
    distUnits: distUnits, distPx: distPx, screenTravel: screenTravel, footfalls: footfalls
  };
})(typeof window !== "undefined" ? window : globalThis);
