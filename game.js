/* game.js — Neuron Match: human vs a simulated brain at Memory. */
(() => {
  const { MemoryBrain, DEAD } = window.NeuroBrain;
  const FACES = ['🍭', '🐡', '🤖', '👾', '🐯', '🐲'];
  const SLOTS = 'ABCDEFGHIJKL'.split('');
  const NOTES = {
    '0.35': 'Calm brain: a memory champion. Hard to beat.',
    '0.45': 'Medium noise: a forgetful human. The best opponent.',
    '0.52': 'Noisy brain: junk links drown its memory. Easy.',
  };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let noise = 0.45;
  let soundOn = true;
  let S = null; // game state
  let gameId = 0; // invalidates async loops from a previous game

  /* ---------------- storage (best effort) ---------------- */
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  $('bestScore').textContent = store.get('nm-wins', 0);

  /* ---------------- sound ---------------- */
  let ac = null;
  function tone(freq, dur = 0.08, type = 'sine', vol = 0.08, when = 0) {
    if (!soundOn) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t = ac.currentTime + when;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch {}
  }
  const sfx = {
    flip: () => tone(520, 0.06, 'triangle', 0.07),
    match: () => { tone(660, 0.12, 'triangle'); tone(990, 0.18, 'triangle', 0.08, 0.1); },
    miss: () => tone(200, 0.15, 'sine', 0.05),
    zap: () => tone(1400, 0.03, 'square', 0.02),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.08, i * 0.12)),
    lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'sine', 0.07, i * 0.15)),
  };

  /* ---------------- start screen ---------------- */
  document.querySelectorAll('.pill').forEach((p) => p.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach((q) => q.classList.remove('selected'));
    p.classList.add('selected');
    noise = parseFloat(p.dataset.noise);
    $('diffNote').textContent = NOTES[p.dataset.noise];
    sfx.flip();
  }));
  $('playBtn').addEventListener('click', () => { show('game'); newGame(); });
  $('closeBtn').addEventListener('click', () => { gameId++; show('start'); });
  $('menuBtn').addEventListener('click', () => { $('modal').hidden = true; gameId++; show('start'); });
  $('againBtn').addEventListener('click', () => { $('modal').hidden = true; newGame(); });
  $('soundBtn').addEventListener('click', () => { soundOn = !soundOn; $('soundBtn').textContent = soundOn ? '🔊' : '🔇'; });

  function show(id) {
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === id));
    window.scrollTo(0, 0);
  }

  /* ---------------- MEA (8x8 electrode grid) ---------------- */
  const elByCh = new Map();
  function buildMEA(brain) {
    const mea = $('mea');
    mea.innerHTML = '';
    elByCh.clear();
    const faceOf = new Map(brain.faceCh.map((c, i) => [c, i]));
    const slotOf = new Map(brain.slotCh.map((c, i) => [c, i]));
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const ch = row + 8 * col; // LIF grid mapping
      const d = document.createElement('div');
      d.className = 'el';
      d.title = `channel ${ch}`;
      if (DEAD.has(ch)) d.classList.add('dead');
      else if (faceOf.has(ch)) { d.classList.add('face'); d.textContent = FACES[faceOf.get(ch)]; d.title += ` · face ${FACES[faceOf.get(ch)]}`; }
      else if (slotOf.has(ch)) { d.classList.add('slot'); d.textContent = SLOTS[slotOf.get(ch)]; d.title += ` · slot ${SLOTS[slotOf.get(ch)]}`; }
      mea.appendChild(d);
      elByCh.set(ch, d);
    }
  }
  function flash(ch, cls) {
    const d = elByCh.get(ch);
    if (!d) return;
    d.classList.remove(cls); void d.offsetWidth; d.classList.add(cls);
  }

  /** Replay a brain event trace on the electrode grid, slowed down so people can see it. */
  function animate(ev, slow) {
    return new Promise((resolve) => {
      const myGame = gameId;
      const items = [
        ...ev.spikes.map((s) => ({ ms: s.ms, fn: () => flash(s.ch, 'spike') })),
        ...ev.stims.map((s) => ({ ms: s.ms, fn: () => { flash(s.ch, 'stim'); sfx.zap(); } })),
      ];
      if (ev.rewardMs !== undefined) items.push({ ms: ev.rewardMs, fn: () => {
        const r = $('rewardFlash'); r.classList.add('on'); setTimeout(() => r.classList.remove('on'), 700);
      } });
      items.sort((a, b) => a.ms - b.ms);
      const start = performance.now();
      let k = 0;
      function frame(now) {
        if (myGame !== gameId) return resolve();
        const simMs = (now - start) / slow;
        while (k < items.length && items[k].ms <= simMs) items[k++].fn();
        if (simMs < ev.durMs) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  /* ---------------- panels ---------------- */
  function buildBars() {
    $('bars').innerHTML = SLOTS.map((s, i) => `<div class="bar" id="bar${i}"><span class="n"></span><div class="fill"></div><span class="lbl">${s}</span></div>`).join('');
  }
  function setBars(counts, exclude = [], win = -1) {
    const max = Math.max(4, ...counts);
    counts.forEach((c, i) => {
      const b = $('bar' + i);
      b.classList.toggle('excluded', exclude.includes(i));
      b.classList.toggle('win', i === win);
      b.querySelector('.fill').style.height = `${Math.max(3, (c / max) * 100)}%`;
      b.querySelector('.n').textContent = exclude.includes(i) ? '' : c;
    });
  }
  function buildHeat() {
    let h = '<span></span>' + SLOTS.map((s) => `<span class="hl">${s}</span>`).join('');
    FACES.forEach((f, fi) => {
      h += `<span class="hf">${f}</span>`;
      SLOTS.forEach((_, si) => { h += `<span class="cell" id="h${fi}-${si}"></span>`; });
    });
    $('heat').innerHTML = h;
  }
  function paintHeat(fresh) {
    const M = S.brain.memoryMatrix();
    M.forEach((row, fi) => row.forEach((w, si) => {
      const c = $(`h${fi}-${si}`);
      const a = Math.min(1, w / 22);
      c.style.background = a < 0.02 ? '' : `rgba(240, 106, 14, ${0.12 + 0.88 * a})`;
      c.title = `${FACES[fi]} → ${SLOTS[si]}: ${w.toFixed(1)} mV`;
      if (fresh && fresh[0] === fi && fresh[1] === si) { c.classList.remove('fresh'); void c.offsetWidth; c.classList.add('fresh'); }
    }));
  }
  const status = (html) => { $('status').innerHTML = html; };
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 1600);
  }

  /* ---------------- game ---------------- */
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function newGame() {
    gameId++;
    const brain = new MemoryBrain({ noise, seed: (Math.random() * 1e9) | 0, faces: 6, slots: 12, zaps: 3 });
    S = {
      brain,
      faces: shuffle([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]),
      matched: new Array(12).fill(null), // 'you' | 'brain'
      up: [],
      turn: 'you',
      busy: false,
      score: { you: 0, brain: 0 },
      queue: Promise.resolve(),
    };
    $('noiseChip').textContent = `noise ${noise.toFixed(2)} mV`;
    buildMEA(brain); buildBars(); buildHeat(); paintHeat();
    setBars(new Array(12).fill(0));
    renderBoard(); updateScore(); setTurn('you');
    status('Fresh brain: no links yet. <b>Flip a card</b>: the brain watches every flip.');
  }

  function renderBoard() {
    const board = $('board');
    board.innerHTML = '';
    S.faces.forEach((f, i) => {
      const c = document.createElement('button');
      c.className = 'card';
      c.id = 'card' + i;
      c.setAttribute('aria-label', `Card ${SLOTS[i]}`);
      c.innerHTML = `<div class="face back"><span class="tag">${SLOTS[i]}</span><span class="q">?</span></div>
        <div class="face front"><span class="tag">${SLOTS[i]}</span>${FACES[f]}<span class="owner"></span></div>`;
      c.addEventListener('click', () => humanFlip(i));
      board.appendChild(c);
    });
  }
  const cardEl = (i) => $('card' + i);
  function updateScore() { $('youScore').textContent = S.score.you; $('brainScore').textContent = S.score.brain; }
  function setTurn(t) {
    S.turn = t;
    const l = $('turnLabel');
    l.textContent = t === 'you' ? 'Your turn' : "Brain's turn 🧠";
    l.classList.toggle('brain', t === 'brain');
    $('board').classList.toggle('locked', t !== 'you');
  }

  function flipUp(i) { cardEl(i).classList.add('up'); sfx.flip(); }
  function flipDown(i) { cardEl(i).classList.remove('up'); }

  /** The brain sees a card: run the "seeing" protocol, then animate it. Returns a promise for the animation. */
  function observe(i) {
    const f = S.faces[i], my = gameId;
    const ev = S.brain.see(f, i);
    S.queue = S.queue.then(async () => {
      if (my !== gameId) return;
      status(`👀 Seeing <b>${FACES[f]}</b> at slot <b>${SLOTS[i]}</b>: zap face → zap slot 5 ms later → reward`);
      await animate(ev, 7);
      if (my !== gameId) return;
      paintHeat([f, i]);
      const w = S.brain.memoryMatrix()[f][i];
      status(`🔗 Link <b>${FACES[f]} → ${SLOTS[i]}</b> is now <b>${w.toFixed(1)} mV</b> (fires a neuron at ~20 mV)`);
    });
    return S.queue;
  }

  function markMatched(a, b, who) {
    [a, b].forEach((i) => {
      S.matched[i] = who;
      const c = cardEl(i);
      c.classList.add('matched', 'pop');
      if (who === 'brain') c.classList.add('by-brain');
      c.querySelector('.owner').textContent = who === 'brain' ? '🧠' : '🙂';
    });
    S.score[who]++;
    updateScore();
    sfx.match();
  }
  const remaining = () => S.matched.filter((m) => m === null).length;

  async function humanFlip(i) {
    if (!S || S.turn !== 'you' || S.busy || S.matched[i] || S.up.includes(i)) return;
    const my = gameId;
    flipUp(i);
    S.up.push(i);
    observe(i);
    if (S.up.length < 2) return;
    S.busy = true;
    const [a, b] = S.up;
    await sleep(650);
    if (my !== gameId) return;
    if (S.faces[a] === S.faces[b]) {
      markMatched(a, b, 'you');
      toast('Nice pair! Go again 🙌');
      S.up = []; S.busy = false;
      if (!remaining()) return finish();
    } else {
      sfx.miss();
      await sleep(550);
      if (my !== gameId) return;
      flipDown(a); flipDown(b);
      S.up = []; S.busy = false;
      brainTurn();
    }
  }

  async function brainTurn() {
    const my = gameId;
    setTurn('brain');
    await S.queue; // let the brain finish "seeing" the human's cards
    while (my === gameId && remaining()) {
      await sleep(500);
      const hidden = S.matched.map((m, i) => (m === null ? i : -1)).filter((i) => i >= 0);
      const first = hidden[Math.floor(Math.random() * hidden.length)];
      flipUp(first);
      await observe(first);
      if (my !== gameId) return;

      const f = S.faces[first];
      const exclude = [first, ...S.matched.map((m, i) => (m !== null ? i : -1)).filter((i) => i >= 0)];
      status(`⚡ Recalling: zapping face <b>${FACES[f]}</b> 3×, listening for which slot fires…`);
      setBars(new Array(12).fill(0), exclude);
      const ev = S.brain.recall(f, exclude);
      await animate(ev, 4);
      if (my !== gameId) return;
      const second = ev.choice;
      setBars(ev.counts, exclude, second);
      status(ev.guessed
        ? `🤔 No clear memory for <b>${FACES[f]}</b>. Guessing slot <b>${SLOTS[second]}</b>.`
        : `💡 Slot <b>${SLOTS[second]}</b> fired loudest (${ev.counts[second]} spikes). Flipping it!`);
      const c2 = cardEl(second);
      c2.classList.add('considering');
      await sleep(900);
      c2.classList.remove('considering');
      if (my !== gameId) return;
      flipUp(second);
      await observe(second);
      if (my !== gameId) return;
      await sleep(400);
      if (S.faces[first] === S.faces[second]) {
        markMatched(first, second, 'brain');
        toast(ev.guessed ? 'Lucky guess by the brain 🍀' : 'The brain remembered! 🧠');
        if (!remaining()) return finish();
      } else {
        sfx.miss();
        toast('Brain missed! Your turn');
        await sleep(700);
        if (my !== gameId) return;
        flipDown(first); flipDown(second);
        break;
      }
    }
    if (my !== gameId) return;
    setTurn('you');
    status('Your turn. Every card you flip is <b>written into the brain</b> too.');
  }

  function finish() {
    const { you, brain } = S.score;
    setTurn('done');
    $('turnLabel').textContent = 'Game over';
    let emoji, title;
    if (you > brain) {
      emoji = '🏆'; title = 'You win!'; sfx.win(); confetti();
      const w = store.get('nm-wins', 0) + 1; store.set('nm-wins', w); $('bestScore').textContent = w;
    } else if (brain > you) { emoji = '🧠'; title = 'Brain wins!'; sfx.lose(); }
    else { emoji = '🤝'; title = "It's a draw"; sfx.win(); }
    $('modalEmoji').textContent = emoji;
    $('modalTitle').textContent = title;
    const junk = S.brain.junkMean();
    $('modalText').textContent = `You ${you} : ${brain} Brain. Its memory lived in ${S.faces.length} face→slot links (plus ${junk.toFixed(2)} mV of noise links).`;
    setTimeout(() => { $('modal').hidden = false; }, 700);
  }

  /* ---------------- confetti ---------------- */
  function confetti() {
    const cv = $('confetti'), ctx = cv.getContext('2d');
    cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#ffe234', '#f7931e', '#6b2a95', '#7bd389', '#3ec7ff', '#ff5d8f'];
    const ps = Array.from({ length: 160 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function step(now) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ps.forEach((p) => {
        p.x += p.vx; p.y += p.vy; p.r += p.vr; p.vy += 0.04;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (now - t0 < 3500) requestAnimationFrame(step); else ctx.clearRect(0, 0, cv.width, cv.height);
    })(t0);
  }
})();
