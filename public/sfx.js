/**
 * Simple Web Audio SFX for Bomberman (no external samples).
 */
(function (global) {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function beep(freq, dur, type, gain) {
    if (muted) return;
    const ac = ensure();
    if (!ac) return;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.value = gain || 0.08;
    o.connect(g);
    g.connect(ac.destination);
    const t = ac.currentTime;
    g.gain.setValueAtTime(gain || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t);
    o.stop(t + dur);
  }

  const Sfx = {
    isMuted() {
      return muted;
    },
    setMuted(v) {
      muted = !!v;
      try {
        localStorage.setItem('bm_mute', muted ? '1' : '0');
      } catch (_) {}
    },
    toggleMute() {
      Sfx.setMuted(!muted);
      return muted;
    },
    loadMutePref() {
      try {
        muted = localStorage.getItem('bm_mute') === '1';
      } catch (_) {}
      return muted;
    },
    click() {
      beep(660, 0.06, 'square', 0.05);
    },
    ready() {
      beep(880, 0.1, 'triangle', 0.06);
    },
    start() {
      beep(440, 0.08, 'square', 0.07);
      setTimeout(() => beep(660, 0.08, 'square', 0.07), 100);
      setTimeout(() => beep(880, 0.12, 'square', 0.07), 200);
    },
    bomb() {
      beep(120, 0.12, 'sawtooth', 0.06);
    },
    explode() {
      if (muted) return;
      const ac = ensure();
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(180, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.35);
      g.gain.setValueAtTime(0.12, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g);
      g.connect(ac.destination);
      o.start(t);
      o.stop(t + 0.35);
    },
    pickup() {
      beep(740, 0.06, 'triangle', 0.07);
      setTimeout(() => beep(980, 0.08, 'triangle', 0.07), 60);
    },
    death() {
      beep(200, 0.2, 'sawtooth', 0.08);
      setTimeout(() => beep(100, 0.25, 'sawtooth', 0.06), 80);
    },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.07), i * 90));
    },
    countdown() {
      beep(520, 0.1, 'square', 0.08);
    },
  };

  global.BombermanSfx = Sfx;
})(typeof window !== 'undefined' ? window : globalThis);
