# Skill Hints Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an exclamation mark (!) hint toggle on support cards in the training tracker, auto-populating a skill hint picker when toggled on.

**Architecture:** Load `support_card_hints` joined with `skills` at page init into a card-to-skills map. Add a per-card hint toggle (like the existing unity 🔥 toggle). When toggled, render a hint picker section in the training form showing that card's hintable skills with a level range selector. On submit, auto-insert a companion `hint` timeline event after the training event.

**Tech Stack:** React (existing RunComparison.tsx), Supabase PostgREST queries, existing `SearchableSelect` component.

---

### Task 1: Load support card hint data

**Files:**
- Modify: `src/pages/RunComparison.tsx:286-293` (state declarations)
- Modify: `src/pages/RunComparison.tsx:363-378` (data fetching useEffect)

- [ ] **Step 1: Add state for card hint map**

After line 289 (`const [skills, setSkills] = ...`), add:

```tsx
const [cardHintSkills, setCardHintSkills] = useState<Record<number, { skill_id: number; name: string; icon_url?: string }[]>>({});
```

- [ ] **Step 2: Fetch support_card_hints joined with skills**

Inside the `useEffect` at line 363 (where trainees/cards/skills are fetched), after the `fetchSkills()` call at line 375, add:

```tsx
supabase
  .from('support_card_hints')
  .select('card_id, skill_id, skills(gametora_id, name, icon_url)')
  .order('sort_order')
  .then(({ data }) => {
    if (!data) return;
    const map: Record<number, { skill_id: number; name: string; icon_url?: string }[]> = {};
    for (const row of data) {
      const skill = row.skills as unknown as { gametora_id: number; name: string; icon_url?: string } | null;
      if (!skill) continue;
      if (!map[row.card_id]) map[row.card_id] = [];
      map[row.card_id].push({ skill_id: Number(skill.gametora_id), name: skill.name, icon_url: skill.icon_url ?? undefined });
    }
    setCardHintSkills(map);
  });
```

- [ ] **Step 3: Verify data loads**

Open the app, open browser devtools, and confirm the `support_card_hints` query returns data. Add a temporary `console.log('cardHintSkills', cardHintSkills)` after the state setter to verify the map is populated. Remove the log after confirming.

- [ ] **Step 4: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "feat(tracker): load support card hint skills data"
```

---

### Task 2: Add hint toggle state and button

**Files:**
- Modify: `src/pages/RunComparison.tsx:317-318` (state, next to simUnityBonuses)
- Modify: `src/pages/RunComparison.tsx:1338-1364` (card chip in facility view)

- [ ] **Step 1: Add simHintCards state**

After the `simUnityBonuses` state declaration (line 318), add:

```tsx
const [simHintCards, setSimHintCards] = useState<boolean[]>(Array(6).fill(false));
```

- [ ] **Step 2: Add the hint toggle button on each card chip**

In the facility card chip rendering (around line 1338), the existing code renders a 🔥 button inside `{isFacility && ( ... )}`. After the closing `)}` of the unity button block (line 1364) and before the closing `</div>` of the card chip (line 1365), add a new hint button that is always visible (not gated by `isFacility`), but only when the card has hintable skills:

```tsx
{(() => {
  const cardId = deck[i]?.id;
  const hasHints = cardId && cardHintSkills[cardId]?.length > 0;
  if (!hasHints) return null;
  return (
    <button
      onMouseDown={e => e.stopPropagation()}
      onClick={e => {
        e.stopPropagation();
        const nh = [...simHintCards];
        nh[i] = !nh[i];
        setSimHintCards(nh);
      }}
      title={simHintCards[i] ? 'Hint active — click to remove' : 'Mark hint (!) — click to add'}
      style={{
        background: simHintCards[i] ? 'rgba(239, 68, 68, 0.2)' : 'none',
        border: simHintCards[i] ? '1px solid rgba(239, 68, 68, 0.4)' : 'none',
        borderRadius: '4px',
        padding: '1px 2px',
        cursor: 'pointer',
        fontSize: '0.65rem',
        lineHeight: 1,
        opacity: simHintCards[i] ? 1 : 0.3,
        filter: simHintCards[i] ? 'drop-shadow(0 0 2px rgba(239, 68, 68, 0.8))' : 'grayscale(100%)',
        flexShrink: 0,
        color: simHintCards[i] ? '#ef4444' : '#888',
        fontWeight: 700,
      }}
    >
      !
    </button>
  );
})()}
```

- [ ] **Step 3: Verify the toggle renders**

Open the tracker with a deck that has support cards with hints. Confirm the `!` button appears next to cards that have hint skills, and toggles visually on click. Cards without hints should not show the button.

- [ ] **Step 4: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "feat(tracker): add hint toggle button on support card chips"
```

---

### Task 3: Compute hint level range per card

**Files:**
- Modify: `src/pages/RunComparison.tsx` (add a useMemo after `skillOptions`, around line 593)

- [ ] **Step 1: Add a memo that computes max hint levels per deck card**

After the `skillOptions` memo (line 593), add:

```tsx
// For each deck slot, compute the hint level bonus from the card's HintLevels effect (effect_type_id 17).
// Base hint = +1, bonus adds to max. Range shown to user: [1, 1 + bonus].
const cardHintLevelBonus = useMemo(() => {
  return deck.map(slot => {
    const card = cards.find(c => c.id === slot.id);
    if (!card) return 0;
    const hintEffect = card.effects.find(e => e.effect_type_id === 17);
    if (!hintEffect) return 0;
    // Find the value at the card's current level
    const levelIdx = Math.min(slot.level - 1, (hintEffect.values_by_level?.length ?? 1) - 1);
    return hintEffect.values_by_level?.[levelIdx] ?? 0;
  });
}, [deck, cards]);
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "feat(tracker): compute hint level bonus range per deck card"
```

---

### Task 4: Add hint picker section in training entry form

**Files:**
- Modify: `src/pages/RunComparison.tsx:272-275` (DEFAULT_FORMS.training — add `hint_skills` field)
- Modify: `src/pages/RunComparison.tsx:1583-1593` (after energy/SP inputs in training form, before the closing `</>`)

- [ ] **Step 1: Add hint_skills to training default form**

Update the `training` entry in `DEFAULT_FORMS` (line 273) to include hint data:

```tsx
training: { facility: 0, card_placements: Array(6).fill(-1), friendship_deltas: Array(6).fill(0), stat_gains: { ...STAT_PLACEHOLDERS }, energy_change: -20, sp_gain: 2, hint_skills: [] as { skill_id: number; levels: number }[] },
```

- [ ] **Step 2: Render the hint picker section**

After the energy/SP grid (line 1592, the `</div>` closing the grid with energy_change and sp_gain), and before the closing `</>` of the training form section (line 1593), add:

```tsx
{/* Skill Hints from toggled cards */}
{simHintCards.some(Boolean) && (
  <div>
    <label style={miniLabelStyle}>Skill Hints</label>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {deck.map((slot, i) => {
        if (!simHintCards[i] || !slot.id) return null;
        const hintSkills = cardHintSkills[slot.id];
        if (!hintSkills?.length) return null;
        const card = cards.find(c => c.id === slot.id);
        const bonus = cardHintLevelBonus[i];
        const maxLevel = 1 + bonus;
        // Find if this card already has a selected hint in the form
        const selectedHint = (entryForm.hint_skills || []).find(
          (h: { card_index: number }) => h.card_index === i
        );
        return (
          <div key={i} style={{ background: '#111', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: '0.65rem', color: '#ef4444', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <img src={getCardIconUrl(slot.id)} alt="" style={{ width: 16, height: 16, borderRadius: 3 }} />
              <span style={{ fontWeight: 600 }}>{card?.name ?? `Card ${slot.id}`}</span>
              <span style={{ color: 'var(--text-muted)' }}>hint</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: maxLevel > 1 ? '1fr 70px' : '1fr', gap: '6px', alignItems: 'end' }}>
              <SearchableSelect
                options={hintSkills.map(s => ({ id: s.skill_id, label: s.name, image: s.icon_url || undefined }))}
                value={selectedHint?.skill_id ?? null}
                onChange={val => {
                  const skillId = typeof val === 'string' ? parseInt(val) : val;
                  const existing = [...(entryForm.hint_skills || [])];
                  const idx = existing.findIndex((h: { card_index: number }) => h.card_index === i);
                  if (idx >= 0) {
                    existing[idx] = { ...existing[idx], skill_id: skillId };
                  } else {
                    existing.push({ card_index: i, skill_id: skillId, levels: 1 });
                  }
                  setFormField('hint_skills', existing);
                }}
                placeholder="Select skill"
              />
              {maxLevel > 1 && (
                <select
                  value={selectedHint?.levels ?? 1}
                  onChange={e => {
                    const existing = [...(entryForm.hint_skills || [])];
                    const idx = existing.findIndex((h: { card_index: number }) => h.card_index === i);
                    if (idx >= 0) {
                      existing[idx] = { ...existing[idx], levels: parseInt(e.target.value) };
                    } else {
                      existing.push({ card_index: i, skill_id: null, levels: parseInt(e.target.value) });
                    }
                    setFormField('hint_skills', existing);
                  }}
                  style={inputStyle}
                >
                  {Array.from({ length: maxLevel }, (_, l) => l + 1).map(l => (
                    <option key={l} value={l}>Lv+{l}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify the hint picker appears**

Toggle a card's `!` button, open the training form — the hint picker should appear with that card's skills listed. If the card has a HintLevels effect, a level dropdown showing 1 to 1+bonus should appear. If no HintLevels effect, it should default to Lv+1 with no dropdown.

- [ ] **Step 4: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "feat(tracker): add skill hint picker in training entry form"
```

---

### Task 5: Auto-insert companion hint event on training submit

**Files:**
- Modify: `src/pages/RunComparison.tsx:854-878` (handleAddEntry function)

- [ ] **Step 1: Insert hint event after training event**

In `handleAddEntry` (line 831), after the successful training event insert (inside the `else` block at line 864), before `await loadTimelineEvents()` (line 865), add logic to create a companion hint event if any hints were selected:

Replace the block from line 864 to 877:

```tsx
    } else {
        // Auto-insert companion hint event if any skill hints were selected
        const selectedHints = (entryForm.hint_skills || []).filter(
          (h: { skill_id: number | null; levels: number }) => h.skill_id != null
        );
        if (entryType === 'training' && selectedHints.length > 0) {
            await supabase.from('training_run_events').insert({
                run_id: currentRunId,
                sequence: timelineEvents.length + 1,
                type: 'hint',
                payload: {
                    skills: selectedHints.map((h: { skill_id: number; levels: number }) => ({
                        skill_id: h.skill_id,
                        levels: h.levels,
                    })),
                },
            });
        }

        await loadTimelineEvents();
        setAddingEntry(false);
        // Reset hint toggles
        setSimHintCards(Array(6).fill(false));
        if (entryType === 'training') {
            const placements = deck.map(slot => {
                const card = cards.find(c => c.id === slot.id);
                return card ? (CARD_TYPE_TO_FACILITY[card.card_type] ?? -1) : -1;
            });
            setEntryForm({ ...DEFAULT_FORMS.training, card_placements: placements });
        } else {
            setEntryForm(DEFAULT_FORMS[entryType]);
        }
        setTurnResult(null);
    }
```

- [ ] **Step 2: Verify end-to-end flow**

1. Start a training run with a deck containing cards that have hints.
2. In the simulation view, toggle `!` on a card.
3. Select a facility, pick a skill in the hint picker.
4. Submit the training entry.
5. Confirm the timeline shows both a "Training" event AND a "Hint" event right after it.
6. Confirm the RunState hints accumulate correctly (visible in the state panel).

- [ ] **Step 3: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "feat(tracker): auto-insert hint event when training with hint toggle"
```

---

### Task 6: Reset hint toggles on simulate-turn and facility changes

**Files:**
- Modify: `src/pages/RunComparison.tsx:1237-1240` (where simulate-turn results auto-populate the form)

- [ ] **Step 1: Clear hint_skills from form when simulation populates stats**

At line 1239, where `setEntryForm` is called after simulation results, ensure `hint_skills` is reset:

The existing line:
```tsx
setEntryForm({ ...DEFAULT_FORMS.training, facility: selectedFacility, stat_gains: gains, energy_change: Math.round(cost), sp_gain: 2, card_placements: simPlacements, friendship_deltas: friendshipDeltasForFacility(selectedFacility, simPlacements) });
```

Replace with:
```tsx
setEntryForm({ ...DEFAULT_FORMS.training, facility: selectedFacility, stat_gains: gains, energy_change: Math.round(cost), sp_gain: 2, card_placements: simPlacements, friendship_deltas: friendshipDeltasForFacility(selectedFacility, simPlacements), hint_skills: [] });
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/RunComparison.tsx
git commit -m "fix(tracker): reset hint_skills when simulation repopulates training form"
```
