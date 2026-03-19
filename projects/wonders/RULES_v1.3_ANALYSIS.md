# Wonders of the First — Rules v1.3 Analysis
## Prepared by: Flint ⚡ (CTO, Salish Forge)
## Date: March 9, 2026
## Sources: Rules Comparison PDF (v1.1→v1.3) + Card Database Analysis

---

## Critical Rule Changes for Strategy Engine (Priority Order)

### 🔴 1. Battle Sequence — 6-Step (was simultaneous)
Old: Both attack/defense triggers resolved simultaneously.
New v1.3 (6 steps):
1. ON ATTACK triggers resolve
2. ON DEFENSE triggers resolve  
3. ON BATTLE triggers resolve
4. Victory check (power comparison)
5. Stone movement
6. End of Battle effects (Deathstrike resolves HERE)

**Engine impact:** The MoveGenerator and GameTreeEvaluator must be rewritten to use sequential
step evaluation. Attacker has first-mover advantage (step 1 before step 2). ON ATTACK debuffs
apply before defender's ON DEFENSE triggers — this changes combat math significantly.

### 🔴 2. Round Start Sequence (v1.3 change)
Old (v1.2): ON ROUND START triggers fired BEFORE energy/actions added.
New (v1.3): Energy and actions added FIRST, then ON ROUND START triggers fire.

**Engine impact:** Cards with ON ROUND START that reference current energy now see the
newly-added energy. Cards that spend energy "On Round Start" can use that round's energy.
The PositionEvaluator's energy calculations at round start must be updated.

### 🔴 3. "Can't" Is Absolute
New: "Can't" effects override all other effects, no exceptions.
Conflict between two non-"can't" static abilities: most recently applied wins (timestamp system).

**Engine impact:** Cards with "can't" text are now tier 1 lockouts. MoveGenerator must hard-stop
any action the game state says "can't" happen, regardless of other modifiers.

### 🔴 4. Inactive Realms NOT Part of "The World"
Cards in inactive realms are excluded from all effects that reference "The World" or "all cards."

**Engine impact:** The realm_state evaluation in GameTreeEvaluator must flag each realm as
active/inactive and scope global effects accordingly. Cards sheltered in inactive realms are
immune to board wipes and global debuffs.

---

## New Keywords — Inferred from Card Database

### AWAKEN (24 cards, primarily Call of the Stones)

From card text analysis:
- AWAKEN is a triggered condition: when a Wonder is "awakened," it gains a power bonus and
  optionally gains a new activated ability.
- The AWAKEN bonus is printed as "AWAKEN: +X" where X is the power boost.
- Additional abilities granted on awaken are shown in quotes: "AWAKEN: +2 and 'TAP FREE: ...'"
- Cards can grant AWAKEN to other cards: "Petraian Wonders you control get 'AWAKEN: +3'"
- Awaken can trigger conditionally: "AWAKEN: +2 for each Wonder here"
- An "awakened" state appears to be persistent (cards remain awakened after triggering)

**Examples from database:**
- Awakened Snaptooth: "AWAKEN: +2 and SACRIFICE FREE: Enemy Wonders get -1 this round"
- Baby Stonehorn: "AWAKEN: +2 for each Wonder here"
- Primordius Sanguis: "AWAKEN: +4. Whenever this awakens, target enemy here gets -4 this round"
- Cedarshade Grungle: "AWAKEN: +4. TAP FREE: If this is awakened, remove nullify/null counters"

**Strategy value:** AWAKEN cards have a dormant and awakened state. Awakening them at the
right moment is a tempo play. Cards that grant AWAKEN to others (Kezca) enable power spikes.
The power boost is significant (typically +2 to +4). Target high for combo potential.

### GUARDIAN (18 cards)

From card text analysis:
- GUARDIAN is a defensive ability that provides a power bonus to the defending Wonder AND
  optionally applies a disruption effect.
- Pattern: "GUARDIAN: +X and [disruption effect]"
- Disruption examples: increase opponent's card costs, debuff attacking cards
- Spells can grant GUARDIAN to multiple Wonders at once

**Examples from database:**
- Yarhar the Mouthy (6/6): "GUARDIAN: +2 and name a card. That card costs 3 more to play this round"
- Unbreakable Courage (Spell): "This round, Wonders you control with cost 2 or less get GUARDIAN: +2"

**Strategy value:** GUARDIAN is a defensive keyword that rewards holding Wonders back to
defend. The disruption component (cost increase, debuffs) makes GUARDIAN creatures dual-role:
they defend AND disrupt opponent's plans. GUARDIAN on low-cost Wonders (enabled by spells)
creates efficient defensive walls.

### RAGE (6 cards)

From card text analysis:
- RAGE is an aggressive combat keyword. "Rage attacks" are distinct from normal attacks.
- Cards with Rage can make "rage attacks" that trigger additional effects
- Supporting text: "Whenever you make a rage attack, defending Wonders get -2 this round"
- RAGE appears to stack with ON ATTACK triggers
- Some Rage cards also have Unstable (Rage + Unstable = high risk/reward)

**Examples from database:**
- Bartokk the Charger (3/0, Story Token): "Rage" (base keyword)
- Stolo Rockthorn (0/2): "Rage. ON ATTACK: Put two +1 counters on this"
- Ignatius Doombeard (4/4): "Rage. Whenever you make a rage attack, defending Wonders get -2.
  ON ATTACK: Put a +1 counter on each attacking Wonder"
- King Soulrend the Cursed (9/5): "ETERNAL. Rage. Unstable" (high-risk legend)

**Strategy value:** RAGE is an aggression enabler. Best in rush/aggressive decks where you're
consistently attacking. The "rage attack" distinction suggests RAGE enables a special attack
mode — not just a passive buff. Rage + ON ATTACK cards create strong attack packages.

---

## Additional Rule Changes (from NotebookLM analysis)

### Rule 101.5 — "Play for Free" Clarification (v1.3)
Playing a card "for free" now explicitly means: **no cost is paid AND all energy cost modifiers are ignored.**
- Previously: ambiguous whether cost-increase effects (e.g., GUARDIAN's "+3 cost this round") could still apply to free plays
- Now: free play bypasses ALL cost modifications — increases, decreases, and conditionals
- **Engine impact:** MoveGenerator must check "free play" flag first and skip all cost modifier calculations entirely when set. GUARDIAN's cost disruption cannot stop a free play.

### Rule 7 — Kingdom Keyword Change (v1.3 SIGNIFICANT NERF)
- **v1.1/v1.2:** Kingdom activates when you control 3+ lands of **any** orbital (total land count)
- **v1.3:** Kingdom activates when you control lands with **matching orbitals** to the card's orbital
- This is a targeted nerf — Kingdom is now harder to enable unless you build around specific orbital synergies
- **Engine impact:** PositionEvaluator must check orbital matching, not just land count. Deck builder must flag Kingdom cards and ensure orbital-matched lands are included.
- **Deck building impact:** Kingdom decks must commit to specific orbitals. Cross-orbital Kingdom builds no longer work. Tighter constraints, higher ceiling when built correctly.

---

## Other Notable v1.3 Changes

### Archive (formerly Token Deck)
- Renamed from "token deck" to "Archive"
- New constraint: minimum 1, maximum 50 tokens
- Free tokens (0-cost) are now explicitly valid

### Deathstrike (Updated)
- Now resolves at step 6 of battle sequence (End of Battle)
- No longer requires a declared target — hits whatever it battled
- Still does NOT prevent losing the battle (step 4 determines winner before step 6)

### Symbiosis (Clarified)
- Chaining multiple Symbiosis effects is officially supported
- Power modification interactions with Symbiosis are clarified in full v1.3 rules
- Synergy-heavy boards with Symbiosis compounds effects

### Lands
- Abilities work regardless of realm (realm-agnostic)
- Lands can be played in The World
- Simplifies land evaluation — pure ability value

---

## Engine Update Requirements

### High Priority (blocks correct gameplay)
1. `game_tree.py` — implement 6-step battle sequence
2. `move_generator.py` — check "can't" effects as hard stops
3. `move_generator.py` — scope global effects to active realms only
4. `evaluator.py` — update round-start energy calculation order (energy first, then triggers)

### Medium Priority (affects strategy quality)
5. `evaluator.py` — add AWAKEN state tracking (dormant vs. awakened)
6. `evaluator.py` — add GUARDIAN defensive value scoring
7. `evaluator.py` — add RAGE aggression scoring
8. `evaluator.py` — add "can't" card tier premium in position evaluation
9. `evaluator.py` — add Symbiosis chain value multiplier
10. Archive deck construction — add 1-50 token constraint validation

### Low Priority (correctness but minor impact)
11. Token cost default = 0 for cost-referencing effects
12. Land ability evaluation — remove realm constraints

---

## New Deck Archetypes Enabled by Call of the Stones

**AWAKEN Combo:** Stack AWAKEN cards + power-pump spells. Kezca grants AWAKEN to all
Petraian Wonders — pairing with Petraian faction cards creates a power spike board.

**GUARDIAN Wall:** Low-cost Wonders + "Unbreakable Courage" spell to give mass GUARDIAN.
Creates a defensive board that disrupts opponent's tempo through cost increases.

**RAGE Rush:** Aggressive Wonders with Rage + ON ATTACK triggers. Ignatius Doombeard as
finisher, small Rage tokens as fodder. Win on stone count by constantly attacking.

**ETERNAL Midrange:** ETERNAL cards can return to realms, creating persistent board presence.
King Soulrend (ETERNAL + Rage) is a 9-power threat that keeps coming back.

---

## Unknown (Requires Full v1.3 Rulebook)
- Exact trigger condition for AWAKEN (what causes a Wonder to "awaken"?)
- Whether AWAKEN is a one-time trigger or can repeat
- Full RAGE attack mechanics (how does a "rage attack" differ mechanically from a normal attack?)
- GUARDIAN trigger condition (always active when defending, or requires declaration?)
- ETERNAL keyword full rules (referenced on King Soulrend)
- CALL keyword (14 cards, appears in Existence set — confirm v1.3 changes if any)
