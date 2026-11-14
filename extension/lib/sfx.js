// XAICG sound effects.
//
// Every sound is made on the spot with the Web Audio API: there are no audio
// files to load, so nothing is fetched and nothing needs special access to
// the page. They are short and quiet on purpose.
//
// Loaded as a plain script in three places (the page on x.com, the popup and
// the settings page), where it defines XAICG_SFX:
//
//   XAICG_SFX.enabled = false   turn every sound off (the Settings switch)
//   XAICG_SFX.play("start")     a draft was asked for
//   XAICG_SFX.play("done")      a draft arrived
//   XAICG_SFX.play("send")      the reply was posted, or a draft was copied
//   XAICG_SFX.play("error")     something went wrong
//   XAICG_SFX.play("tick")      a small confirmation
(() => {
  "use strict";
  if (globalThis.XAICG_SFX) return;

  let context = null;
  let enabled = true;

  // Browsers only allow sound after a click or key press. Every call here
  // follows one, and the context is woken again each time in case it slept.
  function audio() {
    const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctor) return null;
    if (!context) context = new Ctor();
    if (context.state === "suspended") context.resume().catch(() => {});
    return context;
  }

  // One note: a pitch (optionally gliding to another) with a soft attack and
  // a quick fade, so there is never a click at either end.
  function note(ac, { type = "sine", from, to = from, at = 0, length = 0.12, level = 0.05 }) {
    const start = ac.currentTime + at;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, start);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, start + length);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + length + 0.03);
  }

  // A breath of filtered noise that sweeps upward: the "sent" whoosh.
  function whoosh(ac, { at = 0, length = 0.28, level = 0.06 }) {
    const start = ac.currentTime + at;
    const frames = Math.ceil(ac.sampleRate * length);
    const buffer = ac.createBuffer(1, frames, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const source = ac.createBufferSource();
    source.buffer = buffer;
    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(500, start);
    filter.frequency.exponentialRampToValueAtTime(3400, start + length);
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(level, start + length * 0.35);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter).connect(gain).connect(ac.destination);
    source.start(start);
    source.stop(start + length + 0.03);
  }

  const SOUNDS = {
    start: (ac) => note(ac, { from: 520, to: 820, length: 0.11, level: 0.04 }),
    done: (ac) => {
      note(ac, { from: 660, length: 0.14 });
      note(ac, { from: 990, at: 0.09, length: 0.22 });
    },
    send: (ac) => {
      whoosh(ac, {});
      note(ac, { from: 440, to: 1320, length: 0.2, level: 0.025 });
    },
    error: (ac) => {
      note(ac, { type: "triangle", from: 220, to: 185, length: 0.12, level: 0.06 });
      note(ac, { type: "triangle", from: 185, to: 150, at: 0.13, length: 0.17, level: 0.06 });
    },
    tick: (ac) => note(ac, { from: 1180, length: 0.045, level: 0.03 }),
  };

  globalThis.XAICG_SFX = {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = value !== false;
    },
    play(name) {
      if (!enabled || !SOUNDS[name]) return false;
      try {
        const ac = audio();
        if (!ac) return false;
        SOUNDS[name](ac);
        return true;
      } catch {
        return false; // sound is a nicety; it must never break anything
      }
    },
  };
})();
