import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// ─── Types ──────────────────────────────────────────────────────────────────

interface StatBlock {
  speed: number;
  stamina: number;
  power: number;
  guts: number;
  wisdom: number;
  sp: number;
}

interface CardLocationState {
  speed: number[];
  stamina: number[];
  power: number[];
  guts: number[];
  wisdom: number[];
  other: number[];
}

interface Turn {
  turn_number: number;
  energy_before: number;
  card_locations: CardLocationState;
  action_taken: string;
  stat_gains: Omit<StatBlock, 'sp'>;
  sp_gain: number;
  energy_change: number;
  friendship_gains: Record<string, number>;
}

interface RunData {
  id?: string;
  run_name: string;
  trainee_id: number;
  star_rank: number;
  deck: { card_id: number; level: number }[];
  initial_sp: number;
  inherited_stats: Omit<StatBlock, 'sp'>;
  final_stats: StatBlock;
  created_at?: string;
}

interface Trainee {
  id: number;
  name: string;
  title: string | null;
  stat_growth: number[] | null;
  stats_base: number[] | null;
  stats_two_star: number[] | null;
  stats_three_star: number[] | null;
  stats_four_star: number[] | null;
  stats_five_star: number[] | null;
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

interface TraineeCollectionEntry {
  trainee_id: number;
  star_rank: number;
  awakening_level: number;
}

interface OwnedCardEntry {
  card_id: number;
  level: number;
  uncap: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'] as const;
const FACILITY_NAMES = ['speed', 'stamina', 'power', 'guts', 'wisdom'] as const;
const ACTIONS = [
    'train_speed', 'train_stamina', 'train_power', 'train_guts', 'train_wisdom',
    'rest', 'race', 'event'
] as const;

type StatName = typeof STAT_NAMES[number];
type StatKey = Lowercase<StatName>;

// ─── Component ──────────────────────────────────────────────────────────────

export default function RunAnalyzer() {
  const { user } = useAuth();
  const [view, setView] = useState<'history' | 'setup' | 'active_run'>('history');
  
  // Data
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [cards, setCards] = useState<CardBasic[]>([]);
  const [userTrainees, setUserTrainees] = useState<Map<number, TraineeCollectionEntry>>(new Map());
  const [userCards, setUserCards] = useState<Map<number, OwnedCardEntry>>(new Map());
  const [savedRuns, setSavedRuns] = useState<RunData[]>([]);

  // Setup State
  const [selectedTrainee, setSelectedTrainee] = useState<number | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<{ card_id: number; level: number }[]>([]);
  const [runName, setRunName] = useState("");
  const [inheritedStats, setInheritedStats] = useState<Omit<StatBlock, 'sp'>>({ speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });
  const [initialSp, setInitialSp] = useState(120);

  // Active Run State
  const [currentRun, setCurrentRun] = useState<RunData | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [currentStats, setCurrentStats] = useState<StatBlock>({ speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0, sp: 0 });
  const [currentEnergy, setCurrentEnergy] = useState(100);
  const [friendship, setFriendship] = useState<Record<number, number>>({});

  // ─── Load Data ──────────────────────────────────────────────────────────

  const loadHistory = React.useCallback(async () => {
    const { data } = await supabase.from('training_runs').select('*').order('created_at', { ascending: false });
    if (data) setSavedRuns(data as RunData[]);
  }, []);
  
  useEffect(() => {
    supabase.from('trainees')
      .select('id, name, title, stat_growth, stats_base, stats_two_star, stats_three_star, stats_four_star, stats_five_star')
      .order('name')
      .then(({ data }) => { if (data) setTrainees(data as Trainee[]) });

    supabase.from('support_cards').select('id, name, rarity, card_type, effects:support_card_effects(*)')
      .then(({ data }) => { if (data) setCards(data as CardBasic[]) });
  }, []);

  useEffect(() => {
    if (user) {
        supabase.from('user_trainee_collection').select('trainee_id, star_rank, awakening_level').eq('user_id', user.id)
            .then(({ data }) => {
                const m = new Map<number, TraineeCollectionEntry>();
                if (data) data.forEach(d => m.set(d.trainee_id, d as TraineeCollectionEntry));
                setUserTrainees(m);
            });

        supabase.from('user_support_card_collection').select('card_id, level, uncap').eq('user_id', user.id)
            .then(({ data }) => {
                const m = new Map<number, OwnedCardEntry>();
                if (data) data.forEach(d => m.set(d.card_id, d as OwnedCardEntry));
                setUserCards(m);
            });
    }
  }, [user]);

  useEffect(() => {
    if (user) {
        supabase.from('training_runs').select('*').order('created_at', { ascending: false })
            .then(({ data }) => { if (data) setSavedRuns(data as RunData[]) });
    }
  }, [user]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  const getStartingStats = (trainee: Trainee, starRank: number): Omit<StatBlock, 'sp'> => {
    const statsArray = [
        trainee.stats_base,
        trainee.stats_two_star,
        trainee.stats_three_star,
        trainee.stats_four_star,
        trainee.stats_five_star
    ][starRank - 1] || trainee.stats_base || [0,0,0,0,0];

    return {
        speed: statsArray[0] || 0,
        stamina: statsArray[1] || 0,
        power: statsArray[2] || 0,
        guts: statsArray[3] || 0,
        wisdom: statsArray[4] || 0
    };
  };

  const startNewRun = () => {
    if (!selectedTrainee) return;
    const traineeCollection = userTrainees.get(selectedTrainee);
    const traineeInfo = trainees.find(t => t.id === selectedTrainee);
    if (!traineeInfo) return;
    
    const starRank = traineeCollection?.star_rank || 3;
    const baseStats = getStartingStats(traineeInfo, starRank);
    
    const initialStats = {
        speed: baseStats.speed + inheritedStats.speed,
        stamina: baseStats.stamina + inheritedStats.stamina,
        power: baseStats.power + inheritedStats.power,
        guts: baseStats.guts + inheritedStats.guts,
        wisdom: baseStats.wisdom + inheritedStats.wisdom,
        sp: initialSp
    };
    
    setCurrentRun({
        run_name: runName || `Run with ${traineeInfo.name}`,
        trainee_id: selectedTrainee,
        star_rank: starRank,
        deck: selectedDeck,
        initial_sp: initialSp,
        inherited_stats: inheritedStats,
        final_stats: initialStats
    });
    setCurrentStats(initialStats);
    setCurrentEnergy(100);
    setTurns([]);
    
    const initialFriendship: Record<number, number> = {};
    selectedDeck.forEach(c => initialFriendship[c.card_id] = 0);
    setFriendship(initialFriendship);
    
    setView('active_run');
  };

  const commitTurn = (turn: Turn) => {
    setTurns([...turns, turn]);
    
    const newStats = { ...currentStats };
    (Object.keys(turn.stat_gains) as (keyof Omit<StatBlock, 'sp'>)[]).forEach(k => {
        newStats[k] += turn.stat_gains[k];
    });
    newStats.sp += turn.sp_gain;

    setCurrentStats(newStats);
    setCurrentEnergy(Math.min(100, Math.max(0, turn.energy_before + turn.energy_change)));
    
    const newFriendship = { ...friendship };
    Object.entries(turn.friendship_gains).forEach(([id, gain]) => {
        newFriendship[parseInt(id)] = Math.min(100, (newFriendship[parseInt(id)] || 0) + gain);
    });
    setFriendship(newFriendship);
  };

  const saveRunToDb = async () => {
    if (!currentRun || !user) return;
    
    const runToSave = {
        ...currentRun,
        user_id: user.id,
        final_stats: currentStats
    };
    
    const { data: runData, error: runError } = await supabase.from('training_runs').insert(runToSave).select().single();
    
    if (runError) {
        alert("Error saving run: " + runError.message);
        return;
    }
    
    const turnsToSave = turns.map(t => ({
        run_id: runData.id,
        ...t
    }));
    
    const { error: turnError } = await supabase.from('training_run_turns').insert(turnsToSave);
    
    if (turnError) {
        alert("Error saving turns: " + turnError.message);
    } else {
        alert("Run saved successfully!");
        setView('history');
        loadHistory();
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <header style={{ position: 'fixed', top: 0, left: 0, padding: '1.5rem 2rem', zIndex: 10 }}>
        <Link to="/umamusume" className="back">&larr; back</Link>
      </header>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>Training Run Analyzer</h1>
        <div style={{ display: 'flex', gap: '1rem' }}>
            <button onClick={() => setView('history')} style={view === 'history' ? activeTabStyle : tabStyle}>History</button>
            <button onClick={() => setView('setup')} style={view === 'setup' ? activeTabStyle : tabStyle}>New Run</button>
        </div>
      </div>

      {view === 'history' && <HistoryView savedRuns={savedRuns} trainees={trainees} />}
      {view === 'setup' && (
          <SetupView 
            trainees={trainees} 
            userTrainees={userTrainees} 
            userCards={userCards}
            cards={cards}
            onStart={startNewRun}
            selectedTrainee={selectedTrainee}
            setSelectedTrainee={setSelectedTrainee}
            selectedDeck={selectedDeck}
            setSelectedDeck={setSelectedDeck}
            runName={runName}
            setRunName={setRunName}
            inheritedStats={inheritedStats}
            setInheritedStats={setInheritedStats}
            initialSp={initialSp}
            setInitialSp={setInitialSp}
          />
      )}
      {view === 'active_run' && currentRun && (
          <ActiveRunView 
            run={currentRun}
            stats={currentStats}
            energy={currentEnergy}
            friendship={friendship}
            turns={turns}
            trainees={trainees}
            cards={cards}
            onCommitTurn={commitTurn}
            onSave={saveRunToDb}
          />
      )}
    </div>
  );
}

// ─── Sub-views ─────────────────────────────────────────────────────────────

function HistoryView({ savedRuns, trainees }: { savedRuns: RunData[], trainees: Trainee[] }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {savedRuns.length === 0 && <p>No saved runs yet.</p>}
            {savedRuns.map(run => {
                const trainee = trainees.find(t => t.id === run.trainee_id);
                return (
                    <div key={run.id} style={cardStyle}>
                        <div style={{ fontWeight: 600 }}>{run.run_name}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {trainee?.name} · {new Date(run.created_at!).toLocaleDateString()}
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                            {[...STAT_NAMES, 'SP'].map((s) => (
                                <div key={s} style={{ fontSize: '0.75rem' }}>
                                    {s[0]}: {run.final_stats[s.toLowerCase() as keyof StatBlock]}
                                </div>
                            ))}
                        </div>
                    </div>
                )
            })}
        </div>
    );
}

interface SetupViewProps {
    trainees: Trainee[];
    userTrainees: Map<number, TraineeCollectionEntry>;
    userCards: Map<number, OwnedCardEntry>;
    cards: CardBasic[];
    onStart: () => void;
    selectedTrainee: number | null;
    setSelectedTrainee: (id: number | null) => void;
    selectedDeck: { card_id: number; level: number }[];
    setSelectedDeck: (deck: { card_id: number; level: number }[]) => void;
    runName: string;
    setRunName: (name: string) => void;
    inheritedStats: Omit<StatBlock, 'sp'>;
    setInheritedStats: (stats: Omit<StatBlock, 'sp'>) => void;
    initialSp: number;
    setInitialSp: (sp: number) => void;
}

function SetupView({ trainees, userTrainees, userCards, cards, onStart, selectedTrainee, setSelectedTrainee, selectedDeck, setSelectedDeck, runName, setRunName, inheritedStats, setInheritedStats, initialSp, setInitialSp }: SetupViewProps) {
    const ownedTrainees = trainees.filter((t) => userTrainees.has(t.id));
    
    const handleCardChange = (index: number, cardId: number) => {
        const newDeck = [...selectedDeck];
        const ownedCard = userCards.get(cardId);
        newDeck[index] = { 
            card_id: cardId, 
            level: ownedCard ? ownedCard.level : 50 
        };
        setSelectedDeck(newDeck);
    };

    const handleLevelChange = (index: number, level: number) => {
        const newDeck = [...selectedDeck];
        if (newDeck[index]) {
            newDeck[index] = { ...newDeck[index], level };
            setSelectedDeck(newDeck);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <Section title="Basic Info">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label style={labelStyle}>Run Name</label>
                                <input type="text" value={runName} onChange={e => setRunName(e.target.value)} placeholder="My training session..." style={inputStyle} />
                            </div>
                            <div>
                                <label style={labelStyle}>Select Trainee</label>
                                <select value={selectedTrainee || ""} onChange={e => setSelectedTrainee(parseInt(e.target.value))} style={inputStyle}>
                                    <option value="">-- Select --</option>
                                    {ownedTrainees.map((t) => {
                                        const col = userTrainees.get(t.id);
                                        return (
                                            <option key={t.id} value={t.id}>
                                                {t.title ? `[${t.title}] ` : ''}{t.name} ({col?.star_rank}★)
                                            </option>
                                        );
                                    })}
                                </select>
                            </div>
                        </div>
                    </Section>

                    <Section title="Inheritance (Starting Event)">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                            {STAT_NAMES.map(s => (
                                <div key={s}>
                                    <label style={{ fontSize: '0.7rem' }}>{s}</label>
                                    <input 
                                        type="number" 
                                        value={inheritedStats[s.toLowerCase() as StatKey]} 
                                        onChange={e => setInheritedStats({ ...inheritedStats, [s.toLowerCase()]: parseInt(e.target.value) || 0 })}
                                        style={inputStyle} 
                                    />
                                </div>
                            ))}
                            <div>
                                <label style={{ fontSize: '0.7rem' }}>Skill Pts</label>
                                <input 
                                    type="number" 
                                    value={initialSp} 
                                    onChange={e => setInitialSp(parseInt(e.target.value) || 0)}
                                    style={inputStyle} 
                                />
                            </div>
                        </div>
                    </Section>
                </div>

                <Section title="Support Deck (6 cards)">
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1, 1fr)', gap: '0.75rem' }}>
                        {[0,1,2,3,4,5].map(i => {
                            const isFriendSlot = i === 5;
                            const availableCards = isFriendSlot ? cards : cards.filter((c) => userCards.has(c.id));
                            return (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 80px', gap: '0.5rem', alignItems: 'center' }}>
                                    <select 
                                        value={selectedDeck[i]?.card_id || ""} 
                                        onChange={e => handleCardChange(i, parseInt(e.target.value))}
                                        style={inputStyle}
                                    >
                                        <option value="">-- {isFriendSlot ? "Friend Slot" : `Slot ${i + 1}`} --</option>
                                        {availableCards.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                                            <option key={c.id} value={c.id}>[{c.rarity}] {c.name} ({c.card_type})</option>
                                        ))}
                                    </select>
                                    <input 
                                        type="number" 
                                        value={selectedDeck[i]?.level || ""} 
                                        onChange={e => handleLevelChange(i, parseInt(e.target.value))}
                                        placeholder="Lv"
                                        style={inputStyle}
                                        min={1} max={50}
                                    />
                                </div>
                            );
                        })}
                    </div>
                </Section>
            </div>
            <button onClick={onStart} disabled={!selectedTrainee || selectedDeck.length < 6} style={primaryButtonStyle}>Start Run</button>
        </div>
    );
}

interface ActiveRunViewProps {
    run: RunData;
    stats: StatBlock;
    energy: number;
    friendship: Record<number, number>;
    turns: Turn[];
    trainees: Trainee[];
    cards: CardBasic[];
    onCommitTurn: (turn: Turn) => void;
    onSave: () => void;
}

function ActiveRunView({ run, stats, energy, friendship, turns, trainees, cards, onCommitTurn, onSave }: ActiveRunViewProps) {
    const [entry, setEntry] = useState<Turn>({
        turn_number: turns.length + 1,
        energy_before: energy,
        card_locations: { speed: [], stamina: [], power: [], guts: [], wisdom: [], other: [] },
        action_taken: 'train_speed',
        stat_gains: { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 },
        sp_gain: 0,
        energy_change: -20,
        friendship_gains: {}
    });

    const [prediction, setPrediction] = useState<{ choice: string, gain: StatBlock } | null>(null);

    const handlePredict = () => {
        const trainee = trainees.find((t) => t.id === run.trainee_id);
        const cardMap = new Map(cards.map((c) => [c.id, c]));
        const deckCards = run.deck.map((c) => cardMap.get(c.card_id)).filter((c): c is CardBasic => !!c);

        if (!trainee) return;

        let bestFacility = 'rest';
        let maxWeightedGain = -1.0;
        let bestGain: StatBlock = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0, sp: 0 };

        const simState = { energy, friendship };

        for (let i = 0; i < 5; i++) {
            const gain = calculatePotentialGain(i, entry.card_locations, deckCards, run.deck, simState, trainee);
            const stat_weights = [1.0, 1.0, 1.0, 0.8, 0.8];
            const weightedGain = (Object.values(gain) as number[]).reduce((sum, val, idx) => sum + (val * stat_weights[idx]), 0);

            if (weightedGain > maxWeightedGain) {
                maxWeightedGain = weightedGain;
                bestFacility = ACTIONS[i];
                bestGain = { ...gain, sp: 0 };
            }
        }
        setPrediction({ choice: bestFacility, gain: bestGain });
    };

    const handleCommit = () => {
        onCommitTurn({ ...entry, turn_number: turns.length + 1, energy_before: energy });
        setEntry({
            turn_number: turns.length + 2,
            energy_before: energy, 
            card_locations: { speed: [], stamina: [], power: [], guts: [], wisdom: [], other: [] },
            action_taken: 'train_speed',
            stat_gains: { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 },
            sp_gain: 0,
            energy_change: -20,
            friendship_gains: {}
        });
        setPrediction(null);
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '2rem' }}>
            <div>
                <Section title="Current Status">
                    <div style={statusBoxStyle}>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: energy < 30 ? '#f87171' : '#fff' }}>Energy: {energy}%</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '1rem' }}>
                            {[...STAT_NAMES, 'SP'].map(s => (
                                <div key={s}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{s}</div>
                                    <div style={{ fontWeight: 600 }}>{stats[s.toLowerCase() as keyof StatBlock]}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </Section>
                
                <Section title="Deck & Friendship">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {run.deck.map((c) => {
                            const card = cards.find((card) => card.id === c.card_id);
                            const fs = friendship[c.card_id] || 0;
                            return (
                                <div key={c.card_id} style={{ fontSize: '0.8rem', background: '#1a1a1a', padding: '0.5rem', borderRadius: 4 }}>
                                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card?.name}</div>
                                    <div style={{ height: 4, width: '100%', background: '#333', marginTop: 4, borderRadius: 2 }}>
                                        <div style={{ height: '100%', width: `${fs}%`, background: fs >= 80 ? '#fbbf24' : '#60a5fa', borderRadius: 2 }} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Section>

                <button onClick={onSave} style={{ ...primaryButtonStyle, marginTop: '1rem', background: '#16a34a' }}>Save & Finish Run</button>
            </div>

            <div>
                <Section title={`Turn ${turns.length + 1} Entry`}>
                    <div style={entryBoxStyle}>
                        <div style={{ marginBottom: '1.5rem' }}>
                            <label style={labelStyle}>Card Locations</label>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                                {run.deck.map((c) => {
                                    const card = cards.find((card) => card.id === c.card_id);
                                    return (
                                        <div key={c.card_id}>
                                            <div style={{ fontSize: '0.75rem', marginBottom: 4 }}>{card?.name}</div>
                                            <select 
                                                value={Object.entries(entry.card_locations).find(([, ids]) => ids.includes(c.card_id))?.[0] || "other"}
                                                onChange={e => {
                                                    const loc = e.target.value as keyof CardLocationState;
                                                    const newLocations = { ...entry.card_locations };
                                                    Object.keys(newLocations).forEach(k => {
                                                        const key = k as keyof CardLocationState;
                                                        newLocations[key] = newLocations[key].filter((id: number) => id !== c.card_id);
                                                    });
                                                    newLocations[loc].push(c.card_id);
                                                    setEntry({ ...entry, card_locations: newLocations });
                                                }}
                                                style={inputStyle}
                                            >
                                                {FACILITY_NAMES.map(f => <option key={f} value={f}>{f}</option>)}
                                                <option value="other">Rest/Other</option>
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                            <div>
                                <label style={labelStyle}>Action Taken</label>
                                <select value={entry.action_taken} onChange={e => setEntry({ ...entry, action_taken: e.target.value })} style={inputStyle}>
                                    {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>

                                <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
                                    <div>
                                        <label style={labelStyle}>Energy Change</label>
                                        <input type="number" value={entry.energy_change} onChange={e => setEntry({ ...entry, energy_change: parseInt(e.target.value) || 0 })} style={inputStyle} />
                                    </div>
                                    <div>
                                        <label style={labelStyle}>SP Gain</label>
                                        <input type="number" value={entry.sp_gain} onChange={e => setEntry({ ...entry, sp_gain: parseInt(e.target.value) || 0 })} style={inputStyle} />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label style={labelStyle}>Stat Gains</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    {STAT_NAMES.map(s => (
                                        <div key={s}>
                                            <label style={{ fontSize: '0.7rem' }}>{s}</label>
                                            <input 
                                                type="number" 
                                                value={entry.stat_gains[s.toLowerCase() as keyof Omit<StatBlock, 'sp'>]} 
                                                onChange={e => {
                                                    const newGains = { ...entry.stat_gains };
                                                    const key = s.toLowerCase() as keyof Omit<StatBlock, 'sp'>;
                                                    newGains[key] = parseInt(e.target.value) || 0;
                                                    setEntry({ ...entry, stat_gains: newGains });
                                                }} 
                                                style={inputStyle} 
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem' }}>
                            <button onClick={handlePredict} style={secondaryButtonStyle}>Simulate Decision</button>
                            <button onClick={handleCommit} style={primaryButtonStyle}>Commit Turn</button>
                        </div>

                        {prediction && (
                            <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(37,99,235,0.1)', border: '1px solid #2563eb', borderRadius: 8 }}>
                                <div style={{ fontWeight: 600, color: '#60a5fa' }}>Algorithm Recommendation: {prediction.choice}</div>
                                <div style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
                                    Predicted Gains: {STAT_NAMES.map(s => `${s[0]}: ${Math.round(prediction.gain[s.toLowerCase() as keyof StatBlock])}`).join(' ')}
                                </div>
                            </div>
                        )}
                    </div>
                </Section>

                <Section title="Turn History">
                    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: '0.5rem' }}>
                        {turns.map((t: Turn) => (
                            <div key={t.turn_number} style={{ fontSize: '0.8rem', padding: '0.5rem', background: '#111', border: '1px solid #222', borderRadius: 4, display: 'flex', justifyContent: 'space-between' }}>
                                <span>Turn {t.turn_number}: {t.action_taken}</span>
                                <span style={{ color: 'var(--text-muted)' }}>
                                    {[...STAT_NAMES.filter(s => t.stat_gains[s.toLowerCase() as keyof Omit<StatBlock, 'sp'>] > 0).map(s => `+${t.stat_gains[s.toLowerCase() as keyof Omit<StatBlock, 'sp'>]} ${s[0]}`), t.sp_gain > 0 ? `+${t.sp_gain} SP` : null].filter(Boolean).join(', ')}
                                </span>
                            </div>
                        ))}
                    </div>
                </Section>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: '2rem' }}>
            <h3 style={sectionHeaderStyle}>{title}</h3>
            {children}
        </div>
    );
}

// --- Logic Helpers ---

const BASE_PRIMARY = [11.0, 11.0, 11.0, 11.0, 11.0];
const BASE_SECONDARY = 5.0;
const FRIENDSHIP_THRESHOLD = 80.0;

function facilityLayout(facility: number): [number, number[]] {
    switch (facility) {
        case 0: return [0, [2]];
        case 1: return [1, [3]];
        case 2: return [2, [1]];
        case 3: return [3, [2]];
        case 4: return [4, [0]];
        default: return [0, []];
    }
}

function getCardEffectValue(card: CardBasic, effectId: number, level: number): number {
    const effect = card.effects.find(e => e.effect_type_id === effectId);
    if (!effect || level < effect.unlock_level) return 0;
    const idx = Math.max(0, level - 1);
    return effect.values_by_level[Math.min(idx, effect.values_by_level.length - 1)] ?? 0;
}

interface DeckCardConfig {
    card_id: number;
    level: number;
}

function calculatePotentialGain(
    facilityIdx: number,
    cardLocations: CardLocationState,
    deckCards: CardBasic[],
    deckConfig: DeckCardConfig[],
    simState: { energy: number; friendship: Record<number, number> },
    trainee: Trainee,
): Omit<StatBlock, 'sp'> {
    const gains: Omit<StatBlock, 'sp'> = { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 };
    const [primaryStat, secondaryStats] = facilityLayout(facilityIdx);
    
    const facilityName = FACILITY_NAMES[facilityIdx];
    const presentCardIds = cardLocations[facilityName];
    
    let totalTrainingEffectiveness = 0;
    let friendshipProduct = 1.0;
    const totalStatBonuses = [0, 0, 0, 0, 0];

    for (const cardId of presentCardIds) {
        const card = deckCards.find(c => c.id === cardId);
        const cardConfig = deckConfig.find(c => c.card_id === cardId);
        if (!card || !cardConfig) continue;

        const level = cardConfig.level;
        totalTrainingEffectiveness += getCardEffectValue(card, 8, level) / 100;

        if ((simState.friendship[cardId] ?? 0) >= FRIENDSHIP_THRESHOLD) {
            friendshipProduct *= 1.0 + (getCardEffectValue(card, 1, level) / 100);
        }

        for (let i = 0; i < 5; i++) {
            totalStatBonuses[i] += getCardEffectValue(card, 3 + i, level);
        }
    }

    const moodMultiplier = 1.20;
    const trainingEffMultiplier = 1.0 + totalTrainingEffectiveness;
    const presence_bonus = 1.0 + 0.05 * presentCardIds.length;
    
    const growthRate = (trainee.stat_growth?.[primaryStat] ?? 0) / 100.0;
    const primaryBase = BASE_PRIMARY[primaryStat] + totalStatBonuses[primaryStat];
    const primaryKey = STAT_NAMES[primaryStat].toLowerCase() as keyof Omit<StatBlock, 'sp'>;
    gains[primaryKey] = primaryBase
        * moodMultiplier * trainingEffMultiplier * friendshipProduct * presence_bonus * (1.0 + growthRate);

    for (const secStat of secondaryStats) {
        const secGrowthRate = (trainee.stat_growth?.[secStat] ?? 0) / 100.0;
        const secBase = BASE_SECONDARY + totalStatBonuses[secStat];
        const secKey = STAT_NAMES[secStat].toLowerCase() as keyof Omit<StatBlock, 'sp'>;
        gains[secKey] = secBase
            * moodMultiplier * trainingEffMultiplier * friendshipProduct * presence_bonus * (1.0 + secGrowthRate);
    }
    
    return gains;
}

// --- Styles ---

const activeTabStyle: React.CSSProperties = {
    background: '#2563eb', color: '#fff', border: 'none', padding: '0.5rem 1rem', borderRadius: 20, cursor: 'pointer', fontSize: '0.8rem'
};

const tabStyle: React.CSSProperties = {
    background: '#1a1a1a', color: '#fff', border: '1px solid #333', padding: '0.5rem 1rem', borderRadius: 20, cursor: 'pointer', fontSize: '0.8rem'
};

const cardStyle: React.CSSProperties = {
    background: '#111', border: '1px solid #222', borderRadius: 8, padding: '1rem'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #333', background: '#111', color: '#fff', fontSize: '0.875rem'
};

const primaryButtonStyle: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontWeight: 600, cursor: 'pointer'
};

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em'
};

const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '0.8rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', borderBottom: '1px solid #333', paddingBottom: '0.25rem'
};

const statusBoxStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '1rem'
};

const entryBoxStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, padding: '1.5rem'
};
