# Neuron Match 🧠

Play Memory (Concentration) against a **brain**. The brain watches every card that gets flipped, by you or by itself, and stores *where it saw each face* in the connection weights between its neurons. On its turn it zaps the face it is holding and flips whichever slot electrode fires loudest. The game code never stores the board: the only memory is in the synapses.

**Live demo:** deployed on Vercel (static site, no build step).

## How it works

- `brain.js`: a 64-neuron leaky integrate-and-fire network (one neuron per electrode of a CL1-style 8×8 multi-electrode array) with STDP eligibility traces and reward-gated learning, ported from the Cortical Labs simulator model described in [`MEMORY_GAME.md`](MEMORY_GAME.md).
- **Seeing** a card: clear → zap the face electrode → zap the slot electrode 5 ms later → reward. Face fires before slot, so the face → slot link grows (~21 mV after one look).
- **Recalling**: zap the face electrode 3×, count spikes on each slot electrode 0–25 ms later, ignore the card in hand and matched cards, flip the loudest.
- **Difficulty = neural noise.** Background noise makes the brain fire randomly while learning, so junk links get saved and drown the real memory.

| Noise (mV) | Recall accuracy, 12-card board (chance = 9%) |
|---|---|
| 0.35 Genius | ~82% |
| 0.45 Human | ~49% |
| 0.52 Sleepy | ~8% |

The UI shows the brain live: spikes on the 8×8 electrode grid, the recall vote per slot, and the learned face → slot weight matrix.

> Simulation only: this runs a simulated LIF brain in your browser, not real neurons. The same protocol is designed for the Cortical Labs `cl` SDK / CL1 (see `MEMORY_GAME.md`).

## Run locally

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```
