# Wonders of the First — AI Strategy Roadmap
## Prepared by: Flint ⚡ (CTO, Salish Forge)
## Date: March 9, 2026

---

## Current State Assessment

**What exists (built March 1, 2026):**
- 6 microservices: card DB, deck DB, strategy engine, rule judge, game manager, AI player
- 920 cards in PostgreSQL (439 Existence + 481 Call of the Stones)
- Minimax + alpha-beta pruning at depth 1-3
- Full game mechanics for v1.1 rules
- Docker Compose orchestration
- Services currently DOWN on VPS (data intact)

**The fundamental limitation:**
Minimax at depth 3 evaluates ~2,187 positions. It cannot learn, cannot improve, and cannot
build decks. It is a search algorithm, not an AI. To build a competitive strategy agent, we
need a learning system built on top of (and eventually replacing) the minimax baseline.

---

## Phase 1: Foundation (Weeks 1-2)

### 1A: Rules Engine Update to v1.3
Before any AI work, the rule engine must be correct.

Priority fixes (see RULES_v1.3_ANALYSIS.md):
- 6-step battle sequence (replaces simultaneous resolution)
- "Can't" as absolute override
- Inactive realm scoping
- Round-start energy timing
- AWAKEN, GUARDIAN, RAGE keyword evaluation
- Archive deck size constraints (1-50 tokens)

**Deliverable:** Updated rule_judge and strategy_engine services passing all test cases.

### 1B: AI vs AI Batch Simulator
**This is the most important thing to build. Everything else depends on it.**

The game_manager service already supports AI vs AI. What's missing is a batch runner:

```python
# What we need
simulator = BatchSimulator(
    deck_a="tournament-deck-001",
    deck_b="tournament-deck-002", 
    games=1000,
    ai_difficulty="standard",
    collect_metrics=True
)
results = simulator.run()
# Returns: win_rate, avg_game_length, stone_differential, move_distribution
```

This enables:
- Deck win rate measurement (required for deck builder)
- Strategy quality benchmarking
- Training data generation for RL model
- Meta analysis (which archetypes dominate)

**Deliverable:** `scripts/batch_simulator.py` — runs N games headlessly, outputs structured JSON.
Expected throughput: 50-100 games/minute on VPS hardware.

### 1C: Deck Builder Agent (LLM + Genetic Algorithm)
Architecture:

```
Phase 1: Seed Population
  - Claude (claude-haiku-4-5) receives full card database + game rules
  - Generates 20 candidate decks per archetype (AWAKEN, GUARDIAN, RAGE Rush, Control, Midrange)
  - Each deck: 40 cards + Archive (1-50 tokens)

Phase 2: Simulation Selection
  - Run batch simulator: each candidate deck vs. 5 benchmark decks (200 games each)
  - Score by win rate against benchmark set

Phase 3: Evolution
  - Keep top 50% by win rate
  - Mutate: random card swaps within color/cost constraints
  - Crossover: combine card pools from two high-performing decks
  - Repeat for 10-20 generations

Phase 4: Convergence
  - Top 5 decks per archetype saved to deck_database
  - Strategy notes generated explaining why each deck works
```

**Why LLM + genetic rather than pure LLM:**
Pure LLM deck building produces thematically interesting but often mechanically weak decks.
The genetic loop grounds it in actual win rates. The LLM provides intelligent seeding and
mutation (not random noise), but simulation validates the actual quality.

**Compute estimate:** 20 seed decks × 5 archetypes × 200 games = 20,000 games for first gen.
At 50 games/minute: ~7 hours for full first generation. Can run overnight.

---

## Phase 2: Self-Play Reinforcement Learning (Weeks 3-8)

### The AlphaZero Approach for Card Games

AlphaZero uses two components trained together:
1. **Policy network** — given a game state, what moves are most promising?
2. **Value network** — given a game state, who is winning and by how much?

For Wonders of the First:

**State representation (feature vector per game state):**
- Realm states (active/inactive, stone ownership): 7 × 3 = 21 features
- Cards in each realm (encoded by card ID + power + counters): variable
- Player energy, actions remaining: 4 features  
- Stone counts: 2 features
- Round number: 1 feature
- Compressed card pool representation: ~100 features
Total: ~200-300 dimensional state vector

**Action space:**
- Play card to realm: N_hand × N_realms
- Attack: N_attackers × N_defenders (or pass)
- Use activated ability: N_ability_cards × N_targets
- End turn

**Training loop:**
1. Self-play: current model plays 1,000 games against itself
2. Collect (state, action, outcome) tuples
3. Train on collected data (policy loss + value loss)
4. Evaluate new model vs. previous model (if win rate > 55%, keep)
5. Repeat

**Why this beats minimax:** The value network learns to recognize positions minimax would
need depth-10 search to evaluate correctly. After sufficient training, it plays at superhuman
level with millisecond inference.

### Implementation Stack

```
Model: PyTorch (lightweight MLP or small transformer)
State encoding: Python script using wonders_ccg database
Training: Self-play loop on aihome (12 cores, good for CPU training)
Inference: ONNX export for fast production serving
Storage: Training data in wonders_ccg.games table (already exists)
```

**Training compute:** Estimate 500K self-play games for competitive strength.
At 500 games/minute (no UI, pure logic): ~17 hours of compute.
Can run distributed across multiple machines if needed.

---

## Phase 3: Human-Facing Platform (Months 2-3)

### Web UI Architecture

**Backend additions:**
- WebSocket server for real-time game state streaming
- Player authentication (IAM service already exists at port 9000)
- ELO rating system integrated into deck_statistics table
- Match replay storage (serialize game state history)
- AI explanation API: "why did the AI play this card?"

**Frontend:** React + TypeScript
- Card rendering (fix the image loading issue first)
- Real-time board state visualization
- Drag-and-drop card play
- AI move animation with explanation overlay
- Deck builder UI (wraps the LLM deck builder backend)

**Strategy Trainer Mode:**
- AI plays alongside human (not against) — suggests moves
- Explains why in plain language via LLM
- "What would you do differently?" post-game analysis
- Heat maps: which realm to focus on based on current state

---

## Phase 4: Animated Platform + Standalone App (Months 4-12)

### Tabletop Simulator Equivalent

**What this requires:**
- 3D card rendering with flip animations (Three.js or Unity WebGL)
- Drag-and-drop with physics
- Realm visualization (7 distinct visual zones)
- Battle animation sequences
- Multiplayer via WebSocket (already in plan)
- Observer mode for spectators

**Standalone App:**
- Electron wrapper around the web frontend
- Local mode: all services run locally in Docker
- Online mode: connect to VPS
- Auto-update mechanism
- Platform: macOS + Windows (Linux optional)

**Timeline note:** This is a 6-12 month project after the core game engine and AI are stable.
Don't start frontend polish until the AI is strong enough to be interesting to play against.

---

## Image Loading Issue (Quick Fix)

From the database schema, cards have three image fields:
- `image_url` — external URL (likely the loading problem)
- `img_link` — alternate link field
- `image_path` — local path

The loading failure is probably external URLs being dead/slow. Fix:
1. Audit what URLs are present vs. working
2. Mirror all card images to VPS storage
3. Serve via nginx from /cards/images/ with card_number as filename
4. Update image_url to point to local server

**Estimate: 1 day to audit and mirror. Not a blocker for AI work.**

---

## Prioritized Work Queue

**This week:**
1. Start services on VPS and verify card API returns 920 cards
2. Fix image serving (parallel task, quick win)
3. Update rule engine to v1.3 (required before any new development)
4. Build batch simulator

**Next 2 weeks:**
5. LLM deck builder agent (first generation decks)
6. Genetic optimization loop
7. Tournament meta analysis from simulation data

**Month 2:**
8. Self-play RL training setup
9. First trained model vs. minimax benchmark
10. Web UI foundations

**Month 3+:**
11. Human-facing gameplay
12. Strategy trainer
13. Animated platform planning

---

## Key Dependencies and Risks

**Risk 1: AWAKEN trigger condition unclear**
We inferred how AWAKEN works from card text but don't have the official trigger definition.
Mitigation: Build AWAKEN evaluation using inferred mechanics, flag for review when full
v1.3 rulebook is available.

**Risk 2: RL training quality depends on rule engine correctness**
If the rule engine has bugs, the model learns from corrupted data.
Mitigation: Extensive rule engine testing BEFORE starting self-play training.

**Risk 3: 920-card LLM context for deck builder**
900 cards × ~50 tokens each = ~45K tokens. Fits in Claude Sonnet context window.
Mitigation: Use structured JSON representation (compact), not natural language card descriptions.

**Risk 4: VPS compute for RL training**
Current VPS: unknown CPU specs, 4.4 GB RAM (TOOLS.md says aihome has 12 cores, 4.4 GB).
Heavy RL training may need aihome's CPU or GPU if available.
Mitigation: Benchmark batch simulator performance first. Scale training based on actual throughput.
