# Neuron Memory: the card game played by a brain

*Working title. Biocomputing Hack, Tuesday 3 Nov 2026.*

A real-life Memory (Concentration) card game where you play against a brain. The brain watches every card that gets flipped, stores **where it saw each face** in its neuron connections, and later uses that memory to find matching pairs. Nothing about the board is stored in our Python code: the brain's memory lives in the (simulated) neurons.

> **Built on a simulator.** We run on the Cortical Labs `cl` SDK with this repo's leaky integrate-and-fire (LIF) simulator, not on real tissue. The same experiment code is designed to run on a CL1, but our results are simulation results and should be presented that way.

---

## 1. The idea in one picture

The 64 electrodes are split into two groups:

- **Face electrodes ("what")**: one electrode per card face (4 faces for 8 cards).
- **Slot electrodes ("where")**: one electrode per board position (8 slots, A–H).

| Moment | What we do | What happens in the brain |
|---|---|---|
| **Seeing** a card (any flip, by anyone) | Zap the card's face electrode, then its slot electrode 5 ms later, then send a reward | The face → slot connection gets stronger ("what fires together wires together") |
| **Recalling** (brain's turn) | Brain holds a card showing face *f*. Zap face *f* a few times | Spikes travel along learned links; the slot where *f* was seen fires loudest |
| **Deciding** | Count spikes on every slot electrode, ignore the card in hand and matched cards | Loudest slot = the brain's guess |

Example: the brain sees a **4** in slot **C**. Four flips later, slot **G** shows a 4. Zapping face "4" lights up slot C, so the brain flips C. Match.

Why it feels like real life:
- It remembers **everything it sees**, including the human's flips, not just matches.
- Seeing a card twice makes the memory **stronger**.
- It's **fuzzy**: noise makes it sometimes pick the wrong slot, like a person.

---

## 2. Proof that it works (simulator test)

**Setup:** 8 cards (4 pairs), random board, the brain sees every card once in random order. Then, for each of the 8 cards, we ask "where is the matching card?" 6 boards per setting = 48 questions. **Random guessing scores 14% (1 in 7).**

"Zaps" = how many times we zap the face electrode and add up the spikes before deciding.

| Brain noise (`background_drive_std_mV`) | Untrained brain (1 / 3 / 10 zaps) | **Trained brain (1 / 3 / 10 zaps)** | Strength of card links | Strength of junk links |
|---|---|---|---|---|
| 0.35 (calm) | 15% / 0% / 8% | **79% / 94% / 100%** | ~21 mV | 0.02 mV |
| 0.45 (medium) | 10% / 10% / 23% | **42% / 56% / 52%** | ~21 mV | 0.19 mV |
| 0.52 (noisy) | 10% / 2% / 17% | 25% / 10% / 8% | ~22 mV | 1.5 mV |
| 0.60 (repo default) | 23% / 8% / 12% | 17% / 12% / 10% | ~20 mV | 3.2 mV |

(The 0.60 row used a link cap of 20 mV; the others used 25 mV. With 48 questions per cell, expect roughly ±7–14% wobble.)

**What this shows:**
- **The memory is real.** The untrained brain scores around chance; the trained brain finds the pair.
- **Noise is the difficulty dial.** A noisy brain fires randomly *while it's learning*, so random "junk" links get saved alongside the real ones and drown the memory. Calm brain = memory champion; medium brain = forgetful human.
- **More zaps help** when the brain is calm (averaging out noise), but don't rescue a noisy brain.

---

## 3. Settings that worked

### Simulator (LIF data source)

```python
if cl.is_simulator():
    cl.sim.set_simulator_data_source(
        "organoid_simulator.lif_data_source:make_lif_source",
        config={
            "random_seed": 42,
            "plasticity": True,                 # learning on
            "stdp": True,                       # timing-based rule: A fires before B -> A->B strengthens
            "plasticity_lr": 25.0,              # strong enough to learn from a single look
            "weight_max_mV": 25.0,              # neurons need ~20 mV (rest -70 mV, threshold -50 mV) to fire
            "background_drive_std_mV": 0.45,    # difficulty: 0.35 = expert, 0.45 = human-like
        },
    )
```

Leave `coupling_gain_mV` at its default (0). With learning on, all links start at 0, so activity does **not** bleed between neighbouring electrodes until the brain learns something.

### Electrode map (8-card board)

| Role | Channels |
|---|---|
| Faces 1–4 | 9, 14, 49, 54 |
| Slots A–H | 18, 21, 27, 30, 34, 37, 42, 45 |
| **Never use for cards** (they never spike) | 0, 4, 7, 56, 63 |

### Stimulation and timing

| Step | Value used in the test |
|---|---|
| Pulse | `cl.StimDesign(200, -1.5, 200, 1.5)`: biphasic, 200 µs per phase, 1.5 µA |
| Seeing | clear memory trace → zap face → zap slot **5 ms later** → wait **8 ms** → reward → rest **100 ms** |
| Recall | zap face → count slot spikes **0–25 ms** after → rest 75 ms (100 ms per zap); repeat 3× |
| Decision | sum spikes per slot over the zaps; drop the card in hand and matched cards; pick the max; break ties randomly |

---

## 4. Things we learned the hard way

1. **Count spikes from 0 ms.** In this simulator a learned link fires the next neuron almost instantly (<1 ms, no synaptic delays). Our first test started counting at 2 ms and missed the recall entirely. Real neurons respond a few ms later, so a CL1 version needs a different window and must ignore the echo of its own zaps (see paper 3).
2. **Noise ruins learning, not just recall.** Random firing during the learning window gets saved as junk links. Keep the learning window short (8 ms) and clear the memory trace right before each "seeing".
3. **Stay at 64 neurons.** The simulator lets you add neurons (`n_units`), but any value other than 64 **disables learning**, and it gets slow:

   | Neurons | Speed (no learning) |
   |---|---|
   | 64 | 1.7× faster than real time |
   | 1,000 | 1.7× slower than real time |
   | 10,000 | 13× slower |
   | 50,000 | 73× slower |

   You also still only have 64 electrodes to zap and read, so extra neurons don't make the game richer.
4. **The brain must relearn every game.** Learned links live inside the running simulator process; each new run starts from zero. (Real neurons also forget: in Robbins et al. 2026, learning was gone after a 45-minute rest.)
5. **The SDK's default simulator can't do this.** It emits random spikes and ignores stimulation. This repo's LIF source is what makes the brain react and learn.

---

## 5. What still needs building

### 5a. The reward hack (required)

The simulator's learning only saves links when `apply_reward()` is called, but our game script **can't call it**: the data source runs in a separate simulator process. Fix: repurpose two dead channels as signals, in the simulator only.

- Zap on **channel 0** = reward (+1): "save what just fired together".
- Zap on **channel 7** = clear (0): "forget recent co-activity".

Untested sketch for `lif_data_source.py`:

```python
REWARD_CH, CLEAR_CH = 0, 7   # dead channels: never spike, safe to repurpose in the simulator

# in __init__ / open():
self._pending_rewards = []    # (timestamp, reward)

# in on_stims(), at the top of the loop over stims:
if stim.channel in (REWARD_CH, CLEAR_CH):
    self._pending_rewards.append((int(stim.timestamp), 1.0 if stim.channel == REWARD_CH else 0.0))
    continue

# at the end of read(), after the frame loop:
due = sorted(r for r in self._pending_rewards if r[0] < to_timestamp)
self._pending_rewards = [r for r in self._pending_rewards if r[0] >= to_timestamp]
for _, reward in due:
    self.apply_reward(reward)
```

Applying the reward only once the simulation has passed its timestamp makes sure the pairing spikes exist before they get saved. **Verify this before building on it.** On a real CL1 this hack doesn't apply; reward would have to be delivered biologically (e.g. predictable vs. random stimulation, as in DishBrain).

### 5b. Export links for the visuals (nice to have)

Same problem: the game can't see the brain's connections. Inside `apply_reward()`, write the face→slot weights to a small JSON file (write to a temp file, then rename, so the game never reads half a file). The game reads it each frame and draws glowing lines whose thickness = link strength.

### 5c. The game loop

Run the neuron loop at **200 ticks/s (5 ms per tick)** so the 5 ms face→slot gap is exactly one tick:

```
Seeing a card (slot s, face f):
  tick k   : zap CLEAR_CH, zap face f
  tick k+1 : zap slot s            (5 ms later)
  tick k+3 : zap REWARD_CH         (after the 8 ms window)
  then ~100 ms of quiet before the next "seeing"

Brain's turn:
  1. Flip a face-down card (random choice; game logic)  -> it gets "seen"
  2. Zap its face 3x (100 ms apart); for 25 ms after each zap,
     count spikes on each slot electrode from tick.analysis.spikes
  3. Drop the card in hand and matched cards; flip the loudest slot -> "seen"
  4. Match? keep the pair. No match? both flip back.
```

Keep loop-body work tiny: the CL API raises `TimeoutError` if a tick overruns (the simulator only prints a warning). Draw the game in a separate thread or process.

### 5d. The game itself

- 8 cards (4 pairs) to start; try 12–16 once it works (recall noise is the limit, not electrode space).
- Human and brain take turns. Every flip, by either player, is "seen" by the brain.
- **Difficulty slider** = `background_drive_std_mV` (0.35 expert → 0.45 human-like). It's set when the simulator starts, so changing it means restarting the game.
- Scoreboard: Humans vs. Neurons.

---

## 6. Visuals and demo

- **Board** of cards in a retro neon style.
- **Brain panel**: the 8×8 electrode grid with spikes as flashes. The SDK's built-in viewer (printed at start-up, e.g. `http://127.0.0.1:8000/visualiser`) shows this for free while the script runs in real time. It's off in accelerated mode (`CL_SDK_ACCELERATED_TIME=1`).
- **Memory web**: glowing lines from faces to slots that thicken as the brain learns (needs 5b).
- **Demo moments:**
  1. Untrained vs. trained brain on the same board (chance vs. finding pairs).
  2. Slide the noise up live and watch the brain start forgetting.
  3. Let someone from the audience play against it.

---

## 7. Pitch notes

- **One-liner:** "A memory game where the opponent's memory lives in neuron connections, not in code."
- **Closed loop**, like DishBrain Pong: stimulate → record → decode → feedback.
- **Honest about limits:** simulated neurons, tuned settings, one-look learning that real tissue wouldn't manage. Real neurons are noisier, slower and forget within minutes to hours.
- **Rigor:** always compare against an untrained brain and random guessing (the lesson of Loeffler et al. 2026, where a dish with no cells still scored well above chance because the decoder was reading the stimulation itself).

### Background reading
- Smirnova & Hartung (2022), *Neuronal cultures playing Pong*, Neuron: commentary on DishBrain, where ~800,000 neurons learned Pong from feedback.
- Robbins et al. (2026), *Goal-directed learning in cortical organoids*, Cell Reports: organoids learned to balance a pole with an RL "coach" (46% success vs. 4.4% random), but forgot after a 45-minute rest.
- Loeffler et al. (2026), *Handwritten digit classification with neural cultures…*, bioRxiv: digit recognition on the CL1; modular cultures did best, and poor controls can fake accuracy.

---

## 8. Setup

```bash
uv sync                                   # Python 3.13, installs cl-sdk 1.0.0 + this repo
uv run python experiments/example1.py     # sanity check: zaps channel 27, opens the viewer
```

## 9. Suggested 2-hour plan

| Time | Task |
|---|---|
| 0:00–0:20 | Reward hack (5a) + confirm a single "see then recall" works through the real `cl` loop |
| 0:20–1:00 | Game loop (5c): seeing, brain's turn, decision |
| 1:00–1:30 | Game UI: board, turns, scoreboard, difficulty slider |
| 1:30–1:45 | Memory web visuals (5b) if time allows |
| 1:45–2:00 | Run the untrained vs. trained comparison, rehearse the demo |
