/*
 * brain.js — a 64-electrode leaky integrate-and-fire (LIF) "brain" that runs in the browser.
 *
 * A JavaScript port of the model described in MEMORY_GAME.md §4.4:
 *   - one LIF neuron per channel (tau 20 ms, rest -70 mV, threshold -50 mV, reset -75 mV, refractory 2 ms)
 *   - Gaussian background drive (the "noise" / difficulty dial)
 *   - stim drive 5 mV per uA per frame, cathodic phase only
 *   - coupling: when neuron j spikes, every neuron i gets W[i,j] mV on the next frame (40 us later)
 *   - STDP eligibility trace; nothing is stored until reward(r): W += lr * r * elig, clipped to [0, wMax]
 *
 * The game never stores where cards are. The only memory is the weight matrix W.
 */
(function (root) {
  const N = 64;
  const FPMS = 25; // frames per millisecond (25 kHz)
  const DEAD = new Set([0, 4, 7, 56, 63]); // grounded + reference: never spike

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class LIFBrain {
    constructor(o = {}) {
      this.dt = 1 / FPMS;
      this.tau = 20; this.vRest = -70; this.vThr = -50; this.vReset = -75;
      this.refrFrames = 2 * FPMS;
      this.noise = o.noise ?? 0.45;
      this.stimGain = 5.0;
      this.lr = o.lr ?? 25; this.wMax = o.wMax ?? 25;
      this.tauPre = 20; this.tauPost = 20; this.ltd = 0.5; this.tauElig = 200;
      this.V = new Float64Array(N).fill(this.vRest);
      this.refr = new Int32Array(N);
      this.inp = new Float64Array(N);
      this.W = new Float64Array(N * N); // W[post * 64 + pre]
      this.elig = new Float64Array(N * N);
      this.xpre = new Float64Array(N);
      this.xpost = new Float64Array(N);
      this.stims = [];
      this.t = 0;
      this.rand = mulberry32(o.seed ?? 42);
      this._spare = null;
    }

    gauss() {
      if (this._spare !== null) { const s = this._spare; this._spare = null; return s; }
      let u = 0, v = 0;
      while (u === 0) u = this.rand();
      v = this.rand();
      const m = Math.sqrt(-2 * Math.log(u));
      this._spare = m * Math.sin(2 * Math.PI * v);
      return m * Math.cos(2 * Math.PI * v);
    }

    /** Schedule a biphasic pulse on a channel, delayMs after "now". Silently dropped on dead channels (like the SDK). */
    stim(ch, delayMs = 0, uA = 1.5, durUs = 200) {
      if (DEAD.has(ch)) return;
      const start = this.t + Math.round(delayMs * FPMS);
      this.stims.push({ ch, start, end: start + Math.round(durUs / 40), amp: this.stimGain * uA });
    }

    /** Advance the simulation by ms milliseconds. Returns spikes [{t, ch}] (t in frames). */
    run(ms) {
      const frames = Math.round(ms * FPMS);
      const spikes = [];
      const decayV = this.dt / this.tau;
      const dPre = Math.exp(-this.dt / this.tauPre);
      const dPost = Math.exp(-this.dt / this.tauPost);
      const dElig = Math.exp(-1 / this.tauElig); // applied once per ms
      const drive = new Float64Array(N);
      const fired = new Int32Array(N);
      const { V, refr, inp, W, elig, xpre, xpost } = this;

      for (let f = 0; f < frames; f++) {
        const t = this.t;
        for (let i = 0; i < N; i++) { drive[i] = inp[i]; inp[i] = 0; }
        if (this.stims.length) {
          for (const s of this.stims) if (t >= s.start && t < s.end) drive[s.ch] += s.amp;
          this.stims = this.stims.filter((s) => s.end > t + 1);
        }
        let nf = 0;
        for (let i = 0; i < N; i++) {
          if (DEAD.has(i)) continue;
          if (refr[i] > 0) { refr[i]--; V[i] = this.vReset; continue; }
          V[i] += (this.vRest - V[i]) * decayV + this.noise * this.gauss() + drive[i];
          if (V[i] >= this.vThr) {
            V[i] = this.vReset; refr[i] = this.refrFrames;
            fired[nf++] = i; spikes.push({ t, ch: i });
          }
        }
        if (nf) {
          for (let k = 0; k < nf; k++) {
            const j = fired[k];
            for (let i = 0; i < N; i++) if (i !== j) inp[i] += W[i * N + j];
          }
          // STDP eligibility: pre-before-post strengthens pre->post, post-before-pre weakens it
          for (let k = 0; k < nf; k++) {
            const p = fired[k], row = p * N;
            for (let j = 0; j < N; j++) if (j !== p) elig[row + j] += xpre[j];
            for (let i = 0; i < N; i++) if (i !== p) elig[i * N + p] -= this.ltd * xpost[i];
          }
          for (let k = 0; k < nf; k++) { xpre[fired[k]] += 1; xpost[fired[k]] += 1; }
        }
        for (let i = 0; i < N; i++) { xpre[i] *= dPre; xpost[i] *= dPost; }
        if (t % FPMS === 0) for (let k = 0; k < N * N; k++) elig[k] *= dElig;
        this.t++;
      }
      return spikes;
    }

    /** Dopamine-like reward: commit recent co-activity into the weights (r=0 just forgets it). */
    reward(r) {
      if (r !== 0) {
        const { W, elig } = this;
        for (let k = 0; k < N * N; k++) {
          let w = W[k] + this.lr * r * elig[k];
          W[k] = w < 0 ? 0 : w > this.wMax ? this.wMax : w;
        }
        for (let i = 0; i < N; i++) {
          W[i * N + i] = 0;
          if (DEAD.has(i)) for (let j = 0; j < N; j++) { W[i * N + j] = 0; W[j * N + i] = 0; }
        }
      }
      this.elig.fill(0);
    }

    weight(post, pre) { return this.W[post * N + pre]; }
  }

  /** The Memory-game protocol on top of the LIF brain (MEMORY_GAME.md §2 and §5). */
  const FACE_CH = [9, 14, 25, 38, 49, 54];
  const SLOT_CH = [18, 19, 20, 21, 27, 30, 34, 37, 42, 43, 44, 45];

  class MemoryBrain {
    constructor(o = {}) {
      this.lif = new LIFBrain(o);
      this.faceCh = FACE_CH.slice(0, o.faces ?? 6);
      this.slotCh = SLOT_CH.slice(0, o.slots ?? 12);
      this.zaps = o.zaps ?? 3;
    }

    /** "Seeing": clear -> zap face -> zap slot 5 ms later -> reward. Returns an event trace for animation. */
    see(face, slot) {
      const b = this.lif, t0 = b.t;
      const fc = this.faceCh[face], sc = this.slotCh[slot];
      b.reward(0);
      b.stim(fc, 0); b.stim(sc, 5);
      const s1 = b.run(8);
      b.reward(1);
      const s2 = b.run(100);
      return {
        kind: 'see', t0, durMs: 108,
        stims: [{ ch: fc, ms: 0 }, { ch: sc, ms: 5 }],
        rewardMs: 8,
        spikes: s1.concat(s2).map((s) => ({ ch: s.ch, ms: (s.t - t0) / FPMS })),
      };
    }

    /** "Recalling": zap the face electrode, count spikes on each candidate slot 0-25 ms later. */
    recall(face, exclude = []) {
      const b = this.lif, t0 = b.t;
      const fc = this.faceCh[face];
      const counts = new Array(this.slotCh.length).fill(0);
      const chToSlot = new Map(this.slotCh.map((c, i) => [c, i]));
      const stims = [], spikes = [];
      for (let z = 0; z < this.zaps; z++) {
        const tz = b.t;
        b.stim(fc, 0);
        stims.push({ ch: fc, ms: (tz - t0) / FPMS });
        const sp = b.run(30).concat(b.run(70));
        for (const s of sp) {
          spikes.push({ ch: s.ch, ms: (s.t - t0) / FPMS });
          const dt = (s.t - tz) / FPMS;
          if (dt >= 0 && dt < 25 && chToSlot.has(s.ch)) counts[chToSlot.get(s.ch)]++;
        }
      }
      b.reward(0); // recall must not write new memories
      const candidates = counts.map((c, i) => i).filter((i) => !exclude.includes(i));
      const best = Math.max(...candidates.map((i) => counts[i]));
      const top = candidates.filter((i) => counts[i] === best);
      const choice = top[Math.floor(b.rand() * top.length)];
      return { kind: 'recall', t0, durMs: this.zaps * 100, stims, spikes, counts, choice, guessed: best === 0 || top.length > 1 };
    }

    /** Learned face -> slot link strengths (mV), faces x slots. */
    memoryMatrix() {
      return this.faceCh.map((fc) => this.slotCh.map((sc) => this.lif.weight(sc, fc)));
    }

    /** Mean strength of every other learned link (junk). */
    junkMean() {
      const faceSet = new Set(this.faceCh), slotSet = new Set(this.slotCh);
      let sum = 0, n = 0;
      for (let post = 0; post < N; post++) for (let pre = 0; pre < N; pre++) {
        if (post === pre || DEAD.has(post) || DEAD.has(pre)) continue;
        if (faceSet.has(pre) && slotSet.has(post)) continue;
        sum += this.lif.W[post * N + pre]; n++;
      }
      return sum / n;
    }
  }

  const api = { LIFBrain, MemoryBrain, DEAD, FACE_CH, SLOT_CH, FPMS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NeuroBrain = api;
})(typeof window !== 'undefined' ? window : globalThis);
