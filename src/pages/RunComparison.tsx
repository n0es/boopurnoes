import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import SearchableSelect from '../components/SearchableSelect';

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`;

interface StatBlock {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
}

interface Trainee {
  id: number;
  name: string;
  title: string | null;
  icon_path: string | null;
  stats_base: number[] | null;
  stats_three_star: number[] | null;
  stats_four_star: number[] | null;
  stats_five_star: number[] | null;
  apt_turf: string | null;
  apt_dirt: string | null;
  apt_short: string | null;
  apt_mile: string | null;
  apt_mid: string | null;
  apt_long: string | null;
  apt_leading: string | null;
  apt_stalking: string | null;
  apt_mid_pack: string | null;
  apt_chasing: string | null;
}

interface SupportCardEffect {
  effect_type_id: number;
  unlock_level: number;
  values_by_level: number[];
}

interface CardBasic {
  id: number;
  name: string;
  rarity: string;
  card_type: string;
  effects: SupportCardEffect[];
}

interface Factor {
  type: 'BlueStat' | 'UniqueSkill' | 'SkillHint' | 'RaceBonus' | 'Aptitude' | 'Scenario';
  stat_index?: number;
  skill_id?: number;
  race_name?: string;
  apt_name?: string;
  name?: string;
  stars: number;
}

interface LegacyMember {
  name: string;
  factors: Factor[];
}



interface SavedRun {
  id: string;
  trainee_id: number;
  star_rank: number;
  awakening_level: number;
  deck: { card_id: number; level: number }[];
  legacy_config: Record<string, { parent: LegacyMember; grandparent_1: LegacyMember; grandparent_2: LegacyMember }>;
  inherited_stats: StatBlock;
  initial_sp: number;
  created_at: string;
  last_turn: number;
  current_stats: StatBlock;
  current_energy: number;
  current_mood: number;
  current_friendship: number[];
  current_sp: number;
}

type EntryType = 'training' | 'event' | 'hint' | 'aptitude' | 'inspiration' | 'race' | 'rest' | 'infirmary' | 'recreation';

interface TimelineEvent {
  id: string;
  run_id: string;
  sequence: number;
  type: EntryType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  scenario_event_id?: string | null;
  created_at: string;
}

interface ScenarioEvent {
  id: string;
  trainee_id: number | null;
  name: string;
  description: string | null;
  sp_change: number;
  stat_changes: Partial<StatBlock>;
  energy_change: number;
  mood_change: number;
  hints: { skill_id: number; levels: number }[];
  aptitudes: { name: string; grade: string }[];
}

interface RunState {
  stats: StatBlock;
  energy: number;
  mood: number;
  sp: number;
  friendship: number[];
  hints: { skill_id: number; level: number }[];
  aptitudes: Record<string, string>; // key = apt name, value = grade (S/A/B/C/D/E/F/G)
}

interface TurnResult {
    state: RunState;
    expected_gains: StatBlock[];
    expected_energy_costs: number[];
    failure_rates: number[];
    base_gains?: StatBlock[];
    special_gains?: StatBlock[];
    base_sp_gains?: number[];
    special_sp_gains?: number[];
    facility_scores?: number[];
}

const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'];
const FACTOR_TYPES = ['BlueStat', 'UniqueSkill', 'SkillHint', 'RaceBonus', 'Aptitude', 'Scenario'];

const APT_KEYS: { key: string; label: string; group: string }[] = [
  { key: 'turf',      label: 'Turf',         group: 'Track' },
  { key: 'dirt',      label: 'Dirt',         group: 'Track' },
  { key: 'short',     label: 'Sprint',       group: 'Distance' },
  { key: 'mile',      label: 'Mile',         group: 'Distance' },
  { key: 'mid',       label: 'Medium',       group: 'Distance' },
  { key: 'long',      label: 'Long',         group: 'Distance' },
  { key: 'leading',   label: 'Front Runner', group: 'Style' },
  { key: 'stalking',  label: 'Pace Chaser',  group: 'Style' },
  { key: 'mid_pack',  label: 'Late Surger',  group: 'Style' },
  { key: 'chasing',   label: 'End Closer',   group: 'Style' },
];
const GRADES = ['S', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];

const CARD_TYPE_TO_FACILITY: Record<string, number> = {
  speed: 0, stamina: 1, power: 2, guts: 3, intelligence: 4,
};
const INITIAL_STAT_EFFECTS: Record<string, number> = {
  speed: 9, stamina: 10, power: 11, guts: 12, wisdom: 13,
};
const GRADE_COLORS: Record<string, string> = {
  S: '#fbbf24', A: '#f87171', B: '#fb923c', C: '#a3e635',
  D: '#60a5fa', E: '#9ca3af', F: '#6b7280', G: '#4b5563',
};

const FACILITY_LEVEL_COLORS = [
  '#4ade80', // Lv1: Green
  '#60a5fa', // Lv2: Blue
  '#fb923c', // Lv3: Orange
  '#f472b6', // Lv4: Pink
  '#a78bfa', // Lv5: Purple
];

function getTraineeIconUrl(trainee: Trainee) {
  const path = trainee.icon_path ?? `trainees/icons/${trainee.id}.png`;
  return `${SUPABASE_STORAGE}/${path}`;
}

function getCardIconUrl(id: number) {
    return `${SUPABASE_STORAGE}/supports/icons/${id}.png`;
}

function getTypeIconUrl(t: string) {
    return `${SUPABASE_STORAGE}/icons/${t}.png`;
}

function addStats(a: StatBlock, b: Partial<StatBlock>): StatBlock {
  return {
    speed: a.speed + (b.speed || 0),
    stamina: a.stamina + (b.stamina || 0),
    power: a.power + (b.power || 0),
    guts: a.guts + (b.guts || 0),
    wisdom: a.wisdom + (b.wisdom || 0),
  };
}

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function applyHints(hints: RunState['hints'], incoming: { skill_id: number; levels: number }[]): RunState['hints'] {
  const out = [...hints];
  for (const { skill_id, levels } of incoming) {
    const idx = out.findIndex(h => h.skill_id === skill_id);
    if (idx >= 0) out[idx] = { ...out[idx], level: out[idx].level + levels };
    else out.push({ skill_id, level: levels });
  }
  return out;
}

function deriveRunState(
  initial: { stats: StatBlock; sp: number; deckSize: number; aptitudes: Record<string, string> },
  events: TimelineEvent[]
): RunState {
  const base: RunState = {
    stats: { ...initial.stats },
    energy: 100,
    mood: 2, // Normal = 1.0× multiplier (index 2 in MOOD_MULTIPLIERS)
    sp: initial.sp,
    friendship: Array(initial.deckSize).fill(0),
    hints: [],
    aptitudes: { ...initial.aptitudes },
  };
  return events.reduce((state, event) => {
    const p = event.payload;
    switch (event.type) {
      case 'training': {
        const newFriendship = state.friendship.map((f, i) => f + (p.friendship_deltas?.[i] || 0));
        return { ...state, stats: addStats(state.stats, p.stat_gains || {}), energy: clamp(state.energy + (p.energy_change || 0), 0, 100), sp: state.sp + (p.sp_gain || 0), friendship: newFriendship };
      }
      case 'event':
        return { ...state, sp: state.sp + (p.sp_change || 0), stats: addStats(state.stats, p.stat_changes || {}), energy: clamp(state.energy + (p.energy_change || 0), 0, 100), mood: clamp(state.mood + (p.mood_change || 0), 0, 4) };
      case 'hint':
        return { ...state, hints: applyHints(state.hints, p.skills || []) };
      case 'aptitude':
        return { ...state, aptitudes: { ...state.aptitudes, [p.name]: p.grade ?? 'G' } };
      case 'inspiration': {
        const newApts = { ...state.aptitudes };
        for (const { name, grade } of (p.aptitude_changes || [])) newApts[name] = grade;
        return {
          ...state,
          stats: addStats(state.stats, p.stat_gains || {}),
          aptitudes: newApts,
          hints: applyHints(state.hints, p.hints || []),
        };
      }
      case 'race':
        return { ...state, stats: addStats(state.stats, p.stat_gains || {}), sp: state.sp + (p.sp_gain || 0), energy: clamp(state.energy + (p.energy_change || 0), 0, 100) };
      case 'rest':
        return { ...state, energy: clamp(state.energy + (p.energy_change ?? 40), 0, 100) };
      case 'infirmary':
        return { ...state, energy: clamp(state.energy + (p.energy_change ?? 0), 0, 100) };
      case 'recreation':
        return { ...state, energy: clamp(state.energy + (p.energy_change ?? 5), 0, 100), mood: Math.min(4, state.mood + 1) };
      default:
        return state;
    }
  }, base);
}

const ENTRY_TYPE_META: Record<EntryType, { label: string; color: string; icon: string }> = {
  training:    { label: 'Training',    color: '#3b82f6', icon: '🏋️' },
  event:       { label: 'Event',       color: '#f59e0b', icon: '🎉' },
  hint:        { label: 'Hint',        color: '#22c55e', icon: '📖' },
  aptitude:    { label: 'Aptitude',    color: '#a855f7', icon: '🎯' },
  inspiration: { label: 'Inspiration', color: '#ec4899', icon: '✨' },
  race:        { label: 'Race',        color: '#f97316', icon: '🏇' },
  rest:        { label: 'Rest',        color: '#6b7280', icon: '💤' },
  infirmary:   { label: 'Infirmary',   color: '#ef4444', icon: '🏥' },
  recreation:  { label: 'Recreation',  color: '#06b6d4', icon: '🎮' },
};

const STAT_PLACEHOLDERS: StatBlock = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DEFAULT_FORMS: Record<EntryType, Record<string, any>> = {
  training:    { facility: 0, card_placements: Array(6).fill(-1), friendship_deltas: Array(6).fill(0), stat_gains: { ...STAT_PLACEHOLDERS }, energy_change: -20, sp_gain: 2, hint_skills: [] as { card_index: number; skill_id: number | null; levels: number }[] },
  event:       { label: '', sp_change: 0, stat_changes: { ...STAT_PLACEHOLDERS }, energy_change: 0, mood_change: 0, save_to_db: false },
  hint:        { skills: [{ skill_id: null as number | null, levels: 1 }] },
  aptitude:    { name: '', grade: 'A' },
  inspiration: { stat_gains: { ...STAT_PLACEHOLDERS }, aptitude_changes: [] as { name: string; grade: string }[], hints: [] as { skill_id: number | null; levels: number }[] },
  race:        { race_name: '', stat_gains: { ...STAT_PLACEHOLDERS }, sp_gain: 0, energy_change: -20 },
  rest:        { energy_change: 40 },
  infirmary:   { energy_change: 0 },
  recreation:  { energy_change: 5 },
};

export default function RunComparison() {
  const [mode, setMode] = useState<'simulation' | 'tracker'>('tracker');
  const [savedRuns, setSavedRuns] = useState<SavedRun[]>([]);
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [cards, setCards] = useState<CardBasic[]>([]);
  const [skills, setSkills] = useState<{id: number, name: string, icon_url?: string}[]>([]);
  const [cardHintSkills, setCardHintSkills] = useState<Record<number, { skill_id: number; name: string; icon_url?: string }[]>>({});
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [races, setRaces] = useState<string[]>([]);

  // User Collection State
  const [userTrainees, setUserTrainees] = useState<Record<number, { star_rank: number, awakening_level: number }>>({});
  const [userCards, setUserCards] = useState<Record<number, { level: number }>>({});

  // Input State
  const [selectedTrainee, setSelectedTrainee] = useState<number | null>(null);
  const [starRank, setStarRank] = useState(3);
  const [awakeningLevel, setAwakeningLevel] = useState(5);
  const [scenario, setScenario] = useState('unity_cup');
  const [deck, setDeck] = useState<{ id: number; level: number }[]>(Array(6).fill({ id: 0, level: 50 }));
  const [loading, setLoading] = useState(false);

  // Tracker State
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [, setScenarioEvents] = useState<ScenarioEvent[]>([]);
  const [initialTrackerStats, setInitialTrackerStats] = useState<StatBlock>({ speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });
  const [addingEntry, setAddingEntry] = useState(false);
  const [entryType, setEntryType] = useState<EntryType>('training');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [entryForm, setEntryForm] = useState<Record<string, any>>(DEFAULT_FORMS.training);
  const [turnResult, setTurnResult] = useState<TurnResult | null>(null);
  // Card placements for simulation (-1 = away, 0-4 = facility)
  const [simPlacements, setSimPlacements] = useState<number[]>(Array(6).fill(-1));
  // Per-card unity bonus toggles (Unity Cup only)
  const [simUnityBonuses, setSimUnityBonuses] = useState<boolean[]>(Array(6).fill(false));
  const [simHintCards, setSimHintCards] = useState<boolean[]>(Array(6).fill(false));
  // Currently selected training facility (0-4), null = none selected
  const [selectedFacility, setSelectedFacility] = useState<number | null>(null);
  // Which card slot is being dragged
  const [draggingCard, setDraggingCard] = useState<number | null>(null);
  const [submittingEntry, setSubmittingEntry] = useState(false);
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);

  // Legacy Tree
  const [legacies, setLegacies] = useState<Record<string, LegacyMember>>({
    l1p: { name: 'Parent 1', factors: [] },
    l1g1: { name: 'GP 1', factors: [] },
    l1g2: { name: 'GP 2', factors: [] },
    l2p: { name: 'Parent 2', factors: [] },
    l2g3: { name: 'GP 3', factors: [] },
    l2g4: { name: 'GP 4', factors: [] },
  });

  const [editingMember, setEditingMember] = useState<string | null>(null);

  const { user } = useAuth();

  // --- Persistence Logic ---
  useEffect(() => {
    const saved = localStorage.getItem('uma_run_setup');
    if (saved) {
        try {
            const data = JSON.parse(saved);
            if (data.selectedTrainee) setSelectedTrainee(data.selectedTrainee);
            if (data.starRank) setStarRank(data.starRank);
            if (data.awakeningLevel) setAwakeningLevel(data.awakeningLevel);
            if (data.deck) setDeck(data.deck);
            if (data.legacies) setLegacies(data.legacies);
        } catch (e) {
            console.error("Failed to load saved setup", e);
        }
    }
  }, []);

  useEffect(() => {
    const data = { selectedTrainee, starRank, awakeningLevel, deck, legacies };
    localStorage.setItem('uma_run_setup', JSON.stringify(data));
  }, [selectedTrainee, starRank, awakeningLevel, deck, legacies]);

  useEffect(() => {
    supabase.from('trainees').select('id, name, title, icon_path, stats_base, stats_three_star, stats_four_star, stats_five_star, apt_turf, apt_dirt, apt_short, apt_mile, apt_mid, apt_long, apt_leading, apt_stalking, apt_mid_pack, apt_chasing').order('name').then(({ data }) => data && setTrainees(data as Trainee[]));
    supabase.from('support_cards').select('id, name, rarity, card_type, effects:support_card_effects(effect_type_id, unlock_level, values_by_level)').then(({ data }) => data && setCards(data as CardBasic[]));

    const fetchSkills = async () => {
        const { data: page1 } = await supabase.from('skills').select('gametora_id, name, icon_url').order('name').range(0, 999);
        const { data: page2 } = await supabase.from('skills').select('gametora_id, name, icon_url').order('name').range(1000, 1999);
        const { data: page3 } = await supabase.from('skills').select('gametora_id, name, icon_url').order('name').range(2000, 2999);

        const allSkills = [...(page1 || []), ...(page2 || []), ...(page3 || [])];
        setSkills(allSkills.map(s => ({ id: Number(s.gametora_id), name: s.name, icon_url: s.icon_url })));
    };
    fetchSkills();

    // Load hint skills from support_cards.hints JSONB column, then resolve names from skills table
    supabase
      .from('support_cards')
      .select('id, hints')
      .not('hints', 'is', null)
      .then(async ({ data: cardsWithHints }) => {
        if (!cardsWithHints) return;
        // Collect all unique skill IDs across all cards
        const allSkillIds = new Set<number>();
        const cardSkillMap: Record<number, number[]> = {};
        for (const card of cardsWithHints) {
          const hintSkills = (card.hints as { hint_skills?: number[] })?.hint_skills;
          if (!hintSkills?.length) continue;
          cardSkillMap[card.id] = hintSkills;
          hintSkills.forEach(id => allSkillIds.add(id));
        }
        if (allSkillIds.size === 0) return;
        // Fetch skill names for all referenced IDs
        const ids = Array.from(allSkillIds);
        const { data: skillRows } = await supabase.from('skills').select('gametora_id, name, icon_url').in('gametora_id', ids);
        const skillLookup = new Map<number, { name: string; icon_url?: string }>();
        for (const s of (skillRows || [])) {
          skillLookup.set(Number(s.gametora_id), { name: s.name, icon_url: s.icon_url ?? undefined });
        }
        // Build the card hint map
        const map: Record<number, { skill_id: number; name: string; icon_url?: string }[]> = {};
        for (const [cardId, skillIds] of Object.entries(cardSkillMap)) {
          map[Number(cardId)] = skillIds
            .filter(sid => skillLookup.has(sid))
            .map(sid => ({ skill_id: sid, name: skillLookup.get(sid)!.name, icon_url: skillLookup.get(sid)!.icon_url }));
        }
        setCardHintSkills(map);
      });

    supabase.from('legacy_scenarios').select('name').order('name').then(({ data }) => data && setScenarios(data.map(d => d.name)));
    supabase.from('races').select('name_en,grade').order('grade').order('name_en').then(({ data }) => data && setRaces(data.map(d => d.name_en)));

    if (user) {
        supabase.from('user_trainee_collection').select('trainee_id, star_rank, awakening_level').eq('user_id', user.id).then(({ data }) => {
            if (data) {
                const map: Record<number, { star_rank: number, awakening_level: number }> = {};
                data.forEach(d => { map[d.trainee_id] = { star_rank: d.star_rank, awakening_level: d.awakening_level }; });
                setUserTrainees(map);
            }
        });
        supabase.from('user_support_card_collection').select('card_id, level').eq('user_id', user.id).then(({ data }) => {
            if (data) {
                const map: Record<number, { level: number }> = {};
                data.forEach(d => { map[d.card_id] = { level: d.level }; });
                setUserCards(map);
            }
        });

        // Fetch incomplete runs (no final_stats) with last turn state
        supabase
            .from('training_runs')
            .select('id, trainee_id, star_rank, awakening_level, deck, legacy_config, inherited_stats, initial_sp, created_at, final_stats')
            .eq('user_id', user.id)
            .is('final_stats', null)
            .order('created_at', { ascending: false })
            .limit(5)
            .then(async ({ data: runs }) => {
                if (!runs) return;
                const enriched: SavedRun[] = await Promise.all(runs.map(async run => {
                    const { data: turns } = await supabase
                        .from('training_run_turns')
                        .select('turn_number, stats_before, stat_gains, energy_before, energy_change, mood_before, friendship_before, sp_gain')
                        .eq('run_id', run.id)
                        .order('turn_number', { ascending: false })
                        .limit(1);
                    const last = turns?.[0];
                    const currentStats = last
                        ? {
                            speed: (last.stats_before?.speed ?? 0) + (last.stat_gains?.speed ?? 0),
                            stamina: (last.stats_before?.stamina ?? 0) + (last.stat_gains?.stamina ?? 0),
                            power: (last.stats_before?.power ?? 0) + (last.stat_gains?.power ?? 0),
                            guts: (last.stats_before?.guts ?? 0) + (last.stat_gains?.guts ?? 0),
                            wisdom: (last.stats_before?.wisdom ?? 0) + (last.stat_gains?.wisdom ?? 0),
                          }
                        : (run.inherited_stats ?? { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });
                    return {
                        ...run,
                        last_turn: last ? last.turn_number + 1 : 0,
                        current_stats: currentStats,
                        current_energy: last ? Math.min(100, Math.max(0, last.energy_before + last.energy_change)) : 100,
                        current_mood: last?.mood_before ?? 3,
                        current_friendship: last?.friendship_before ?? Array(6).fill(0),
                        current_sp: (run.initial_sp ?? 120) + (turns?.reduce((sum: number, t: { sp_gain: number }) => sum + (t.sp_gain ?? 0), 0) ?? 0),
                    };
                }));
                setSavedRuns(enriched);
            });

        supabase
            .from('scenario_events')
            .select('*')
            .or(`is_public.eq.true,created_by.eq.${user.id}`)
            .order('name')
            .then(({ data }) => data && setScenarioEvents(data as ScenarioEvent[]));
    }
  }, [user]);

  const inheritanceGains = useMemo(() => {
    const sparkStatGains = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
    const baseStatGains = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
    const midMin = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
    const midMax = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
    const startHints: { skill_id: number; levels: number }[] = [];
    const aptPoints: Record<string, number> = {};

    const getEffectValue = (card: CardBasic, typeId: number, level: number) => {
        const eff = card.effects?.find(e => e.effect_type_id === typeId);
        if (!eff || level < eff.unlock_level) return 0;
        return eff.values_by_level[level - 1] || eff.values_by_level[eff.values_by_level.length - 1] || 0;
    };

    // Support Card Deck - Initial Stat Up Bonuses
    deck.forEach(slot => {
        const card = cards.find(c => c.id === slot.id);
        if (card) {
            STAT_NAMES.forEach(s => {
                const key = s.toLowerCase() as keyof StatBlock;
                baseStatGains[key] += getEffectValue(card, INITIAL_STAT_EFFECTS[key], slot.level);
            });
        }
    });

    // Parent Flat Bonus (+20 to all stats)
    STAT_NAMES.forEach(s => {
        const key = s.toLowerCase() as keyof StatBlock;
        baseStatGains[key] += 20;
    });

    // Ancestor Spark/Aptitude/Hint Calculations
    const memberKeys = ['l1p', 'l1g1', 'l1g2', 'l2p', 'l2g3', 'l2g4'];
    memberKeys.forEach(key => {
        const member = legacies[key];
        if (!member) return;

        member.factors.forEach(f => {
            if (f.type === 'BlueStat' && f.stat_index !== undefined) {
                const sKey = STAT_NAMES[f.stat_index].toLowerCase() as keyof StatBlock;
                const initial = f.stars === 3 ? 21 : (f.stars === 2 ? 12 : 5);
                sparkStatGains[sKey] += initial;
                
                // For simulator range
                midMin[sKey] += 1;
                midMax[sKey] += (f.stars === 3 ? 25 : (f.stars === 2 ? 16 : 10));
            } else if (f.type === 'UniqueSkill' && f.skill_id) {
                if (key === 'l1p' || key === 'l2p') {
                    // Skill hint levels for unique skills are usually 1 level per star-ish but at start it's 1
                    startHints.push({ skill_id: f.skill_id, levels: 1 });
                }
            } else if (f.type === 'Aptitude' && f.apt_name) {
                aptPoints[f.apt_name] = (aptPoints[f.apt_name] || 0) + f.stars;
            }
        });
    });

    const aptSteps: Record<string, number> = {};
    Object.entries(aptPoints).forEach(([name, points]) => {
        aptSteps[name] = Math.floor((points - 1) / 3) + 1;
    });

    return { sparkStatGains, baseStatGains, midMin, midMax, startHints, aptSteps };
  }, [legacies, deck, cards]);

  // Sync initialTrackerStats to base stats when trainee changes and no active run
  useEffect(() => {
    if (currentRunId) return;
    if (!selectedTrainee) return;
    const t = trainees.find(x => x.id === selectedTrainee);
    if (!t) return;
    let arr: number[] = [0,0,0,0,0];
    if (starRank === 5 && t.stats_five_star) arr = t.stats_five_star;
    else if (starRank === 4 && t.stats_four_star) arr = t.stats_four_star;
    else if (starRank === 3 && t.stats_three_star) arr = t.stats_three_star;
    else if (t.stats_base) arr = t.stats_base;
    setInitialTrackerStats({ speed: arr[0], stamina: arr[1], power: arr[2], guts: arr[3], wisdom: arr[4] });
  }, [selectedTrainee, starRank, trainees, currentRunId]);

  const traineeBaseStats = useMemo(() => {
    if (!selectedTrainee) return null;
    const t = trainees.find(x => x.id === selectedTrainee);
    if (!t) return null;

    let baseArr: number[] = [0,0,0,0,0];
    if (starRank === 5 && t.stats_five_star) baseArr = t.stats_five_star;
    else if (starRank === 4 && t.stats_four_star) baseArr = t.stats_four_star;
    else if (starRank === 3 && t.stats_three_star) baseArr = t.stats_three_star;
    else if (t.stats_base) baseArr = t.stats_base;

    if (!baseArr) baseArr = [0,0,0,0,0];

    return {
        speed: baseArr[0],
        stamina: baseArr[1],
        power: baseArr[2],
        guts: baseArr[3],
        wisdom: baseArr[4]
    };
  }, [selectedTrainee, trainees, starRank]);

  const expectedStartStats = useMemo(() => {
    if (!traineeBaseStats) return null;
    return {
        speed: traineeBaseStats.speed + inheritanceGains.baseStatGains.speed + inheritanceGains.sparkStatGains.speed,
        stamina: traineeBaseStats.stamina + inheritanceGains.baseStatGains.stamina + inheritanceGains.sparkStatGains.stamina,
        power: traineeBaseStats.power + inheritanceGains.baseStatGains.power + inheritanceGains.sparkStatGains.power,
        guts: traineeBaseStats.guts + inheritanceGains.baseStatGains.guts + inheritanceGains.sparkStatGains.guts,
        wisdom: traineeBaseStats.wisdom + inheritanceGains.baseStatGains.wisdom + inheritanceGains.sparkStatGains.wisdom,
    };
  }, [traineeBaseStats, inheritanceGains]);

  const traineeAptitudes = useMemo((): Record<string, string> => {
    if (!selectedTrainee) return {};
    const t = trainees.find(x => x.id === selectedTrainee);
    if (!t) return {};
    return Object.fromEntries(
      APT_KEYS.map(({ key }) => [key, (t[`apt_${key}` as keyof Trainee] as string | null) ?? 'G'])
    );
  }, [selectedTrainee, trainees]);

  const initialStats = useMemo(() => {
      return initialTrackerStats.speed > 0 || initialTrackerStats.stamina > 0 ? initialTrackerStats : (expectedStartStats ?? { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });
  }, [initialTrackerStats, expectedStartStats]);

  const currentState = useMemo(() => {
      if (!currentRunId) return null;
      return deriveRunState({ stats: initialStats, sp: 120, deckSize: deck.length, aptitudes: traineeAptitudes }, timelineEvents);
  }, [timelineEvents, initialStats, deck.length, currentRunId, traineeAptitudes]);
  const traineeOptions = useMemo(() => trainees.map(t => ({
      id: t.id,
      label: t.name,
      subLabel: t.title || undefined,
      image: getTraineeIconUrl(t)
  })), [trainees]);

  const cardOptions = useMemo(() => cards.sort((a, b) => a.name.localeCompare(b.name)).map(c => ({
      id: c.id,
      label: c.name,
      subLabel: c.rarity,
      image: getCardIconUrl(c.id),
      typeIcon: getTypeIconUrl(c.card_type)
  })), [cards]);

  const skillOptions = useMemo(() => skills.map(s => ({
      id: s.id,
      label: s.name,
      image: s.icon_url || undefined
  })), [skills]);

  // Max hint levels per deck slot. Hint levels in-game range from 1 to 5.
  // Cards with HintLevels effect (type 17) add bonus levels on top of the base 1.
  const cardMaxHintLevel = useMemo(() => {
    return deck.map(slot => {
      const card = cards.find(c => c.id === slot.id);
      if (!card) return 1;
      const hintEffect = card.effects.find(e => e.effect_type_id === 17);
      if (!hintEffect) return 1;
      const levelIdx = Math.min(slot.level, (hintEffect.values_by_level?.length ?? 1) - 1);
      const bonus = hintEffect.values_by_level?.[levelIdx] ?? 0;
      return Math.min(1 + bonus, 5);
    });
  }, [deck, cards]);

  const addFactor = (memberKey: string) => {
    const newLegacies = { ...legacies };
    const member = newLegacies[memberKey];

    if (member.factors.length === 0) {
        member.factors.push({ type: 'BlueStat', stat_index: 0, stars: 3 });
        member.factors.push({ type: 'Aptitude', apt_name: 'turf', stars: 3 });
        member.factors.push({ type: 'UniqueSkill', skill_id: 0, stars: 3 });
    } else {
        member.factors.push({ type: 'BlueStat', stat_index: 0, stars: 3 });
    }
    setLegacies(newLegacies);
  };

  const duplicateFactor = (memberKey: string, factorIdx: number) => {
    const newLegacies = { ...legacies };
    const factor = { ...newLegacies[memberKey].factors[factorIdx] };
    newLegacies[memberKey].factors.splice(factorIdx + 1, 0, factor);
    setLegacies(newLegacies);
  };

  const updateFactor = (memberKey: string, factorIdx: number, updates: Partial<Factor>) => {
    const newLegacies = { ...legacies };
    newLegacies[memberKey].factors[factorIdx] = { ...newLegacies[memberKey].factors[factorIdx], ...updates };
    setLegacies(newLegacies);
  };

  const removeFactor = (memberKey: string, factorIdx: number) => {
    const newLegacies = { ...legacies };
    newLegacies[memberKey].factors.splice(factorIdx, 1);
    setLegacies(newLegacies);
  };

  // Returns friendship deltas array: +7 for each card whose placement matches the facility, 0 otherwise.
  function friendshipDeltasForFacility(facility: number, placements: number[]): number[] {
    return deck.map((_, i) => placements[i] === facility ? 7 : 0);
  }

  function sanitizeMember(m: LegacyMember): LegacyMember {
    return {
      ...m,
      factors: m.factors.filter(f => {
        if (f.type === 'BlueStat') return f.stat_index !== undefined && f.stat_index !== null;
        if (f.type === 'UniqueSkill' || f.type === 'SkillHint') return f.skill_id !== undefined && f.skill_id !== null && f.skill_id !== 0;
        if (f.type === 'RaceBonus') return !!f.race_name;
        if (f.type === 'Aptitude') return !!f.apt_name;
        if (f.type === 'Scenario') return !!f.name;
        return false;
      }),
    };
  }

  const fetchTurnSimulation = async () => {
    if (!selectedTrainee || !currentState) return;
    setLoading(true);
    const deckParam = deck.filter(c => c.id !== 0).map(c => [c.id, c.level]);
    const trainingTurns = timelineEvents.filter(e => e.type === 'training').length;
    const payload = {
        trainee_id: selectedTrainee,
        star_rank: starRank,
        algorithm: "monte_carlo_v2",
        config: {
            awakening_level: awakeningLevel,
            scenario,
            legacy: {
                legacy_1: { parent: sanitizeMember(legacies.l1p), grandparent_1: sanitizeMember(legacies.l1g1), grandparent_2: sanitizeMember(legacies.l1g2) },
                legacy_2: { parent: sanitizeMember(legacies.l2p), grandparent_1: sanitizeMember(legacies.l2g3), grandparent_2: sanitizeMember(legacies.l2g4) }
            }
        },
        deck: deckParam,
        state: {
            turn: trainingTurns,
            stats: currentState.stats,
            energy: currentState.energy,
            mood: currentState.mood,
            friendship: currentState.friendship,
            facility_trains: (() => {
                const counts = Array(5).fill(0);
                timelineEvents.forEach(e => { if (e.type === 'training' && e.payload.facility >= 0 && e.payload.facility < 5) counts[e.payload.facility]++; });
                return counts;
            })(),
            facility_levels: (() => {
                const TRAINS_PER_LEVEL = 4;
                const counts = Array(5).fill(0);
                timelineEvents.forEach(e => { if (e.type === 'training' && e.payload.facility >= 0 && e.payload.facility < 5) counts[e.payload.facility]++; });
                return counts.map(n => Math.min(Math.floor(n / TRAINS_PER_LEVEL) + 1, 5));
            })(),
            skill_points: currentState.sp,
            card_placements: simPlacements.some(p => p >= 0) ? simPlacements : [],
            unity_bonus_cards: simUnityBonuses,
            hint_cards: simHintCards,
        }
    };
    try {
        const response = await fetch('http://localhost:3001/api/simulate-turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const text = await response.text();
            console.error(`simulate-turn ${response.status}:`, text);
            alert(`Simulation failed (${response.status}): ${text}`);
            return;
        }
        const data: TurnResult = await response.json();
        setTurnResult(data);
        // Auto-select best facility using composite scores from backend (accounts for stats, SP, friendship, hints)
        const scores = data.facility_scores?.length ? data.facility_scores : data.expected_gains.map(g => g.speed + g.stamina + g.power + g.guts + g.wisdom);
        const best = scores.reduce((bi, s, i) => s > scores[bi] ? i : bi, 0);
        setSelectedFacility(best);
    } catch (err) {
        console.error(err);
        alert("Error simulating turn");
    } finally {
        setLoading(false);
    }
  };

  const handleStartRun = async () => {
    if (!user) {
        alert("Please login to save runs");
        return;
    }
    if (!selectedTrainee) {
        alert("Please select a trainee first");
        return;
    }

    const deckParam = deck.filter(c => c.id !== 0).map(c => ({ card_id: c.id, level: c.level }));
    const legacyConfig = {
        legacy_1: {
            parent: legacies.l1p,
            grandparent_1: legacies.l1g1,
            grandparent_2: legacies.l1g2
        },
        legacy_2: {
            parent: legacies.l2p,
            grandparent_1: legacies.l2g3,
            grandparent_2: legacies.l2g4
        }
    };

    const { data, error } = await supabase.from('training_runs').insert({
        user_id: user.id,
        trainee_id: selectedTrainee,
        star_rank: starRank,
        awakening_level: awakeningLevel,
        deck: deckParam,
        legacy_config: legacyConfig,
        initial_sp: 120,
        inherited_stats: addStats(traineeBaseStats ?? { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 }, inheritanceGains.baseStatGains)
    }).select().single();

    if (error) {
        console.error(error);
        alert("Error starting run: " + error.message);
    } else {
        // Calculate aptitude changes for initial inspiration
        const aptitudeChanges = Object.entries(inheritanceGains.aptSteps).map(([name, steps]) => {
            const baseGrade = traineeAptitudes[name] || 'G';
            const baseIdx = GRADES.indexOf(baseGrade);
            const newIdx = Math.max(0, baseIdx - steps);
            return { name, grade: GRADES[newIdx] };
        });

        // Automatically add Initial Inspiration event
        await supabase.from('training_run_events').insert({
            run_id: data.id,
            sequence: 0,
            type: 'inspiration',
            payload: {
                label: 'Initial Inspiration',
                stat_gains: inheritanceGains.sparkStatGains,
                aptitude_changes: aptitudeChanges,
                hints: inheritanceGains.startHints
            }
        });

        setCurrentRunId(data.id);
        setTimelineEvents([]);
        setMode('tracker');
    }
  };

  const handleResumeRun = (run: SavedRun) => {
    setSelectedTrainee(run.trainee_id);
    setStarRank(run.star_rank);
    setAwakeningLevel(run.awakening_level);
    setDeck(run.deck.map(d => ({ id: d.card_id, level: d.level })));
    const lc = run.legacy_config;
    setLegacies({
        l1p: lc.legacy_1.parent,
        l1g1: lc.legacy_1.grandparent_1,
        l1g2: lc.legacy_1.grandparent_2,
        l2p: lc.legacy_2.parent,
        l2g3: lc.legacy_2.grandparent_1,
        l2g4: lc.legacy_2.grandparent_2,
    });
    setCurrentRunId(run.id);
    setInitialTrackerStats(run.inherited_stats ?? { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });
    setTimelineEvents([]);
    setMode('tracker');
  };

  // Load timeline events when currentRunId changes
  useEffect(() => {
    if (!currentRunId) return;
    supabase
        .from('training_run_events')
        .select('*')
        .eq('run_id', currentRunId)
        .order('sequence')
        .then(({ data }) => data && setTimelineEvents(data as TimelineEvent[]));
  }, [currentRunId]);

  // Auto-populate sim placements from card types when deck/cards change
  useEffect(() => {
    if (cards.length === 0) return;
    setSimPlacements(deck.map(slot => {
      const card = cards.find(c => c.id === slot.id);
      return card ? (CARD_TYPE_TO_FACILITY[card.card_type] ?? -1) : -1;
    }));
  }, [deck, cards]);

  const loadTimelineEvents = async () => {
    if (!currentRunId) return;
    const { data } = await supabase
        .from('training_run_events')
        .select('*')
        .eq('run_id', currentRunId)
        .order('sequence');
    if (data) setTimelineEvents(data as TimelineEvent[]);
  };

  const setFormField = (key: string, value: unknown) => setEntryForm(prev => ({ ...prev, [key]: value }));

  const handleAddEntry = async () => {
    if (!currentRunId || !user) return;
    setSubmittingEntry(true);

    let scenarioEventId: string | null = null;

    // Optionally save as reusable scenario event
    if (entryType === 'event' && entryForm.save_to_db) {
        const { data: se, error: seErr } = await supabase.from('scenario_events').insert({
            trainee_id: selectedTrainee,
            name: entryForm.label,
            sp_change: entryForm.sp_change || 0,
            stat_changes: entryForm.stat_changes,
            energy_change: entryForm.energy_change || 0,
            mood_change: entryForm.mood_change || 0,
            created_by: user.id,
            is_public: false,
        }).select('id').single();
        if (seErr) { alert('Error saving event: ' + seErr.message); setSubmittingEntry(false); return; }
        scenarioEventId = se.id;
        setScenarioEvents(prev => [...prev, { id: se.id, trainee_id: selectedTrainee, name: String(entryForm.label ?? ''), description: null, sp_change: Number(entryForm.sp_change ?? 0), stat_changes: (entryForm.stat_changes as ScenarioEvent['stat_changes']) ?? {}, energy_change: Number(entryForm.energy_change ?? 0), mood_change: Number(entryForm.mood_change ?? 0), hints: [], aptitudes: [] }]);
    }

    // For training entries with hint cards toggled, add +5 friendship per hinting card
    let payload = entryForm;
    if (entryType === 'training' && simHintCards.some(Boolean)) {
        const fd = [...(entryForm.friendship_deltas || Array(6).fill(0))];
        simHintCards.forEach((hinted, i) => { if (hinted) fd[i] = (fd[i] || 0) + 5; });
        payload = { ...entryForm, friendship_deltas: fd };
    }

    const { error } = await supabase.from('training_run_events').insert({
        run_id: currentRunId,
        sequence: timelineEvents.length,
        type: entryType,
        payload,
        scenario_event_id: scenarioEventId,
    });

    if (error) {
        alert('Error saving entry: ' + error.message);
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
    setSubmittingEntry(false);
  };

  const handleDeleteEntry = async (eventId: string, seq: number) => {
    if (!currentRunId) return;
    const { error } = await supabase.from('training_run_events').delete().eq('id', eventId);
    if (!error) {
        // Resequence remaining events in DB
        const remaining = timelineEvents.filter(e => e.id !== eventId);
        await Promise.all(remaining.filter(e => e.sequence > seq).map(e =>
            supabase.from('training_run_events').update({ sequence: e.sequence - 1 }).eq('id', e.id)
        ));
        await loadTimelineEvents();
    }
  };

  const handleUpdateEntry = async () => {
    if (!editingEvent || !currentRunId) return;
    setSubmittingEntry(true);
    const { error } = await supabase
        .from('training_run_events')
        .update({ payload: entryForm })
        .eq('id', editingEvent.id);

    if (error) {
        alert('Error updating entry: ' + error.message);
    } else {
        await loadTimelineEvents();
        setEditingEvent(null);
        setAddingEntry(false);
        setTurnResult(null);
    }
    setSubmittingEntry(false);
  };

  const handleRestoreInitialInspiration = async () => {
    if (!currentRunId || !selectedTrainee) return;
    setSubmittingEntry(true);
    
    const aptitudeChanges = Object.entries(inheritanceGains.aptSteps).map(([name, steps]) => {
        const baseGrade = traineeAptitudes[name] || 'G';
        const baseIdx = GRADES.indexOf(baseGrade);
        const newIdx = Math.max(0, baseIdx - steps);
        return { name, grade: GRADES[newIdx] };
    });

    const { error } = await supabase.from('training_run_events').insert({
        run_id: currentRunId,
        sequence: 0,
        type: 'inspiration',
        payload: {
            label: 'Initial Inspiration',
            stat_gains: inheritanceGains.sparkStatGains,
            aptitude_changes: aptitudeChanges,
            hints: inheritanceGains.startHints
        }
    });

    if (error) {
        alert('Error restoring inspiration: ' + error.message);
    } else {
        await loadTimelineEvents();
    }
    setSubmittingEntry(false);
  };

  return (
    <div style={{ padding: '4rem 1.5rem 2rem', maxWidth: 1600, margin: '0 auto', minHeight: '100vh' }}>
      <div style={{ paddingBottom: '2rem', borderBottom: '1px solid #222', marginBottom: '2rem' }}>
        <Link to="/umamusume" className="back" style={{ display: 'inline-block', marginBottom: '1rem', position: 'relative' }}>&larr; back</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
                <h1 style={{ fontSize: 'clamp(1.5rem, 6vw, 2rem)', fontWeight: 700, margin: '0.5rem 0', color: '#fff' }}>Run Comparison Simulator</h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Comprehensive simulation including full 6-member legacy tree and awakening potential.</p>
            </div>
            <div style={{ display: 'flex', background: '#111', padding: '4px', borderRadius: '10px', border: '1px solid #333' }}>
                <button
                    onClick={() => setMode('simulation')}
                    style={{ ...modeButtonStyle, background: mode === 'simulation' ? '#2563eb' : 'transparent', color: mode === 'simulation' ? '#fff' : 'var(--text-muted)' }}
                >Simulation</button>
                <button
                    onClick={() => setMode('tracker')}
                    style={{ ...modeButtonStyle, background: mode === 'tracker' ? '#2563eb' : 'transparent', color: mode === 'tracker' ? '#fff' : 'var(--text-muted)' }}
                >Tracker</button>
            </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '2rem' }}>
        {mode === 'simulation' ? (
            <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <section style={sectionStyle}>
                    <h3 style={sectionHeaderStyle}>1. Trainee Configuration</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '1rem' }}>
                        <SearchableSelect
                            options={traineeOptions}
                            value={selectedTrainee}
                            onChange={val => {
                                const id = typeof val === 'string' ? parseInt(val) : val;
                                setSelectedTrainee(id);
                                if (id && userTrainees[id]) {
                                    setStarRank(userTrainees[id].star_rank);
                                    setAwakeningLevel(userTrainees[id].awakening_level);
                                }
                            }}
                            placeholder="Select Trainee"
                        />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={miniLabelStyle}>Rank</label>
                            <select value={starRank} onChange={e => setStarRank(parseInt(e.target.value))} style={inputStyle}>
                                {[1,2,3,4,5].map(r => <option key={r} value={r}>{r}★</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={miniLabelStyle}>Awake</label>
                            <select value={awakeningLevel} onChange={e => setAwakeningLevel(parseInt(e.target.value))} style={inputStyle}>
                                {[1,2,3,4,5].map(r => <option key={r} value={r}>Lv{r}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={miniLabelStyle}>Scenario</label>
                            <select value={scenario} onChange={e => setScenario(e.target.value)} style={inputStyle}>
                                <option value="default">Default</option>
                                <option value="unity_cup">Unity Cup</option>
                                <option value="beyond_dreams">Beyond Dreams</option>
                                <option value="trackblazer">Trackblazer</option>
                            </select>
                        </div>
                    </div>
                </section>

                <section style={sectionStyle}>
                    <h3 style={sectionHeaderStyle}>2. Support Deck</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '0.75rem' }}>
                        {deck.map((slot, i) => (
                            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                <SearchableSelect
                                    options={cardOptions}
                                    value={slot.id === 0 ? null : slot.id}
                                    onChange={val => {
                                        const id = typeof val === 'string' ? parseInt(val) : (val || 0);
                                        const newDeck = [...deck];
                                        const savedLevel = id !== 0 ? userCards[id]?.level : 50;
                                        newDeck[i] = { id, level: savedLevel || 50 };
                                        setDeck(newDeck);
                                    }}
                                    placeholder={`Card ${i+1}`}
                                />
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <label style={{ ...miniLabelStyle, marginBottom: 0 }}>Level</label>
                                    <input
                                        type="number"
                                        value={slot.level}
                                        onChange={e => {
                                            const newDeck = [...deck];
                                            newDeck[i] = { ...newDeck[i], level: parseInt(e.target.value) || 1 };
                                            setDeck(newDeck);
                                        }}
                                        style={{ ...inputStyle, flex: 1, padding: '0.3rem', fontSize: '0.75rem' }}
                                        min={1} max={50}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Projected Start Stats */}
                {expectedStartStats && (
                    <section style={{ ...sectionStyle, border: '1px solid #374151', background: '#111827' }}>
                        <h3 style={sectionHeaderStyle}>Calculated Start Stats</h3>
                        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                            Calculated from trainee base stats ({starRank}★) + legacy blue factors.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
                            {STAT_NAMES.map(s => {
                                const key = s.toLowerCase() as keyof StatBlock;
                                return (
                                    <div key={s} style={{ textAlign: 'center' }}>
                                        <label style={{ ...miniLabelStyle, display: 'block' }}>{s.slice(0, 3)}</label>
                                        <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>
                                            {expectedStartStats[key]}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                <button
                    onClick={handleStartRun}
                    disabled={loading || !selectedTrainee}
                    style={{ ...primaryButtonStyle, background: '#059669' }}
                >
                    Start Tracking This Run
                </button>

                {savedRuns.length > 0 && (
                    <section style={{ ...sectionStyle, border: '1px solid #374151' }}>
                        <h3 style={sectionHeaderStyle}>Resume a Run</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {savedRuns.map(run => {
                                const trainee = trainees.find(t => t.id === run.trainee_id);
                                return (
                                    <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem', background: '#111', borderRadius: 8, border: '1px solid #222' }}>
                                        {trainee && <img src={getTraineeIconUrl(trainee)} alt="" style={{ width: 36, height: 36, borderRadius: 6, flexShrink: 0 }} />}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#fff' }}>{trainee?.name ?? `Trainee #${run.trainee_id}`}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                {run.star_rank}★ · Turn {run.last_turn} · {new Date(run.created_at).toLocaleDateString()}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: '#9ca3af', marginTop: 2 }}>
                                                Spd {run.current_stats.speed} · Sta {run.current_stats.stamina} · Pow {run.current_stats.power} · Gut {run.current_stats.guts} · Wis {run.current_stats.wisdom}
                                            </div>
                                        </div>
                                        <button onClick={() => handleResumeRun(run)} style={{ ...primaryButtonStyle, width: 'auto', padding: '0.4rem 0.9rem', fontSize: '0.8rem', background: '#1d4ed8', flexShrink: 0 }}>
                                            Resume
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <section style={{ ...sectionStyle, border: '1px solid #333' }}>
                    <h3 style={sectionHeaderStyle}>4. Legacy Inheritance</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Click a member to edit their sparks/factors.</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <div style={legacySlotStyle}>
                            <div style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 700, marginBottom: 8 }}>LEGACY 1</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <MemberButton label="Parent 1" memberKey="l1p" legacies={legacies} onClick={setEditingMember} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <MemberButton label="GP 1" memberKey="l1g1" legacies={legacies} onClick={setEditingMember} />
                                    <MemberButton label="GP 2" memberKey="l1g2" legacies={legacies} onClick={setEditingMember} />
                                </div>
                            </div>
                        </div>

                        <div style={legacySlotStyle}>
                            <div style={{ fontSize: '0.7rem', color: '#ec4899', fontWeight: 700, marginBottom: 8 }}>LEGACY 2</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <MemberButton label="Parent 2" memberKey="l2p" legacies={legacies} onClick={setEditingMember} />
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <MemberButton label="GP 3" memberKey="l2g3" legacies={legacies} onClick={setEditingMember} />
                                    <MemberButton label="GP 4" memberKey="l2g4" legacies={legacies} onClick={setEditingMember} />
                                </div>
                            </div>
                        </div>
                    </div>
                </section>


            </div>
            </>
        ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', gridColumn: '1 / -1' }}>
                {/* Status bar */}
                {currentState && (
                    <section style={{ ...sectionStyle, border: '1px solid #374151' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>
                            <div style={{ flex: 1, minWidth: 220 }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Stats {expectedStartStats ? '(vs expected)' : ''}</div>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    {STAT_NAMES.map(s => {
                                        const key = s.toLowerCase() as keyof StatBlock;
                                        const val = currentState.stats[key];
                                        const exp = expectedStartStats?.[key];
                                        const delta = exp != null ? val - exp : null;
                                        return (
                                            <div key={s} style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{s.slice(0,3)}</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff' }}>{val}</div>
                                                {delta != null && delta !== 0 && (
                                                    <div style={{ fontSize: '0.6rem', color: delta > 0 ? '#4ade80' : '#f87171' }}>{delta > 0 ? '+' : ''}{delta}</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Energy</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: currentState.energy < 30 ? '#f87171' : '#4ade80' }}>{Math.round(currentState.energy)}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Mood</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{['😞','😟','😐','🙂','😄'][currentState.mood]}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>SP</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#a78bfa' }}>{currentState.sp}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Turns</div>
                                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#60a5fa' }}>{timelineEvents.filter(e => e.type === 'training').length}</div>
                                </div>
                            </div>
                            {currentState.hints.length > 0 && (
                                <div style={{ flex: 1, minWidth: 180 }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Hints</div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                        {currentState.hints.map(h => {
                                            const skill = skills.find(s => s.id === h.skill_id);
                                            return (
                                                <span key={h.skill_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#1a2e1a', border: '1px solid #166534', borderRadius: 6, padding: '2px 7px', fontSize: '0.7rem', color: '#4ade80' }}>
                                                    {skill?.icon_url && <img src={skill.icon_url} alt="" style={{ width: 14, height: 14 }} />}
                                                    {skill?.name ?? `#${h.skill_id}`} <strong>Lv{h.level}</strong>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                            {Object.keys(currentState.aptitudes).length > 0 && (
                                <div style={{ flex: 1, minWidth: 280 }}>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Aptitudes</div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                        {(['Track', 'Distance', 'Style'] as const).map(group => (
                                            <div key={group} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)', width: 50, flexShrink: 0 }}>{group}</span>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                    {APT_KEYS.filter(a => a.group === group).map(({ key, label }) => {
                                                        const grade = currentState.aptitudes[key] ?? 'G';
                                                        const color = GRADE_COLORS[grade] ?? '#4b5563';
                                                        return (
                                                            <span key={key} style={{ background: `${color}18`, border: `1px solid ${color}66`, borderRadius: 6, padding: '2px 7px', fontSize: '0.7rem', color }}>
                                                                {label} {grade}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        {/* Training Board — card placement, facility picker, stat display */}
                        {currentState && (
                        <section style={sectionStyle}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                <h3 style={{ ...sectionHeaderStyle, margin: 0 }}>Training Board</h3>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    {selectedFacility !== null && turnResult && (
                                        <button
                                            onClick={() => {
                                                const gains = turnResult.expected_gains[selectedFacility];
                                                const cost = turnResult.expected_energy_costs[selectedFacility];
                                                setEntryType('training');
                                                const initialHints = simHintCards
                                                    .map((h, i) => h ? { card_index: i, skill_id: null, levels: 1 } : null)
                                                    .filter((h): h is { card_index: number; skill_id: null; levels: number } => h !== null);

                                                setEntryForm({ ...DEFAULT_FORMS.training, facility: selectedFacility, stat_gains: gains, energy_change: Math.round(cost), sp_gain: 2, card_placements: simPlacements, friendship_deltas: friendshipDeltasForFacility(selectedFacility, simPlacements), hint_skills: initialHints });
                                                setAddingEntry(true);
                                            }}
                                            style={{ ...primaryButtonStyle, width: 'auto', padding: '0.4rem 1rem', fontSize: '0.8rem', background: '#1d4ed8' }}
                                        >
                                            Log {STAT_NAMES[selectedFacility]} Training
                                        </button>
                                    )}
                                    <button onClick={fetchTurnSimulation} disabled={loading || !selectedTrainee || !currentState} style={{ ...(loading ? disabledButtonStyle : primaryButtonStyle), width: 'auto', padding: '0.4rem 1rem', fontSize: '0.8rem' }}>
                                        {loading ? 'Calculating…' : 'Calculate'}
                                    </button>
                                </div>
                            </div>

                            {/* 6-column board: 5 facilities + SP/away */}
                            {(() => {
                                const COLS = [...STAT_NAMES, 'SP'];
                                const totalGain = (g: StatBlock) => g.speed + g.stamina + g.power + g.guts + g.wisdom;
                                const bestIdx = turnResult
                                    ? (() => {
                                        const scores = turnResult.facility_scores?.length ? turnResult.facility_scores : turnResult.expected_gains.map(g => g.speed + g.stamina + g.power + g.guts + g.wisdom);
                                        return scores.reduce((bi, s, i) => s > scores[bi] ? i : bi, 0);
                                      })()
                                    : null;

                                return (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.5rem' }}>
                                        {COLS.map((colName, colIdx) => {
                                            const isFacility = colIdx < 5;
                                            // SP column uses facilityIdx -1 (away); facilities use 0-4
                                            const facilityIdx = isFacility ? colIdx : -1;
                                            const isSelected = isFacility && selectedFacility === colIdx;
                                            const isBest = isFacility && bestIdx === colIdx;
                                            const key = isFacility ? colName.toLowerCase() as keyof StatBlock : null;
                                            const statVal = key ? currentState.stats[key] : currentState.sp;
                                            const baseVal = key ? initialTrackerStats[key] : 120;
                                            const gain = statVal - baseVal;
                                            const gains = turnResult && isFacility ? turnResult.expected_gains[colIdx] : null;
                                            const baseGains = turnResult && isFacility ? turnResult.base_gains?.[colIdx] : null;
                                            const specialGains = turnResult && isFacility ? turnResult.special_gains?.[colIdx] : null;
                                            const cost = turnResult && isFacility ? turnResult.expected_energy_costs[colIdx] : null;
                                            const failRate = turnResult && isFacility ? turnResult.failure_rates[colIdx] : null;
                                            
                                            // For facility or SP column
                                            const baseSp = turnResult ? (isFacility ? turnResult.base_sp_gains?.[colIdx] : turnResult.base_sp_gains?.[0]) : null;
                                            const specialSp = turnResult ? (isFacility ? turnResult.special_sp_gains?.[colIdx] : turnResult.special_sp_gains?.[0]) : null;

                                            // Cards assigned to this column
                                            const assignedCards = deck
                                                .map((slot, i) => ({ slot, i, card: cards.find(c => c.id === slot.id) }))
                                                .filter(({ i }) => (simPlacements[i] ?? -1) === facilityIdx);

                                            const borderColor = isSelected ? '#3b82f6' : isBest ? '#1d4ed8' : '#222';

                                            return (
                                                <div
                                                    key={colName}
                                                    onDragOver={e => e.preventDefault()}
                                                    onDrop={e => {
                                                        e.preventDefault();
                                                        if (draggingCard !== null) {
                                                            const np = [...simPlacements];
                                                            np[draggingCard] = facilityIdx;
                                                            setSimPlacements(np);
                                                            setTurnResult(null);
                                                            setSelectedFacility(null);
                                                            setDraggingCard(null);
                                                        }
                                                    }}
                                                    style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}
                                                >
                                                    {/* Card drop zone */}
                                                    <div style={{
                                                        minHeight: 56,
                                                        border: `1px dashed ${draggingCard !== null ? '#4b5563' : '#2d2d2d'}`,
                                                        borderRadius: 6,
                                                        padding: '3px',
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: 2,
                                                        transition: 'border-color 0.15s',
                                                        background: draggingCard !== null ? '#0f172a' : 'transparent',
                                                    }}>
                                                        {assignedCards.map(({ slot, i, card }) => (
                                                            <div
                                                                key={i}
                                                                draggable
                                                                onDragStart={e => { e.stopPropagation(); setDraggingCard(i); }}
                                                                onDragEnd={() => setDraggingCard(null)}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', gap: 3,
                                                                    background: '#1e293b', borderRadius: 4, padding: '2px 4px',
                                                                    cursor: 'grab', fontSize: '0.6rem', color: '#cbd5e1',
                                                                    border: '1px solid #334155', userSelect: 'none',
                                                                    opacity: draggingCard === i ? 0.4 : 1,
                                                                }}
                                                                title={`Lv ${slot.level} — drag to move`}
                                                            >
                                                                <img src={getTypeIconUrl(card?.card_type ?? '')} alt="" style={{ width: 10, height: 10, flexShrink: 0 }} />
                                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 56 }}>
                                                                    {card?.name ?? `Card ${slot.id}`}
                                                                </span>
                                                                {isFacility && (
                                                                    <button
                                                                        onMouseDown={e => e.stopPropagation()}
                                                                        onClick={e => {
                                                                            e.stopPropagation();
                                                                            const nb = [...simUnityBonuses];
                                                                            nb[i] = !nb[i];
                                                                            setSimUnityBonuses(nb);
                                                                            setTurnResult(null);
                                                                        }}
                                                                        title={simUnityBonuses[i] ? 'Special training ON — click to remove' : 'Special training OFF — click to add'}
                                                                        style={{
                                                                            background: simUnityBonuses[i] ? 'rgba(248, 113, 113, 0.2)' : 'none',
                                                                            border: simUnityBonuses[i] ? '1px solid rgba(248, 113, 113, 0.4)' : 'none',
                                                                            borderRadius: '4px',
                                                                            padding: '1px 2px',
                                                                            cursor: 'pointer', 
                                                                            fontSize: '0.65rem', 
                                                                            lineHeight: 1,
                                                                            opacity: simUnityBonuses[i] ? 1 : 0.3,
                                                                            filter: simUnityBonuses[i] ? 'drop-shadow(0 0 2px rgba(248, 113, 113, 0.8))' : 'grayscale(100%)',
                                                                            flexShrink: 0,
                                                                        }}
                                                                    >
                                                                        🔥
                                                                    </button>
                                                                )}
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
                                                                        setTurnResult(null);
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
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* Facility column */}
                                                    <div
                                                        onClick={() => isFacility && setSelectedFacility(isSelected ? null : colIdx)}
                                                        style={{
                                                            background: '#111',
                                                            borderRadius: 8,
                                                            padding: '0.55rem 0.4rem',
                                                            border: `1px solid ${borderColor}`,
                                                            boxShadow: isSelected ? '0 0 10px rgba(59,130,246,0.3)' : isBest ? '0 0 6px rgba(29,78,216,0.2)' : 'none',
                                                            cursor: isFacility ? 'pointer' : 'default',
                                                            display: 'flex', flexDirection: 'column', gap: 3,
                                                            textAlign: 'center',
                                                        }}
                                                    >
                                                        {/* Label */}
                                                        {(() => {
                                                            const trains = isFacility ? timelineEvents.filter(e => e.type === 'training' && e.payload.facility === colIdx).length : 0;
                                                            const level = Math.min(Math.floor(trains / 4) + 1, 5);
                                                            const levelColor = isFacility ? FACILITY_LEVEL_COLORS[level - 1] : '#a78bfa';

                                                            return (
                                                                <div style={{ 
                                                                    fontSize: '0.68rem', 
                                                                    fontWeight: 700, 
                                                                    color: isSelected ? '#fff' : levelColor, 
                                                                    background: isSelected ? levelColor : 'transparent',
                                                                    borderRadius: '4px',
                                                                    padding: '2px 0',
                                                                    display: 'flex', 
                                                                    alignItems: 'center', 
                                                                    justifyContent: 'center', 
                                                                    gap: 3,
                                                                    border: `1px solid ${levelColor}44`
                                                                }}>
                                                                    {isFacility
                                                                        ? <img src={getTypeIconUrl(colName.toLowerCase())} alt="" style={{ width: 10, height: 10, filter: isSelected ? 'brightness(0) invert(1)' : 'none' }} />
                                                                        : <span style={{ fontSize: '0.7rem' }}>SP</span>
                                                                    }
                                                                    {isFacility ? `${colName} Lv${level}` : colName}
                                                                    {isBest && !isSelected && <span style={{ fontSize: '0.55rem', color: levelColor }}>★</span>}
                                                                </div>
                                                            );
                                                        })()}

                                                        {/* Current stat value */}
                                                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                                                            {Math.round(statVal)}
                                                        </div>

                                                        {/* Gain from start */}
                                                        <div style={{ fontSize: '0.58rem', color: '#4ade80' }} title="Total gain since run start">
                                                            +{Math.round(gain)}
                                                        </div>

                                                        {/* Predicted gains from simulation */}
                                                        {gains && (
                                                            <>
                                                                <div style={{ borderTop: '1px solid #1f2937', marginTop: 2, paddingTop: 3 }} />
                                                                {/* Total gain */}
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: isSelected ? '#60a5fa' : '#6b7280' }}>
                                                                    +{totalGain(gains).toFixed(0)}
                                                                </div>
                                                                {/* Per-stat breakdown (only non-zero stats) */}
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                                    {STAT_NAMES.map(s => {
                                                                        const v = gains[s.toLowerCase() as keyof StatBlock];
                                                                        const bv = baseGains?.[s.toLowerCase() as keyof StatBlock] ?? v;
                                                                        const sv = specialGains?.[s.toLowerCase() as keyof StatBlock] ?? 0;
                                                                        
                                                                        if (v < 0.05) return null;
                                                                        return (
                                                                            <div key={s} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.58rem', color: '#9ca3af' }}>
                                                                                <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                                                    <img src={getTypeIconUrl(s.toLowerCase())} alt="" style={{ width: 9, height: 9 }} />
                                                                                    {s.slice(0, 3)}
                                                                                </span>
                                                                                <span title={sv > 0 ? `${bv.toFixed(0)} base + ${sv.toFixed(0)} bonus` : ''}>
                                                                                    +{bv.toFixed(0)}{sv > 0 && <span style={{ color: '#f87171' }}>+{sv.toFixed(0)}🔥</span>}
                                                                                </span>
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                                <div style={{ borderTop: '1px solid #1f2937', marginTop: 2, paddingTop: 3 }} />
                                                                {/* SP gain */}
                                                                <div style={{ fontSize: '0.62rem', color: '#a78bfa', fontWeight: 600, marginBottom: 2 }}>
                                                                    +{(baseSp ?? 0).toFixed(0)} SP{(specialSp ?? 0) > 0 && <span style={{ color: '#f87171' }}>+{(specialSp ?? 0).toFixed(0)}🔥</span>}
                                                                </div>
                                                                <div style={{ fontSize: '0.58rem', color: 'var(--text-muted)' }}>
                                                                    {Math.abs(cost!).toFixed(0)}E · {(failRate! * 100).toFixed(0)}%
                                                                </div>
                                                            </>
                                                        )}
                                                        
                                                        {/* SP column specific gain (when away) */}
                                                        {!isFacility && (baseSp !== null || specialSp !== null) && (
                                                            <>
                                                                <div style={{ borderTop: '1px solid #1f2937', marginTop: 2, paddingTop: 3 }} />
                                                                <div style={{ fontSize: '0.62rem', color: '#a78bfa', fontWeight: 600 }}>
                                                                    +{(baseSp ?? 0).toFixed(0)} SP
                                                                    {(specialSp ?? 0) > 0 && <span style={{ color: '#f87171' }}>+{(specialSp ?? 0).toFixed(0)}🔥</span>}
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                        </section>
                        )}

                        {/* Add Entry */}
                        <section style={{ ...sectionStyle, border: addingEntry ? '1px solid #374151' : '1px dashed #333' }}>
                            {!addingEntry ? (
                                <button onClick={() => setAddingEntry(true)} style={{ ...primaryButtonStyle, background: 'transparent', border: '1px dashed #555', color: '#a1a1aa' }}>
                                    + Add Entry
                                </button>
                            ) : (
                                <>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                        <h3 style={{ ...sectionHeaderStyle, margin: 0 }}>{editingEvent ? 'Edit Entry' : 'Add Entry'}</h3>
                                        <button onClick={() => { setAddingEntry(false); setEditingEvent(null); setEntryForm(DEFAULT_FORMS.training); }} style={closeButtonStyle}>✕</button>
                                    </div>

                                    {/* Type tabs */}
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '1.25rem' }}>
                                        {editingEvent ? (
                                            <div style={{ fontSize: '0.75rem', background: '#1e3a8a', color: '#fff', padding: '4px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                                                Editing {ENTRY_TYPE_META[editingEvent.type].icon} {ENTRY_TYPE_META[editingEvent.type].label}
                                                <button onClick={() => { setEditingEvent(null); setAddingEntry(false); }} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', textDecoration: 'underline', fontSize: '0.7rem' }}>Cancel Edit</button>
                                            </div>
                                        ) : (
                                            (Object.keys(ENTRY_TYPE_META) as EntryType[]).map(t => (
                                                <button
                                                    key={t}
                                                    onClick={() => {
                                                        setEntryType(t);
                                                        if (t === 'training') {
                                                            const placements = deck.map(slot => {
                                                                const card = cards.find(c => c.id === slot.id);
                                                                return card ? (CARD_TYPE_TO_FACILITY[card.card_type] ?? -1) : -1;
                                                            });
                                                            setEntryForm({ ...DEFAULT_FORMS.training, card_placements: placements });
                                                        } else {
                                                            setEntryForm(DEFAULT_FORMS[t]);
                                                        }
                                                        setTurnResult(null);
                                                    }}
                                                    style={{ padding: '0.3rem 0.65rem', borderRadius: 6, border: `1px solid ${entryType === t ? ENTRY_TYPE_META[t].color : '#333'}`, background: entryType === t ? ENTRY_TYPE_META[t].color + '22' : 'transparent', color: entryType === t ? ENTRY_TYPE_META[t].color : 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer' }}
                                                >
                                                    {ENTRY_TYPE_META[t].icon} {ENTRY_TYPE_META[t].label}
                                                </button>
                                            ))
                                        )}
                                    </div>

                                    {/* Dynamic form */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                        {/* TRAINING */}
                                        {entryType === 'training' && (
                                            <>
                                                <div>
                                                    <label style={miniLabelStyle}>Facility</label>
                                                    <div style={{ display: 'flex', gap: '6px' }}>
                                                        {STAT_NAMES.map((s, i) => (
                                                            <button key={s} onClick={() => {
                                                                const placements = entryForm.card_placements || Array(6).fill(-1);
                                                                setEntryForm({ ...entryForm, facility: i, friendship_deltas: friendshipDeltasForFacility(i, placements) });
                                                            }} style={{ flex: 1, padding: '0.4rem 0', borderRadius: 6, border: `1px solid ${entryForm.facility === i ? '#3b82f6' : '#333'}`, background: entryForm.facility === i ? '#1e3a8a' : 'transparent', color: entryForm.facility === i ? '#60a5fa' : 'var(--text-muted)', fontSize: '0.7rem', cursor: 'pointer' }}>{s.slice(0,3)}</button>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Card Placement & Friendship</label>
                                                    {deck.map((slot, i) => {
                                                        if (slot.id === 0) return null;
                                                        const pl = entryForm.card_placements?.[i] ?? -1;
                                                        const placementColors = ['#3b82f6','#22c55e','#f97316','#ef4444','#a855f7'];
                                                        const cardInfo = cards.find(c => c.id === slot.id);
                                                        const nativeFacility = cardInfo ? (CARD_TYPE_TO_FACILITY[cardInfo.card_type] ?? -1) : -1;
                                                        return (
                                                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '28px 16px 1fr 70px 54px', gap: '5px', alignItems: 'center', padding: '3px 5px', marginTop: 3, background: '#111', borderRadius: 6, border: `1px solid ${pl >= 0 ? placementColors[pl] : '#222'}` }}>
                                                                <img src={getCardIconUrl(slot.id)} alt="" style={{ width: 22, height: 22, borderRadius: 4 }} />
                                                                <img src={getTypeIconUrl(cardInfo?.card_type ?? '')} alt={cardInfo?.card_type ?? ''} title={nativeFacility >= 0 ? STAT_NAMES[nativeFacility] : cardInfo?.card_type ?? ''} style={{ width: 14, height: 14, opacity: 0.75 }} />
                                                                <select value={pl} onChange={e => { const np = [...(entryForm.card_placements || Array(6).fill(-1))]; np[i] = parseInt(e.target.value); const nd = [...(entryForm.friendship_deltas || Array(6).fill(0))]; nd[i] = np[i] === entryForm.facility ? 7 : 0; setEntryForm({ ...entryForm, card_placements: np, friendship_deltas: nd }); }} style={{ ...inputStyle, padding: '0.15rem', fontSize: '0.7rem' }}>
                                                                    <option value={-1}>Away</option>
                                                                    {STAT_NAMES.map((s, si) => <option key={s} value={si}>{s}</option>)}
                                                                </select>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>+/−</span>
                                                                    <input type="number" value={entryForm.friendship_deltas?.[i] ?? 0} onChange={e => { const nd = [...(entryForm.friendship_deltas || Array(6).fill(0))]; nd[i] = parseInt(e.target.value) || 0; setFormField('friendship_deltas', nd); }} style={{ ...inputStyle, padding: '0.15rem', textAlign: 'center', fontSize: '0.7rem' }} />
                                                                </div>
                                                                <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', textAlign: 'right' }}>~{(currentState?.friendship[i] ?? 0) + (entryForm.friendship_deltas?.[i] ?? 0)}</div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Stat Gains</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                                                        {STAT_NAMES.map(s => {
                                                            const key = s.toLowerCase() as keyof StatBlock;
                                                            return (
                                                                <div key={s}>
                                                                    <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                                                    <input type="number" value={entryForm.stat_gains?.[key] ?? 0} onChange={e => setFormField('stat_gains', { ...entryForm.stat_gains, [key]: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, padding: '0.3rem' }} />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                                    <div>
                                                        <label style={miniLabelStyle}>Energy Change</label>
                                                        <input type="number" value={entryForm.energy_change ?? 0} onChange={e => setFormField('energy_change', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={miniLabelStyle}>SP Gain</label>
                                                        <input type="number" value={entryForm.sp_gain ?? 0} onChange={e => setFormField('sp_gain', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                </div>
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
                                                                const maxLevel = cardMaxHintLevel[i];
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
                                            </>
                                        )}

                                        {/* EVENT */}
                                        {entryType === 'event' && (
                                            <>
                                                <div>
                                                    <label style={miniLabelStyle}>Event Name</label>
                                                    <input type="text" value={entryForm.label ?? ''} onChange={e => setFormField('label', e.target.value)} placeholder="e.g. Gold Ship Intro" style={inputStyle} />
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem' }}>
                                                    <div>
                                                        <label style={miniLabelStyle}>SP Change</label>
                                                        <input type="number" value={entryForm.sp_change ?? 0} onChange={e => setFormField('sp_change', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={miniLabelStyle}>Energy Change</label>
                                                        <input type="number" value={entryForm.energy_change ?? 0} onChange={e => setFormField('energy_change', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={miniLabelStyle}>Mood Change</label>
                                                        <input type="number" value={entryForm.mood_change ?? 0} onChange={e => setFormField('mood_change', parseInt(e.target.value) || 0)} style={inputStyle} min={-4} max={4} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Stat Changes (optional)</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                                                        {STAT_NAMES.map(s => {
                                                            const key = s.toLowerCase() as keyof StatBlock;
                                                            return (
                                                                <div key={s}>
                                                                    <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                                                    <input type="number" value={entryForm.stat_changes?.[key] ?? 0} onChange={e => setFormField('stat_changes', { ...entryForm.stat_changes, [key]: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, padding: '0.3rem' }} />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                                                    <input type="checkbox" checked={entryForm.save_to_db ?? false} onChange={e => setFormField('save_to_db', e.target.checked)} />
                                                    Save as reusable scenario event
                                                </label>
                                            </>
                                        )}

                                        {/* HINT */}
                                        {entryType === 'hint' && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {(entryForm.skills || []).map((s: { skill_id: number | null; levels: number }, i: number) => (
                                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 30px', gap: '6px', alignItems: 'end' }}>
                                                        <div>
                                                            {i === 0 && <label style={miniLabelStyle}>Skill</label>}
                                                            <SearchableSelect
                                                                options={skillOptions}
                                                                value={s.skill_id}
                                                                onChange={val => {
                                                                    const ns = [...entryForm.skills];
                                                                    ns[i] = { ...ns[i], skill_id: typeof val === 'string' ? parseInt(val) : val };
                                                                    setFormField('skills', ns);
                                                                }}
                                                                placeholder="Select skill"
                                                            />
                                                        </div>
                                                        <div>
                                                            {i === 0 && <label style={miniLabelStyle}>Levels</label>}
                                                            <select value={s.levels} onChange={e => { const ns = [...entryForm.skills]; ns[i] = { ...ns[i], levels: parseInt(e.target.value) }; setFormField('skills', ns); }} style={inputStyle}>
                                                                {[1,2,3].map(l => <option key={l} value={l}>Lv+{l}</option>)}
                                                            </select>
                                                        </div>
                                                        {i > 0 && (
                                                            <button onClick={() => setFormField('skills', entryForm.skills.filter((_: unknown, j: number) => j !== i))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button onClick={() => setFormField('skills', [...entryForm.skills, { skill_id: null, levels: 1 }])} style={{ padding: '0.4rem', border: '1px dashed #444', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', borderRadius: 6, fontSize: '0.75rem' }}>
                                                    + Add skill
                                                </button>
                                            </div>
                                        )}

                                        {/* APTITUDE */}
                                        {entryType === 'aptitude' && (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.75rem', alignItems: 'end' }}>
                                                <div>
                                                    <label style={miniLabelStyle}>Aptitude</label>
                                                    <SearchableSelect
                                                        options={APT_KEYS.map(a => ({ id: a.key, label: `${a.label} (${a.group})` }))}
                                                        value={entryForm.name || null}
                                                        onChange={val => setFormField('name', val)}
                                                        placeholder="Select aptitude"
                                                    />
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Grade</label>
                                                    <select value={entryForm.grade ?? 'A'} onChange={e => setFormField('grade', e.target.value)} style={inputStyle}>
                                                        {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                                                    </select>
                                                </div>
                                            </div>
                                        )}

                                        {/* INSPIRATION */}
                                        {entryType === 'inspiration' && (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                <div>
                                                    <label style={miniLabelStyle}>Stat Gains</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                                                        {STAT_NAMES.map(s => {
                                                            const key = s.toLowerCase() as keyof StatBlock;
                                                            return (
                                                                <div key={s}>
                                                                    <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                                                    <input type="number" value={entryForm.stat_gains?.[key] ?? 0} onChange={e => setFormField('stat_gains', { ...entryForm.stat_gains, [key]: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, padding: '0.3rem' }} />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Aptitude Upgrades</label>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        {(entryForm.aptitude_changes as { name: string; grade: string }[]).map((ac, i) => (
                                                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 28px', gap: '6px', alignItems: 'end' }}>
                                                                <SearchableSelect
                                                                    options={APT_KEYS.map(a => ({ id: a.key, label: `${a.label} (${a.group})` }))}
                                                                    value={ac.name || null}
                                                                    onChange={val => { const ns = [...entryForm.aptitude_changes]; ns[i] = { ...ns[i], name: String(val ?? '') }; setFormField('aptitude_changes', ns); }}
                                                                    placeholder="Aptitude"
                                                                />
                                                                <select value={ac.grade} onChange={e => { const ns = [...entryForm.aptitude_changes]; ns[i] = { ...ns[i], grade: e.target.value }; setFormField('aptitude_changes', ns); }} style={inputStyle}>
                                                                    {GRADES.map(g => <option key={g} value={g}>{g}</option>)}
                                                                </select>
                                                                <button onClick={() => setFormField('aptitude_changes', (entryForm.aptitude_changes as { name: string; grade: string }[]).filter((_: unknown, j: number) => j !== i))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                                                            </div>
                                                        ))}
                                                        <button onClick={() => setFormField('aptitude_changes', [...entryForm.aptitude_changes, { name: '', grade: 'A' }])} style={{ padding: '0.4rem', border: '1px dashed #444', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', borderRadius: 6, fontSize: '0.75rem' }}>
                                                            + Add aptitude upgrade
                                                        </button>
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Skill Hints</label>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        {(entryForm.hints as { skill_id: number | null; levels: number }[]).map((h, i) => (
                                                            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 70px 28px', gap: '6px', alignItems: 'end' }}>
                                                                <SearchableSelect
                                                                    options={skillOptions}
                                                                    value={h.skill_id}
                                                                    onChange={val => { const ns = [...entryForm.hints]; ns[i] = { ...ns[i], skill_id: typeof val === 'string' ? parseInt(val) : val }; setFormField('hints', ns); }}
                                                                    placeholder="Select skill"
                                                                />
                                                                <select value={h.levels} onChange={e => { const ns = [...entryForm.hints]; ns[i] = { ...ns[i], levels: parseInt(e.target.value) }; setFormField('hints', ns); }} style={inputStyle}>
                                                                    {[1,2,3].map(l => <option key={l} value={l}>Lv+{l}</option>)}
                                                                </select>
                                                                <button onClick={() => setFormField('hints', (entryForm.hints as { skill_id: number | null; levels: number }[]).filter((_: unknown, j: number) => j !== i))} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                                                            </div>
                                                        ))}
                                                        <button onClick={() => setFormField('hints', [...entryForm.hints, { skill_id: null, levels: 1 }])} style={{ padding: '0.4rem', border: '1px dashed #444', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', borderRadius: 6, fontSize: '0.75rem' }}>
                                                            + Add hint
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* RACE */}
                                        {entryType === 'race' && (
                                            <>
                                                <div>
                                                    <label style={miniLabelStyle}>Race</label>
                                                    <SearchableSelect
                                                        options={races.map(r => ({ id: r, label: r }))}
                                                        value={entryForm.race_name || null}
                                                        onChange={val => setFormField('race_name', val)}
                                                        placeholder="Select race"
                                                    />
                                                </div>
                                                <div>
                                                    <label style={miniLabelStyle}>Stat Gains</label>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                                                        {STAT_NAMES.map(s => {
                                                            const key = s.toLowerCase() as keyof StatBlock;
                                                            return (
                                                                <div key={s}>
                                                                    <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                                                    <input type="number" value={entryForm.stat_gains?.[key] ?? 0} onChange={e => setFormField('stat_gains', { ...entryForm.stat_gains, [key]: parseInt(e.target.value) || 0 })} style={{ ...inputStyle, padding: '0.3rem' }} />
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                                    <div>
                                                        <label style={miniLabelStyle}>SP Gain</label>
                                                        <input type="number" value={entryForm.sp_gain ?? 0} onChange={e => setFormField('sp_gain', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                    <div>
                                                        <label style={miniLabelStyle}>Energy Change</label>
                                                        <input type="number" value={entryForm.energy_change ?? 0} onChange={e => setFormField('energy_change', parseInt(e.target.value) || 0)} style={inputStyle} />
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        {/* REST / INFIRMARY / RECREATION */}
                                        {['rest','infirmary','recreation'].includes(entryType) && (
                                            <div>
                                                <label style={miniLabelStyle}>Energy Change</label>
                                                <input type="number" value={entryForm.energy_change ?? 0} onChange={e => setFormField('energy_change', parseInt(e.target.value) || 0)} style={inputStyle} />
                                            </div>
                                        )}
                                    </div>

                                    <div style={{ display: 'flex', gap: '8px', marginTop: '1rem' }}>
                                        <button
                                            onClick={editingEvent ? handleUpdateEntry : handleAddEntry}
                                            disabled={submittingEntry}
                                            style={{ ...primaryButtonStyle, flex: 1, background: ENTRY_TYPE_META[entryType].color }}
                                        >
                                            {submittingEntry ? 'Saving...' : editingEvent ? `Update ${ENTRY_TYPE_META[entryType].label}` : `Log ${ENTRY_TYPE_META[entryType].label}`}
                                        </button>
                                        {editingEvent && (
                                            <button
                                                onClick={() => {
                                                    if (confirm('Delete this entry?')) {
                                                        handleDeleteEntry(editingEvent.id, editingEvent.sequence);
                                                        setEditingEvent(null);
                                                        setAddingEntry(false);
                                                    }
                                                }}
                                                style={{ ...primaryButtonStyle, width: 'auto', padding: '0 1rem', background: '#ef4444' }}
                                            >
                                                ✕
                                            </button>
                                        )}
                                    </div>
                                </>
                            )}
                        </section>

                        {/* Timeline */}
                        <section style={sectionStyle}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ ...sectionHeaderStyle, margin: 0 }}>Timeline ({timelineEvents.length} entries)</h3>
                                {timelineEvents.length > 0 && (
                                    <button 
                                        onClick={async () => {
                                            if (confirm('Clear all events in this run?')) {
                                                await Promise.all(timelineEvents.map(e => supabase.from('training_run_events').delete().eq('id', e.id)));
                                                await loadTimelineEvents();
                                            }
                                        }}
                                        style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '0.7rem', cursor: 'pointer', textDecoration: 'underline' }}
                                    >Clear All</button>
                                )}
                            </div>

                            {timelineEvents.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '2rem', border: '1px dashed #333', borderRadius: 12 }}>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>No events recorded yet.</p>
                                    <button 
                                        onClick={handleRestoreInitialInspiration}
                                        disabled={submittingEntry}
                                        style={{ ...primaryButtonStyle, width: 'auto', padding: '0.5rem 1rem', fontSize: '0.75rem', background: '#374151' }}
                                    >
                                        Restore Initial Inspiration
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: 500, overflowY: 'auto', paddingRight: 4 }}>
                                    {[...timelineEvents].reverse().map(event => {
                                        const meta = ENTRY_TYPE_META[event.type];
                                        const p = event.payload;
                                        let summary = '';
                                        if (event.type === 'training') summary = `${STAT_NAMES[p.facility ?? 0]} · ${Object.values(p.stat_gains || {}).some((v: unknown) => (v as number) !== 0) ? '+' + STAT_NAMES.map(s => (p.stat_gains?.[s.toLowerCase()] || 0)).filter(Boolean).join('/') + ' stats' : ''} ${p.energy_change || 0}E ${p.sp_gain ? `+${p.sp_gain}SP` : ''}`.trim();
                                        else if (event.type === 'event') summary = `${p.label || '(unnamed)'} · ${p.sp_change > 0 ? '+' : ''}${p.sp_change || 0}SP`;
                                        else if (event.type === 'hint') summary = (p.skills || []).map((s: { skill_id: number; levels: number }) => `${skills.find(sk => sk.id === s.skill_id)?.name ?? `#${s.skill_id}`} Lv+${s.levels}`).join(', ');
                                        else if (event.type === 'aptitude') { const label = APT_KEYS.find(a => a.key === p.name)?.label ?? p.name; summary = `${label} → ${p.grade ?? '?'}`; }
                                        else if (event.type === 'inspiration') {
                                            const statParts = STAT_NAMES.filter(s => (p.stat_gains?.[s.toLowerCase()] || 0) > 0).map(s => `+${p.stat_gains[s.toLowerCase()]} ${s.slice(0,3)}`);
                                            const aptParts = (p.aptitude_changes || []).map((ac: { name: string; grade: string }) => `${APT_KEYS.find(a => a.key === ac.name)?.label ?? ac.name}→${ac.grade}`);
                                            const hintParts = (p.hints || []).map((h: { skill_id: number; levels: number }) => `${skills.find(sk => sk.id === h.skill_id)?.name ?? `#${h.skill_id}`} Lv+${h.levels}`);
                                            summary = [...statParts, ...aptParts, ...hintParts].join(', ') || '(no changes)';
                                        }
                                        else if (event.type === 'race') summary = p.race_name || '';
                                        else summary = `${p.energy_change > 0 ? '+' : ''}${p.energy_change || 0}E`;

                                        const isExpanded = expandedEventId === event.id;

                                        return (
                                            <div key={event.id} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                <div 
                                                    onClick={() => setExpandedEventId(isExpanded ? null : event.id)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 0.75rem', background: '#111', borderRadius: 8, border: `1px solid ${meta.color}22`, cursor: 'pointer' }}
                                                >
                                                    <span style={{ fontSize: '1rem', flexShrink: 0 }}>{meta.icon}</span>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: meta.color }}>{meta.label}</span>
                                                        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginLeft: 8 }}>{summary}</span>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setEditingEvent(event);
                                                                setEntryType(event.type);
                                                                setEntryForm(event.payload);
                                                                setAddingEntry(true);
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: '0.7rem' }}
                                                            title="Edit entry"
                                                        >Edit</button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteEntry(event.id, event.sequence);
                                                            }}
                                                            style={{ background: 'none', border: 'none', color: '#4b5563', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0 }}
                                                            title="Delete entry"
                                                        >✕</button>
                                                    </div>
                                                </div>
                                                {isExpanded && (
                                                    <div style={{ marginLeft: '2.5rem', padding: '0.5rem', background: '#0a0a0a', borderRadius: 6, border: '1px solid #222', fontSize: '0.7rem' }}>
                                                        {event.type === 'event' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                <div style={{ color: '#fff', fontWeight: 600 }}>{p.label}</div>
                                                                <div style={{ display: 'flex', gap: 8, color: 'var(--text-muted)' }}>
                                                                    <span>SP: {p.sp_change > 0 ? '+' : ''}{p.sp_change}</span>
                                                                    <span>Energy: {p.energy_change > 0 ? '+' : ''}{p.energy_change}</span>
                                                                    <span>Mood: {['😞','😟','😐','🙂','😄'][currentState?.mood ?? 2]} ({p.mood_change > 0 ? '+' : ''}{p.mood_change})</span>
                                                                </div>
                                                                {p.stat_changes && Object.values(p.stat_changes).some(v => v !== 0) && (
                                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                                        {STAT_NAMES.map(s => {
                                                                            const val = p.stat_changes[s.toLowerCase()];
                                                                            if (!val) return null;
                                                                            return <span key={s} style={{ color: '#4ade80' }}>+{val} {s.slice(0,3)}</span>;
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {event.type === 'training' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                <div style={{ color: '#fff', fontWeight: 600 }}>{STAT_NAMES[p.facility]} Training</div>
                                                                <div style={{ display: 'flex', gap: 8, color: 'var(--text-muted)' }}>
                                                                    <span>SP: +{p.sp_gain}</span>
                                                                    <span>Energy: {p.energy_change}</span>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: 8 }}>
                                                                    {STAT_NAMES.map(s => {
                                                                        const val = p.stat_gains?.[s.toLowerCase()];
                                                                        if (!val) return null;
                                                                        return <span key={s} style={{ color: '#4ade80' }}>+{val} {s.slice(0,3)}</span>;
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {event.type === 'inspiration' && (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                                                <div style={{ color: '#fff', fontWeight: 600 }}>Spark of Inspiration</div>
                                                                {p.stat_gains && (
                                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                                        {STAT_NAMES.map(s => {
                                                                            const val = p.stat_gains[s.toLowerCase()];
                                                                            if (!val) return null;
                                                                            return <span key={s} style={{ color: '#4ade80' }}>+{val} {s.slice(0,3)}</span>;
                                                                        })}
                                                                    </div>
                                                                )}
                                                                {p.hints && p.hints.length > 0 && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                                                        {p.hints.map((h: { skill_id: number; levels: number }, i: number) => (
                                                                            <span key={i} style={{ background: '#1a2e1a', color: '#4ade80', padding: '1px 4px', borderRadius: 4 }}>
                                                                                {skills.find(sk => sk.id === h.skill_id)?.name ?? `#${h.skill_id}`} Lv+{h.levels}
                                                                            </span>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        <div style={{ marginTop: 4, fontSize: '0.65rem', color: '#444' }}>Turn {event.sequence + 1}</div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>
                )}
            </div>

      {editingMember && (
          <div style={modalOverlayStyle}>
              <div style={modalStyle}>
                  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h2 style={{ margin: 0, color: '#fff' }}>Edit {legacies[editingMember].name}</h2>
                      <button onClick={() => setEditingMember(null)} style={closeButtonStyle}>✕</button>
                  </header>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
                      {legacies[editingMember].factors.map((f, idx) => {
                          let borderColor = '#333';
                          let glowColor = 'transparent';
                          if (f.type === 'BlueStat') { borderColor = '#2563eb'; glowColor = 'rgba(37, 99, 235, 0.1)'; }
                          if (f.type === 'Aptitude') { borderColor = '#ec4899'; glowColor = 'rgba(236, 72, 153, 0.1)'; }
                          if (f.type === 'UniqueSkill') { borderColor = '#22c55e'; glowColor = 'rgba(34, 197, 94, 0.1)'; }

                          return (
                              <div key={idx} style={{
                                  padding: '0.75rem',
                                  background: '#111',
                                  borderRadius: 8,
                                  border: `1px solid ${borderColor}`,
                                  boxShadow: `inset 0 0 10px ${glowColor}`,
                                  display: 'grid',
                                  gridTemplateColumns: '120px 1fr 65px 80px',
                                  gap: '0.5rem',
                                  alignItems: 'end'
                              }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                      <label style={miniLabelStyle}>Type</label>
                                      <select value={f.type} onChange={e => updateFactor(editingMember, idx, { type: e.target.value as Factor['type'] })} style={inputStyle}>
                                          {FACTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                      </select>
                                  </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <label style={miniLabelStyle}>Value</label>
                                  {f.type === 'BlueStat' && (
                                      <select value={f.stat_index} onChange={e => updateFactor(editingMember, idx, { stat_index: parseInt(e.target.value) })} style={inputStyle}>
                                          {STAT_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
                                      </select>
                                  )}
                                  {(f.type === 'SkillHint' || f.type === 'UniqueSkill') && (
                                      <SearchableSelect
                                          options={skillOptions}
                                          value={f.skill_id || null}
                                          onChange={val => {
                                              const id = typeof val === 'string' ? parseInt(val) : (val ?? undefined);
                                              updateFactor(editingMember, idx, { skill_id: id as number | undefined });
                                          }}
                                          placeholder="Select Skill"
                                      />
                                  )}
                                  {f.type === 'RaceBonus' && (
                                      <SearchableSelect
                                          options={races.map(r => ({ id: r, label: r }))}
                                          value={f.race_name || null}
                                          onChange={val => updateFactor(editingMember, idx, { race_name: val as string })}
                                          placeholder="Select Race"
                                      />
                                  )}
                                  {f.type === 'Aptitude' && (
                                      <SearchableSelect
                                          options={APT_KEYS.map(a => ({ id: a.key, label: `${a.label} (${a.group})` }))}
                                          value={f.apt_name || null}
                                          onChange={val => updateFactor(editingMember, idx, { apt_name: val as string })}
                                          placeholder="Select Aptitude"
                                      />
                                  )}
                                  {f.type === 'Scenario' && (
                                      <SearchableSelect
                                          options={scenarios.map(s => ({ id: s, label: s }))}
                                          value={f.name || null}
                                          onChange={val => updateFactor(editingMember, idx, { name: val as string })}
                                          placeholder="Select Scenario"
                                      />
                                  )}
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <label style={miniLabelStyle}>Stars</label>
                                  <select value={f.stars} onChange={e => updateFactor(editingMember, idx, { stars: parseInt(e.target.value) })} style={inputStyle}>
                                      {[1,2,3].map(s => <option key={s} value={s}>{s}★</option>)}
                                  </select>
                              </div>

                              <div style={{ display: 'flex', gap: '4px' }}>
                                  <button
                                      onClick={() => duplicateFactor(editingMember, idx)}
                                      title="Duplicate"
                                      style={{ background: '#1e3a8a', color: '#60a5fa', border: '1px solid #1e40af', padding: '0.5rem', borderRadius: 6, flex: 1 }}
                                  >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                  </button>
                                  <button
                                      onClick={() => removeFactor(editingMember, idx)}
                                      title="Remove"
                                      style={{ background: '#450a0a', color: '#f87171', border: '1px solid #7f1d1d', padding: '0.5rem', borderRadius: 6, flex: 1 }}
                                  >✕</button>
                              </div>
                          </div>
                      );
                  })}

                      <button onClick={() => addFactor(editingMember)} style={{ padding: '0.75rem', border: '1px dashed #444', background: 'transparent', color: '#a1a1aa', cursor: 'pointer', borderRadius: 8 }}>
                          + Add Factor (Spark)
                      </button>
                  </div>

                  <div style={{ marginTop: '2rem', display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={() => setEditingMember(null)} style={{ ...primaryButtonStyle, width: 'auto' }}>Done Editing</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}

function MemberButton({ label, memberKey, legacies, onClick }: { label: string, memberKey: string, legacies: Record<string, LegacyMember>, onClick: (key: string) => void }) {
    const member = legacies[memberKey];
    const factorCount = member ? member.factors.length : 0;
    return (
        <button onClick={() => onClick(memberKey)} style={{
            padding: '1rem', background: '#111', border: '1px solid #333', borderRadius: 8,
            textAlign: 'left', cursor: 'pointer', transition: 'border-color 0.2s'
        }} onMouseEnter={e => e.currentTarget.style.borderColor = '#444'} onMouseLeave={e => e.currentTarget.style.borderColor = '#333'}>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>{label}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 4 }}>{factorCount} factor(s)</div>
        </button>
    );
}

const sectionStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, padding: '1.5rem'
};

const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '1.25rem'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.6rem', borderRadius: 8, border: '1px solid #333', background: '#0a0a0a', color: '#fff', fontSize: '0.875rem'
};

const miniLabelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 2
};

const primaryButtonStyle: React.CSSProperties = {
    padding: '0.85rem 1.5rem', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer', width: '100%'
};

const disabledButtonStyle: React.CSSProperties = {
    ...primaryButtonStyle, background: '#1e3a8a', cursor: 'not-allowed', color: '#94a3b8'
};

const legacySlotStyle: React.CSSProperties = {
    padding: '1rem', background: '#111', borderRadius: 12, border: '1px solid #222'
};

const modalOverlayStyle: React.CSSProperties = {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
};

const modalStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 16, width: '100%', maxWidth: 700, padding: '2rem', boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
};

const closeButtonStyle: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: '1.25rem', cursor: 'pointer'
};

const modeButtonStyle: React.CSSProperties = {
    padding: '0.5rem 1rem', borderRadius: '8px', border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
};
