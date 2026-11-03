# Neuron Memory: the card game played by a brain

*Working title. Biocomputing Hack, Tuesday 3 Nov 2026. Handover document: everything needed to build the game, including what has and has not been verified.*

A real-life Memory (Concentration) card game where you play against a brain. The brain watches every card that gets flipped, stores **where it saw each face** in its neuron connections, and later uses that memory to find matching pairs. Nothing about the board is stored in Python game state that the brain can read: its memory lives in the (simulated) neuron connections.

> **Simulator only.** We build on the Cortical Labs `cl` SDK with the hackathon repo's leaky integrate-and-fire (LIF) simulator, not on real tissue. Present results as simulation results.

**Status legend used throughout:** ✅ verified by running code · 🔍 read directly in source code · ⚠️ written but NOT run yet, verify first

---

## 0. Repositories and where to build

| Repo | Role | What to do with it |
|---|---|---|
| `https://github.com/wbmills/biocompute-outlier-labs` | Hackathon starter repo. Contains the LIF simulator (`src/organoid_simulator/lif_data_source.py`), a `.env` that makes it the default, an example experiment, and the `uv` project setup. Last commit seen: `a8e9988` (2026-11-03). | **Build the game inside this repo** (fork or clone it). The simulator must stay importable as `organoid_simulator.lif_data_source:make_lif_source`. |
| `https://github.com/Cortical-Labs/cl-sdk` | Source of the `cl` SDK + simulator. Version on `main` is **1.0.0** (last commit `a9a2f9c`, 2026-06-11), the same version the starter repo pins. | **Do not clone or copy it into the project.** `uv sync` installs it from PyPI as `cl-sdk==1.0.0`. Use the GitHub repo only to read source when something is unclear. |

Docs: `https://docs.corticallabs.com` (CL API). Tutorials (Jupyter, run on the simulator): `https://github.com/Cortical-Labs/cl-api-doc`.

Suggested layout inside the starter repo:

```
biocompute-outlier-labs/
├── .env                                   # already selects the LIF simulator
├── pyproject.toml / uv.lock               # Python 3.13, cl-sdk==1.0.0
├── src/organoid_simulator/
│   └── lif_data_source.py                 # PATCH THIS (section 6a)
├── experiments/
│   ├── example1.py                        # existing sanity check
│   └── memory_recall_test.py              # ADD (section 6b)
└── game/                                  # NEW: the game (section 7)
```

If the team's repo is a different one: either work in a fork of `biocompute-outlier-labs`, or copy its `src/organoid_simulator/`, `pyproject.toml`, `uv.lock` and `.env` across. The simulator factory must live in an installed, importable package: the SDK builds the data source **in a separate subprocess** and imports the factory by name, so factories defined in notebooks or in `__main__` are rejected.

---

## 1. Setup

```bash
git clone https://github.com/wbmills/biocompute-outlier-labs   # or the team's fork
cd biocompute-outlier-labs
uv sync                                    # needs Python 3.13 (>=3.13,<3.14) and uv
uv run python experiments/example1.py      # sanity check: zaps channel 27, opens the viewer
```

`example1.py` expected output per the repo README (seed 42, 5 s run): about 1.10 spikes per tick on ch27 after a stim vs 0.24 without.

Notes:
- `import cl` calls `load_dotenv()`, so the repo-root `.env` applies to any script run from the repo root. It contains:
  ```
  CL_SDK_DATA_SOURCE=organoid_simulator.lif_data_source:make_lif_source
  CL_SDK_DATA_SOURCE_CONFIG={"random_seed": 42}
  ```
- Override parameters in code (takes precedence over `.env`); this call raises `RuntimeError` on a real CL1, so guard it:
  ```python
  if cl.is_simulator():
      cl.sim.set_simulator_data_source("organoid_simulator.lif_data_source:make_lif_source", config={...})
  ```
  Or per run: `CL_SDK_DATA_SOURCE_CONFIG='{"random_seed": 7}' uv run python ...`
- Other env vars: `CL_SDK_ACCELERATED_TIME=1` (faster than real time, viewer disabled), `CL_SDK_VISUALISATION=0` (viewer off), `CL_SDK_WEBSOCKET_PORT` (default 1025), `CL_SDK_WEBSOCKET_HOST`.
- Built-in live viewer (8×8 grid with traces, spikes and stims): its URL is printed at start-up, e.g. `http://127.0.0.1:8000/visualiser` (port increments if busy). It exists only while the script runs, in real time. `example1.py` gets the URL via `getattr(neurons, "_websocket_server", None).web_url` (private attribute, no public accessor).

---

## 2. The game idea

The 64 electrodes are split into two groups:

- **Face electrodes ("what")**: one electrode per card face (4 faces for 8 cards).
- **Slot electrodes ("where")**: one electrode per board position (8 slots, A–H).

| Moment | What we do | What happens in the brain |
|---|---|---|
| **Seeing** a card (any flip, by anyone) | Clear → zap the face electrode → zap the slot electrode 5 ms later → reward | The face → slot connection gets stronger (timing-based learning: face fires before slot, so face→slot grows) |
| **Recalling** (brain's turn) | Brain holds a card showing face *f*. Zap face *f* (1–3 times) | Spikes travel along learned links; the slot where *f* was seen fires most |
| **Deciding** | Count spikes on each slot electrode; ignore the card in hand and already-matched cards | Loudest slot = the brain's guess |

Example: the brain sees a **4** in slot **C**. Four flips later, slot **G** shows a 4. Zapping face "4" makes slot C fire, so the brain flips C. Match.

Why it feels like real life: it remembers **everything it sees** (including the human's flips), seeing a card twice makes the memory **stronger**, and it's **fuzzy**, so it sometimes picks the wrong slot.

---

## 3. Results so far ✅

### 3a. Memory test (the key result)

**Setup:** 8 cards (4 pairs), random board, the brain sees every card exactly once in random order. Then, for each of the 8 cards, it's asked "where is the matching card?" 6 boards per setting = 48 questions per cell. **Random guessing scores 14% (1 in 7).** "Zaps" = number of times the face electrode is zapped and spikes summed before deciding.

| Brain noise (`background_drive_std_mV`) | Untrained brain (1 / 3 / 10 zaps) | **Trained brain (1 / 3 / 10 zaps)** | Mean strength of card links | Mean strength of all other links |
|---|---|---|---|---|
| 0.35 (calm) | 15% / 0% / 8% | **79% / 94% / 100%** | ~21 mV | 0.02 mV |
| 0.45 (medium) | 10% / 10% / 23% | **42% / 56% / 52%** | ~21 mV | 0.19 mV |
| 0.52 (noisy) | 10% / 2% / 17% | 25% / 10% / 8% | ~22 mV | 1.5 mV |
| 0.60 (repo default) | 23% / 8% / 12% | 17% / 12% / 10% | ~20 mV | 3.2 mV |

Settings: `plasticity=True, stdp=True, plasticity_lr=25, weight_max_mV=25` (the 0.60 row used `weight_max_mV=20`), all other LIF parameters default, `random_seed` = board index 0–5, board layout seeded with `1000 + board`. With 48 questions per cell, expect roughly ±7–14% wobble.

**Interpretation:**
- **The memory is real.** The untrained brain scores around chance; the trained brain finds pairs.
- **Noise is the difficulty dial.** A noisy brain fires randomly *while learning*, so random "junk" links get saved too (see last column) and drown the memory. 0.35 = memory champion, 0.45 = forgetful human (best opponent), ≥0.52 = useless.
- **More zaps help** a calm brain (noise averages out) but don't rescue a noisy one.

**How it was run (important for reproducing):** PyPI was blocked in the environment where this was tested, so `uv sync` could not run. Instead, `lif_data_source.py` was imported with a minimal stub of `cl.sim` (copied from cl-sdk's `src/cl/sim/_data_source.py`) and the `LIFDataSource` was driven **directly** in one process: `open()`, `on_stims([...])`, `read(t, n_frames)`, `apply_reward(r)`, `coupling_weights`. It did **not** go through `cl.open()` / `neurons.loop()`. Learning was triggered by calling `src.apply_reward()` directly, which a real game script cannot do (section 4.6). Exact protocol:
- Seeing: `apply_reward(0.0)` (clear) → `on_stims([face pulse at t, slot pulse at t+5 ms])` → `read` 8 ms → `apply_reward(1.0)` → `read` 100 ms of quiet.
- Recall, per zap: face pulse at t → `read` 30 ms → count slot-electrode spikes with timestamp 0–25 ms after t → `read` 70 ms. After all recall questions: `apply_reward(0.0)`.
- Untrained recall was measured on the fresh brain before any seeing; trained recall after all 8 cards were seen.
- Pulse: phases `(200 µs, -1.5 µA), (200 µs, +1.5 µA)`.

### 3b. Scaling test (number of neurons)

| `n_units` | Speed (learning off, `coupling_gain_mV=4.0`) |
|---|---|
| 64 (default) | 1.7× faster than real time |
| 1,000 | 1.7× slower than real time |
| 10,000 | 13× slower |
| 50,000 | 73× slower |

🔍 Any `n_units` other than 64 switches the model to "spatial mode", where `plasticity=True` or `stdp=True` **raises `NotImplementedError`**. So: **stay at 64 neurons.** Extra neurons also don't add electrodes (still 64 to zap and read). With learning on at 64 neurons, the memory test ran roughly 1.3× faster than real time.

### 3c. Earlier finding: pairing with default learning settings

With `plasticity=True, stdp=True` and default `plasticity_lr=0.02, weight_max_mV=6`, 60 repeated A→B pairings grew the A→B link from 0 to ~0.7 mV (or to the 6 mV cap with `plasticity_lr=0.2`). That is far too weak to fire a neuron (needs ~20 mV), which is why the memory test uses `plasticity_lr=25, weight_max_mV=25` (one look is enough).

---

## 4. Facts about the SDK and simulator

### 4.1 Data format 🔍
- 64 channels, 25 kHz, int16 samples (0.195 µV per unit). **All timestamps are in frames; 1 frame = 40 µs**, so 1 ms = 25 frames.
- Electrode grid mapping in the LIF model: `row = channel % 8`, `col = channel // 8` (i.e. `channel = row + 8*col`).

### 4.2 Core API (`cl-sdk` 1.0.0) 🔍

```python
import cl

with cl.open() as neurons:                       # cl.open(take_control=True, wait_until_recordable=True)
    for tick in neurons.loop(ticks_per_second=100, stop_after_seconds=10):
        tick.iteration               # tick count
        tick.iteration_timestamp     # frame timestamp of this tick
        tick.analysis.spikes         # spikes detected since the previous tick
        tick.analysis.stims          # stims delivered since the previous tick
        tick.frames                  # raw samples
        for spike in tick.analysis.spikes:
            spike.timestamp, spike.channel        # frame of detection, electrode
        neurons.stim(cl.ChannelSet(27), cl.StimDesign(200, -1.5, 200, 1.5))
```

- `neurons.loop(ticks_per_second, stop_after_seconds=None, stop_after_ticks=None, ignore_jitter=False, jitter_tolerance_frames=0)`. On a CL1, an overrunning loop body raises `TimeoutError`; the simulator only prints a warning. Use `Loop.recover_from_jitter()` for deliberate pauses.
- `neurons.stim(channel_set, stim_design, burst_design=None, lead_time_us=80)`:
  - Inside a loop, the stim is scheduled relative to **the current tick's timestamp** plus `lead_time_us`.
  - `lead_time_us` must be **≥ 80 and divisible by 40**. This lets one tick schedule several pulses at precise offsets (e.g. 80, 2080, 7080 µs).
- `cl.StimDesign(d1, i1, d2, i2[, d3, i3])`: durations in µs, **divisible by 20**; currents **|i| ≤ 3.0 µA**; total charge **≤ 3 nC**. Cathodic (negative) first by convention. A scalar current `x` means `StimDesign(160, -x, 160, x)`.
- `cl.ChannelSet(*channels)`; supports `|`, `&`, `^`, `~`.
- **⚠️ Gotcha: the SDK silently drops stims on channels 0, 7, 56, 63** (grounded, `_NON_STIMMABLE_CHANNELS` in `neurons.py`). No error, nothing happens.
- Also available: `neurons.timestamp()`, `neurons.get_frames_per_second()`, `neurons.record(...)` (HDF5), `cl.is_simulator()`.

### 4.3 How stims reach the simulator 🔍
The simulator's producer forwards committed stims to `data_source.on_stims([...])` **before** calling `read()` for the window containing their timestamp. A stim whose frames were already generated is applied at the first frame not yet generated. Each stim arrives as `DataSourceStim(timestamp, channel, intended_timestamp, phase_durations_us, phase_currents_uA)`.

### 4.4 The LIF model (`lif_data_source.py`) 🔍
- One LIF neuron per channel: membrane tau 20 ms, rest −70 mV, threshold −50 mV, reset −75 mV, refractory 2 ms. Gaussian background drive (`background_drive_std_mV`, default 0.60).
- Stim drive: `stim_gain_mV_per_uA = 5.0` per frame, **cathodic phase only**. A 200 µs × 1.5 µA pulse reliably makes the stimulated neuron spike.
- **Channels 0, 4, 7, 56, 63 never spike** (grounded + reference). Don't use them for cards.
- Coupling: when neuron *j* spikes, every neuron *i* gets `W[i, j]` mV added **on the next frame (40 µs later)**. There are no conduction or synaptic delays, so **learned recall is near-instant**.
- `coupling_gain_mV` defaults to 0. With `plasticity=True`, coupling is enabled and **all links start at 0** (measured), so nothing bleeds to neighbours until learned.
- Learning parameters: `plasticity` (default False), `plasticity_lr` (0.02), `eligibility_tau_ms` (200), `weight_max_mV` (6.0), `stdp` (False), `stdp_tau_pre_ms` / `stdp_tau_post_ms` (20), `stdp_ltd_ratio` (0.5).
- How learning works: during `read()`, co-activity accumulates in an eligibility trace `elig` (with `stdp=True`: pre-before-post within ~20 ms strengthens pre→post; post-before-pre weakens it). **Nothing is saved until `apply_reward(r)`**: `W += plasticity_lr * r * elig`, clipped to `[0, weight_max_mV]`, diagonal and non-spiking channels zeroed, then `elig` is reset to 0. So `apply_reward(0.0)` = "forget recent co-activity without saving".
- `coupling_weights` property returns `W` as `W[post, pre]`.
- `stim_artifact` (default False) is cosmetic only.

### 4.5 Learning is per run
Learned links live in the running simulator process; every new run starts from zero. (Real neurons also forget: Robbins et al. 2026 saw learning vanish after a 45-minute rest.)

### 4.6 The big blocker: the game can't call `apply_reward()`
The data source runs in the SDK's simulator **subprocess**, so experiment or game code cannot call `apply_reward()` or read `coupling_weights`. The fix is a signal channel (section 6a).

---

## 5. Settings for the game

```python
if cl.is_simulator():
    cl.sim.set_simulator_data_source(
        "organoid_simulator.lif_data_source:make_lif_source",
        config={
            "random_seed": 42,
            "plasticity": True,
            "stdp": True,
            "plasticity_lr": 25.0,
            "weight_max_mV": 25.0,
            "background_drive_std_mV": 0.45,   # difficulty: 0.35 expert, 0.45 human-like
        },
    )
```

Noise is fixed when the simulator starts, so changing difficulty means restarting the session (and the brain's memory).

### Electrode map (8 cards)

| Role | Channels |
|---|---|
| Faces 1–4 | 9, 14, 49, 54 |
| Slots A–H | 18, 21, 27, 30, 34, 37, 42, 45 |
| Signal channel (after patch 6a) | 4 |
| Never use for cards | 0, 4, 7, 56, 63 |

### Pulses and timing

| Purpose | Pulse | When |
|---|---|---|
| Card (face or slot) | `cl.StimDesign(200, -1.5, 200, 1.5)` | |
| Signal: clear | channel 4, `cl.StimDesign(200, -1.0, 200, 1.0)` | |
| Signal: reward | channel 4, `cl.StimDesign(200, -2.0, 200, 2.0)` | |
| **Seeing** a card | clear → face → slot → reward | offsets 0, +2, +7, +10 ms (slot 5 ms after face; reward 3 ms after slot), then ≥100 ms quiet |
| **Recall** zap | face pulse; count slot spikes 0–25 ms after it | 100 ms per zap; 1–3 zaps per decision |

---

## 6. Code to add

### 6a. Signal-channel patch for `lif_data_source.py` ⚠️ (not run yet)

Turns pulses on **channel 4** into learning signals: first-phase |current| ≥ 1.5 µA → `apply_reward(1.0)`; smaller → `apply_reward(0.0)` (clear). Signals are applied **at their exact frame** inside `read()`, so a reward only saves spikes that have already happened, whatever the read batch size.

Why channel 4: the SDK drops stims on 0, 7, 56, 63, but channel 4 is stimmable, and the LIF model never lets it spike. This is a simulator-only hack; on a CL1, channel 4 is the reference electrode and reward would have to be biological.

Save as `scripts/apply_signal_patch.py` and run `uv run python scripts/apply_signal_patch.py src/organoid_simulator/lif_data_source.py`, or apply the four edits by hand:

```python
"""Adds a reward/clear signal channel to organoid_simulator/lif_data_source.py.

Usage: python apply_signal_patch.py path/to/lif_data_source.py
"""
import sys

path = sys.argv[1]
src = open(path).read()

edits = [
    # 1. module constants
    (
        "NON_SPIKING        = frozenset(GROUNDED_CHANNELS + REFERENCE_CHANNELS)\n",
        "NON_SPIKING        = frozenset(GROUNDED_CHANNELS + REFERENCE_CHANNELS)\n"
        "\n"
        "# Memory-game signal channel. Channel 4 is the reference electrode: the SDK lets\n"
        "# you stimulate it (only 0, 7, 56, 63 are silently dropped) and this model never\n"
        "# lets it spike, so a pulse there can carry a message instead of a stimulus.\n"
        "# First-phase |current| >= 1.5 uA -> apply_reward(+1) (save recent co-activity);\n"
        "# smaller -> apply_reward(0) (clear the eligibility trace without saving).\n"
        "SIGNAL_CHANNEL        = 4\n"
        "SIGNAL_REWARD_MIN_UA  = 1.5\n",
    ),
    # 2. state
    (
        "        self._next_read_ts      : int = 0                      # first frame the next read() produces\n",
        "        self._next_read_ts      : int = 0                      # first frame the next read() produces\n"
        "        self._pending_signals   : list[tuple[int, float]] = []  # (ts, reward), sorted by ts\n",
    ),
    # 3. on_stims: intercept signal pulses
    (
        "        for stim in stims:\n"
        "            start_ts     = max(int(stim.timestamp), self._next_read_ts)\n",
        "        for stim in stims:\n"
        "            if stim.channel == SIGNAL_CHANNEL:\n"
        "                first_uA = abs(stim.phase_currents_uA[0]) if stim.phase_currents_uA else 0.0\n"
        "                reward   = 1.0 if first_uA >= SIGNAL_REWARD_MIN_UA else 0.0\n"
        "                sig_ts   = max(int(stim.timestamp), self._next_read_ts)\n"
        "                self._pending_signals.append((sig_ts, reward))\n"
        "                self._pending_signals.sort(key=lambda s: s[0])\n"
        "                continue\n"
        "            start_ts     = max(int(stim.timestamp), self._next_read_ts)\n",
    ),
    # 4. read(): apply signals at their exact frame
    (
        "        for step in range(frame_count):\n"
        "            ts = from_timestamp + step\n",
        "        for step in range(frame_count):\n"
        "            ts = from_timestamp + step\n"
        "\n"
        "            # Memory-game signals fire at their exact frame, so a reward only\n"
        "            # saves spikes that have already happened. apply_reward() edits W\n"
        "            # and elig in place, so the local references above stay valid.\n"
        "            while self._pending_signals and self._pending_signals[0][0] <= ts:\n"
        "                self.apply_reward(self._pending_signals.pop(0)[1])\n",
    ),
]

for old, new in edits:
    if src.count(old) != 1:
        sys.exit(f"Patch anchor not found exactly once:\n{old}")
    src = src.replace(old, new)

open(path, "w").write(src)
print(f"patched {path}")
```

The anchors were checked against the starter repo at commit `a8e9988`. Safe in-place use within `read()`: `apply_reward()` modifies `self._W` and `self._elig` in place (`+=`, `np.clip(..., out=...)`, `[...] = 0`), so the cached local references `W` and `elig` in `read()` stay valid.

### 6b. Memory recall test (uses the patch) ⚠️ (not run yet)

Same protocol as the verified test in 3a, but every learning signal goes through channel 4 instead of direct `apply_reward()` calls. **Run this first after applying the patch.** If it reproduces the 3a numbers (0.35 → ~79/94/100%, 0.45 → ~42/56/52%), the patch works. Save as `experiments/memory_recall_test.py`:

```python
"""Memory-game recall test for the LIF organoid simulator.

Drives LIFDataSource directly (open / on_stims / read), in one process, without
cl.open() or neurons.loop(). All learning signals go through the SIGNAL_CHANNEL
patch (channel 4), exactly as a real game script would send them.

Board: 8 cards = 4 faces x 2. One electrode per face, one per slot.
  Seeing a card: clear -> zap face -> zap slot 5 ms later -> reward 3 ms after slot.
  Recall: zap the in-hand card's face, count spikes on each slot electrode 0-25 ms
          after the zap, ignore the in-hand slot, pick the loudest.
Random guessing = 1/7 (14%).

Run from the repo root after patching lif_data_source.py:
    uv run python experiments/memory_recall_test.py --noise 0.45 --boards 6
"""
from __future__ import annotations

import argparse
import json

import numpy as np
from cl.sim import DataSourceStim
from organoid_simulator.lif_data_source import LIFDataSource

FPS = 25_000                       # frames per second; all timestamps are in frames
FACES = [9, 14, 49, 54]            # face electrodes ("what")
SLOTS = [18, 21, 27, 30, 34, 37, 42, 45]   # slot electrodes ("where"), slots A-H
SIGNAL_CH = 4                      # patched: |first phase| >= 1.5 uA = reward, else clear
CLEAR_UA, REWARD_UA = 1.0, 2.0
STIM_UA = 1.5                      # card pulses: 200 us per phase, cathodic first


def ms(x: float) -> int:
    return int(x * FPS / 1000)


def pulse(ch: int, at: int, ua: float = STIM_UA) -> DataSourceStim:
    return DataSourceStim(timestamp=at, channel=ch, phase_durations_us=(200, 200), phase_currents_uA=(-ua, ua))


def play_board(board: int, noise: float, lr: float, wmax: float, zaps: list[int]) -> dict:
    rng = np.random.default_rng(1000 + board)
    face_of_slot = rng.permutation([0, 0, 1, 1, 2, 2, 3, 3])
    src = LIFDataSource(random_seed=board, plasticity=True, stdp=True, plasticity_lr=lr,
                        weight_max_mV=wmax, background_drive_std_mV=noise)
    src.open()
    t = 0

    def window(stims: list[DataSourceStim], length_ms: float) -> list[tuple[int, int]]:
        nonlocal t
        src.on_stims(stims)
        batch = src.read(t, ms(length_ms))
        start, t = t, t + ms(length_ms)
        return [(s.timestamp - start, s.channel) for s in batch.spikes]

    def see(slot: int) -> None:
        face_ch = FACES[face_of_slot[slot]]
        window([pulse(SIGNAL_CH, t, CLEAR_UA),          # forget stray co-activity
                pulse(face_ch, t + ms(2)),               # what
                pulse(SLOTS[slot], t + ms(7)),           # where, 5 ms later
                pulse(SIGNAL_CH, t + ms(10), REWARD_UA)  # save it
                ], 12)
        window([], 100)

    def recall_all() -> list[tuple[int, int, np.ndarray]]:
        out = []
        for hand in range(8):
            counts = np.zeros((max(zaps), 8))
            for z in range(max(zaps)):
                for dt, ch in window([pulse(FACES[face_of_slot[hand]], t)], 30):
                    if ch in SLOTS and 0 <= dt <= ms(25):     # recall is near-instant in this model
                        counts[z, SLOTS.index(ch)] += 1
                window([], 70)
            target = next(s for s in range(8) if s != hand and face_of_slot[s] == face_of_slot[hand])
            out.append((hand, target, counts))
        window([pulse(SIGNAL_CH, t, CLEAR_UA)], 5)      # probing never teaches
        return out

    def score(results, k: int) -> int:
        correct = 0
        for hand, target, counts in results:
            total = counts[:k].sum(axis=0)
            total[hand] = -1                             # the card in hand is not an answer
            best = np.flatnonzero(total == total.max())
            correct += int(rng.choice(best) == target)   # random tie-break
        return correct

    untrained = recall_all()
    for slot in rng.permutation(8):                      # brain sees every card once
        see(slot)
    w = src.coupling_weights                             # W[post, pre]
    card_w = [w[SLOTS[s], FACES[face_of_slot[s]]] for s in range(8)]
    trained = recall_all()
    return {"untrained": {k: score(untrained, k) for k in zaps},
            "trained": {k: score(trained, k) for k in zaps},
            "card_links_mV": float(np.mean(card_w)),
            "other_links_mV": float((w.sum() - sum(card_w)) / (w.size - 8))}


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--noise", type=float, default=0.45, help="background_drive_std_mV (difficulty)")
    p.add_argument("--lr", type=float, default=25.0, help="plasticity_lr")
    p.add_argument("--wmax", type=float, default=25.0, help="weight_max_mV")
    p.add_argument("--boards", type=int, default=6)
    a = p.parse_args()
    zaps = [1, 3, 10]
    tot = {c: {k: 0 for k in zaps} for c in ("untrained", "trained")}
    card, other = [], []
    for b in range(a.boards):
        r = play_board(b, a.noise, a.lr, a.wmax, zaps)
        for c in tot:
            for k in zaps:
                tot[c][k] += r[c][k]
        card.append(r["card_links_mV"])
        other.append(r["other_links_mV"])
    n = 8 * a.boards
    print(json.dumps({"noise": a.noise, "lr": a.lr, "wmax": a.wmax, "questions": n,
                      "untrained_%_by_zaps": {k: round(100 * v / n) for k, v in tot["untrained"].items()},
                      "trained_%_by_zaps": {k: round(100 * v / n) for k, v in tot["trained"].items()},
                      "card_links_mV": round(float(np.mean(card)), 2),
                      "other_links_mV": round(float(np.mean(other)), 3)}))


if __name__ == "__main__":
    main()
```

To reproduce the **verified** (unpatched) version from 3a instead: in `see()`, replace the four pulses with `src.apply_reward(0.0)`, then `window([face pulse at t, slot pulse at t + ms(5)], 8)`, then `src.apply_reward(1.0)`, then `window([], 100)`. At the end of `recall_all()`, replace the clear pulse with `src.apply_reward(0.0)`. Runtime: about 13 s per board (78 s for 6 boards) on a laptop-class CPU.

### 6c. Export links for visuals (nice to have, not written)

The game can't read `coupling_weights` (subprocess). Option: at the end of `apply_reward()` in the patched source, write the face→slot block of `self._W` to a JSON file, writing a temp file and renaming it so the game never reads half a file. The game polls it each frame and draws glowing lines with thickness = link strength. Only face→slot entries matter (4×8 values).

---

## 7. The game (to build)

### 7a. Rules
- 8 cards (4 pairs) to start. Human and brain take turns, as in normal Memory: flip two cards; a match is kept and the player goes again (or not; team's choice); no match → both flip back.
- **Every flip by either player is "seen" by the brain** (seeing protocol). That's how it learns the board.
- Brain's turn:
  1. Flip a face-down card. Simple version: random face-down card (game logic, not neurons). It is "seen".
  2. Zap that card's face 1–3 times; sum spikes per slot electrode in 0–25 ms after each zap.
  3. Exclude the card in hand and matched cards; flip the loudest slot (random tie-break). It is "seen".
  4. Score and continue.
- Difficulty slider = `background_drive_std_mV` (0.35 expert, 0.45 human-like); set before the game starts.
- Scoreboard: Humans vs Neurons. Optional: 12–16 cards once 8 works (recall noise is the limit, not electrode space).

### 7b. Neuron loop design ⚠️ (untested end-to-end)

```python
import cl

CARD   = cl.StimDesign(200, -1.5, 200, 1.5)
CLEAR  = cl.StimDesign(200, -1.0, 200, 1.0)
REWARD = cl.StimDesign(200, -2.0, 200, 2.0)
SIGNAL = 4

def see(neurons, face_ch, slot_ch):
    # one call sequence inside a single tick, offsets via lead_time_us (>=80, multiple of 40)
    neurons.stim(SIGNAL,  CLEAR,  lead_time_us=80)       # t+0 ms  clear
    neurons.stim(face_ch, CARD,   lead_time_us=2080)     # t+2 ms  what
    neurons.stim(slot_ch, CARD,   lead_time_us=7080)     # t+7 ms  where (5 ms after face)
    neurons.stim(SIGNAL,  REWARD, lead_time_us=10080)    # t+10 ms save
    # then leave >=100 ms (e.g. 10 ticks at 100 Hz) before the next see()/zap
```

Recall: zap the face (`lead_time_us=80`), note the stim's timestamp (`tick.iteration_timestamp + 2` frames, or read it from `tick.analysis.stims`), then over the next ticks collect `spike.channel` for spikes on slot channels with `stim_ts <= spike.timestamp <= stim_ts + 625` (625 frames = 25 ms). Wait ≥3 ticks at 100 Hz before deciding. Repeat 1–3 zaps 100 ms apart.

Architecture:
- Run the neuron loop (e.g. 100 ticks/s) in its own thread or process. It owns `cl.open()` and processes a queue of commands (`see(slot)`, `recall(face)`) from the game, returning results.
- Run the game UI separately (pygame window or a small web page). Keep the loop body tiny, and never draw inside it.
- Run in real time (not accelerated) for the demo so the built-in viewer works.

### 7c. Visuals and demo
- Neon card board; brain panel = the SDK's built-in viewer (8×8 grid, live spikes) or a custom grid driven by `tick.analysis.spikes`.
- Memory web (6c): glowing face→slot lines that thicken as the brain learns.
- Demo moments: (1) untrained vs trained brain on the same board; (2) raise noise and watch it forget; (3) audience member plays against it.

---

## 8. Gotchas (learned the hard way)

1. **Count recall spikes from 0 ms.** In this model, learned links fire the target on the next frame (<1 ms). An earlier version counted from 2 ms and wrongly concluded recall was at chance. On a real CL1, responses come a few ms later and the stimulation artifact must be excluded, so the window would change.
2. **Noise ruins learning, not just recall.** Random spikes during the learning window get saved as junk links. Keep the window between clear and reward short (~8–10 ms) and always clear first.
3. **Channels 0, 7, 56, 63 can't be stimulated** (silently dropped by the SDK). Channels 0, 4, 7, 56, 63 never spike in the model.
4. **Stay at 64 neurons** (`n_units` ≠ 64 disables learning and is slow).
5. **Default learning settings are far too weak** for one-look memory (3c). Use `plasticity_lr=25, weight_max_mV=25`.
6. **The SDK's own default simulator** emits random spikes and ignores stimulation. Make sure the `.env` / `set_simulator_data_source` selects the LIF source.
7. **The simulator data source runs in a subprocess.** No direct calls into it from game code; communicate through stims (signal channel) or files.
8. **Memory resets every run.**

## 9. Open questions to verify (in this order)

1. Does `memory_recall_test.py` with the patch reproduce section 3a? (Validates patch 6a.)
2. Does a minimal `cl.open()` + `neurons.loop()` script reproduce the same see → recall result in real time? (Validates 7b timing: `lead_time_us` scheduling, spike timestamps, spike delivery through `tick.analysis.spikes`.)
3. Does it still work with `CL_SDK_ACCELERATED_TIME=1` (useful for fast testing)?
4. Is there a maximum `lead_time_us`? (Not checked.)

---

## 10. Pitch notes and context

- **One-liner:** "A memory game where the opponent's memory lives in neuron connections, not in code."
- **Closed loop**, like DishBrain Pong: stimulate → record → decode → feedback.
- **Honest limits:** simulated neurons; tuned settings; one-look learning that real tissue wouldn't manage; real neurons are noisier, slower and forget within minutes to hours.
- **Rigor:** always show the untrained brain and random guessing as baselines.

Background reading (picked by Will at Callosum):
- Smirnova & Hartung (2022), *Neuronal cultures playing Pong: first steps toward advanced screening and biological computing*, Neuron 110:3855–3856. Commentary on Cortical Labs' DishBrain (Kagan et al. 2022): ~800,000 neurons on an electrode array learned to play Pong from feedback (predictable stimulation on a hit, random noise on a miss).
- Robbins et al. (2026), *Goal-directed learning in cortical organoids*, Cell Reports 45:116984. Mouse cortical organoids learned to balance a virtual pole with an RL "coach" choosing training stimulation: 46% success vs 4.4% random and 2.3% no feedback; learning needed glutamate receptors (AMPA/NMDA) and was gone after a 45-minute rest. Open-source tool: BrainDance.
- Loeffler et al. (2026), *Handwritten digit classification with neural cultures is influenced by neural architecture, network dynamics, and decoding methods*, bioRxiv 2026.08.10.743829. Reservoir computing on the CL1: modular cortical cultures did best (~47% vs 10% chance); including the stimulation window let a **cell-free saline dish** score 44%, so controls are essential.

Companies at the event:
- **Cortical Labs**: makes the CL1 (lab-grown neurons on a silicon electrode chip, programmable from Python via the CL API, neurons kept alive up to 6 months).
- **Callosum** (organisers): "The Intelligent Systems Company"; infrastructure where different kinds of chips and AI models work together.
- **Frontier Computing** (Cambridge, UK, YC S26): growing larger neuronal tissue to break the ~1M-neuron limit; their neurons learned Frogger (92% cross rate after 1 hour).

## 11. Suggested 2-hour plan

| Time | Task |
|---|---|
| 0:00–0:15 | `uv sync`, run `example1.py`, apply patch 6a, run `memory_recall_test.py` (open question 1) |
| 0:15–0:45 | Minimal `cl.open()` loop: see one card, recall it (open question 2); then the neuron-loop worker with a command queue |
| 0:45–1:20 | Game UI: board, turns, brain's turn, scoreboard, difficulty |
| 1:20–1:40 | Memory web visuals (6c) if time allows |
| 1:40–2:00 | Untrained vs trained comparison, rehearse demo |
