import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
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
}

interface CardBasic {
  id: number;
  name: string;
  rarity: string;
  card_type: string;
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

interface ComparisonResult {
  actual: StatBlock;
  expected: StatBlock;
}

interface RunState {
    turn: number;
    stats: StatBlock;
    energy: number;
    mood: number;
    friendship: number[];
    facility_levels: number[];
    facility_trains: number[];
    skill_points: number;
}

interface TurnResult {
    state: RunState;
    expected_gains: StatBlock[];
    expected_energy_costs: number[];
    failure_rates: number[];
}

const STAT_NAMES = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'];
const FACTOR_TYPES = ['BlueStat', 'UniqueSkill', 'SkillHint', 'RaceBonus', 'Aptitude', 'Scenario'];

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

export default function RunComparison() {
  const [mode, setMode] = useState<'simulation' | 'tracker'>('simulation');
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [cards, setCards] = useState<CardBasic[]>([]);
  const [skills, setSkills] = useState<{id: number, name: string, icon_url?: string}[]>([]);
  
  // Input State
  const [selectedTrainee, setSelectedTrainee] = useState<number | null>(null);
  const [starRank, setStarRank] = useState(3);
  const [awakeningLevel, setAwakeningLevel] = useState(5);
  const [deck, setDeck] = useState<{ id: number; level: number }[]>(Array(6).fill({ id: 0, level: 50 }));
  const [actualStats, setActualStats] = useState<StatBlock>({ speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 });

  // Tracker State
  const [runState, setRunState] = useState<RunState>({
      turn: 0,
      stats: { speed: 0, stamina: 0, power: 0, guts: 0, wisdom: 0 },
      energy: 100,
      mood: 3,
      friendship: Array(6).fill(0),
      facility_levels: Array(5).fill(1),
      facility_trains: Array(5).fill(0),
      skill_points: 120
  });
  const [turnResult, setTurnResult] = useState<TurnResult | null>(null);

  // Legacy Tree
  // legacy_1 (Parent, G1, G2), legacy_2 (Parent, G3, G4)
  const [legacies, setLegacies] = useState<{
    l1p: LegacyMember, l1g1: LegacyMember, l1g2: LegacyMember,
    l2p: LegacyMember, l2g3: LegacyMember, l2g4: LegacyMember
  }>({
    l1p: { name: 'Parent 1', factors: [] },
    l1g1: { name: 'GP 1', factors: [] },
    l1g2: { name: 'GP 2', factors: [] },
    l2p: { name: 'Parent 2', factors: [] },
    l2g3: { name: 'GP 3', factors: [] },
    l2g4: { name: 'GP 4', factors: [] },
  });

  const [editingMember, setEditingMember] = useState<keyof typeof legacies | null>(null);
  
  // Results
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('trainees').select('id, name, title, icon_path').order('name').then(({ data }) => data && setTrainees(data as Trainee[]));
    supabase.from('support_cards').select('id, name, rarity, card_type').then(({ data }) => data && setCards(data as CardBasic[]));
    supabase.from('skills').select('gametora_id, name, icon_url').order('name').then(({ data }) => {
        if (data) setSkills(data.map(s => ({ id: Number(s.gametora_id), name: s.name, icon_url: s.icon_url })));
    });
  }, []);

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

  const handleRunComparison = async () => {
    if (!selectedTrainee) return;
    setLoading(true);

    const deckParam = deck.filter(c => c.id !== 0).map(c => [c.id, c.level]);
    if (deckParam.length < 6) {
        alert("Please select 6 cards for the deck");
        setLoading(false);
        return;
    }

    const payload = {
        trainee_id: selectedTrainee,
        star_rank: starRank,
        algorithm: "monte_carlo_v2",
        config: {
            awakening_level: awakeningLevel,
            legacy: {
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
            }
        },
        deck: deckParam
    };

    try {
        const response = await fetch('http://localhost:3001/api/score', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        setResult({
            actual: actualStats,
            expected: data.projected_stats
        });
    } catch (err) {
        console.error(err);
        alert("Error fetching expected results");
    } finally {
        setLoading(false);
    }
  };

  const addFactor = (memberKey: keyof typeof legacies) => {
    const newLegacies = { ...legacies };
    newLegacies[memberKey].factors.push({ type: 'BlueStat', stat_index: 0, stars: 3 });
    setLegacies(newLegacies);
  };

  const updateFactor = (memberKey: keyof typeof legacies, factorIdx: number, updates: Partial<Factor>) => {
    const newLegacies = { ...legacies };
    newLegacies[memberKey].factors[factorIdx] = { ...newLegacies[memberKey].factors[factorIdx], ...updates };
    setLegacies(newLegacies);
  };

  const removeFactor = (memberKey: keyof typeof legacies, factorIdx: number) => {
    const newLegacies = { ...legacies };
    newLegacies[memberKey].factors.splice(factorIdx, 1);
    setLegacies(newLegacies);
  };

  const fetchTurnSimulation = async () => {
    if (!selectedTrainee) return;
    setLoading(true);
    const deckParam = deck.filter(c => c.id !== 0).map(c => [c.id, c.level]);
    
    const payload = {
        trainee_id: selectedTrainee,
        star_rank: starRank,
        algorithm: "monte_carlo_v2",
        config: {
            awakening_level: awakeningLevel,
            legacy: {
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
            }
        },
        deck: deckParam,
        state: runState
    };

    try {
        const response = await fetch('http://localhost:3001/api/simulate-turn', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        setTurnResult(data);
    } catch (err) {
        console.error(err);
        alert("Error simulating turn");
    } finally {
        setLoading(false);
    }
  };

  const updateRunState = (updates: Partial<RunState>) => {
      setRunState(prev => ({ ...prev, ...updates }));
  };

  return (
    <div style={{ padding: '4rem 1.5rem 2rem', maxWidth: 1200, margin: '0 auto', minHeight: '100vh' }}>
      <div style={{ paddingBottom: '2rem', borderBottom: '1px solid #222', marginBottom: '2rem' }}>
        <Link to="/umamusume" className="back" style={{ display: 'inline-block', marginBottom: '1rem', position: 'relative' }}>&larr; back</Link>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: mode === 'simulation' ? 'repeat(auto-fit, minmax(350px, 1fr))' : '1fr', gap: '2rem' }}>
        {mode === 'simulation' ? (
            <>
            {/* LEFT COLUMN: TRAINEE & DECK & STATS */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                <section style={sectionStyle}>
                    <h3 style={sectionHeaderStyle}>1. Trainee Configuration</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: '1rem' }}>
                        <SearchableSelect 
                            options={traineeOptions}
                            value={selectedTrainee}
                            onChange={setSelectedTrainee}
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
                                        const newDeck = [...deck];
                                        newDeck[i] = { ...newDeck[i], id: val };
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

                <section style={sectionStyle}>
                    <h3 style={sectionHeaderStyle}>3. Final Results</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
                        {STAT_NAMES.map(s => (
                            <div key={s}>
                                <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                <input 
                                    type="number" 
                                    value={(actualStats as any)[s.toLowerCase()]} 
                                    onChange={e => setActualStats({ ...actualStats, [s.toLowerCase()]: parseInt(e.target.value) || 0 })}
                                    style={inputStyle}
                                />
                            </div>
                        ))}
                    </div>
                </section>

                <button 
                    onClick={handleRunComparison} 
                    disabled={loading || !selectedTrainee} 
                    style={loading ? disabledButtonStyle : primaryButtonStyle}
                >
                    {loading ? "Simulating..." : "Calculate Projections"}
                </button>
            </div>

            {/* RIGHT COLUMN: LEGACY TREE */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <section style={{ ...sectionStyle, border: '1px solid #333' }}>
                    <h3 style={sectionHeaderStyle}>4. Legacy Inheritance</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Click a member to edit their sparks/factors.</p>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        {/* Legacy 1 */}
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

                        {/* Legacy 2 */}
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

                {result && (
                    <div style={resultsBoxStyle}>
                        <h2 style={{ fontSize: '1.1rem', marginBottom: '1.5rem', fontWeight: 600 }}>Comparison</h2>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid #333', textAlign: 'left' }}>
                                    <th style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Stat</th>
                                    <th style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Actual</th>
                                    <th style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Exp.</th>
                                    <th style={{ padding: '0.5rem 0', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Diff</th>
                                </tr>
                            </thead>
                            <tbody>
                                {STAT_NAMES.map(s => {
                                    const key = s.toLowerCase() as keyof StatBlock;
                                    const actual = result.actual[key];
                                    const expected = Math.round((result.expected as any)[key]);
                                    const diff = actual - expected;
                                    const diffColor = diff > 0 ? '#4ade80' : diff < 0 ? '#f87171' : '#fff';
                                    return (
                                        <tr key={s} style={{ borderBottom: '1px solid #222' }}>
                                            <td style={{ padding: '0.75rem 0', fontWeight: 500 }}>{s}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{actual}</td>
                                            <td style={{ padding: '0.75rem 0' }}>{expected}</td>
                                            <td style={{ padding: '0.75rem 0', color: diffColor, fontWeight: 600 }}>
                                                {diff > 0 ? `+${diff}` : diff}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            </>
        ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '350px 1fr', gap: '2rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <section style={sectionStyle}>
                        <h3 style={sectionHeaderStyle}>Run Status (Turn {runState.turn})</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}>
                                {STAT_NAMES.map(s => (
                                    <div key={s}>
                                        <label style={miniLabelStyle}>{s.slice(0,3)}</label>
                                        <input 
                                            type="number" 
                                            value={(runState.stats as any)[s.toLowerCase()]} 
                                            onChange={e => updateRunState({ stats: { ...runState.stats, [s.toLowerCase()]: parseInt(e.target.value) || 0 }})}
                                            style={{ ...inputStyle, padding: '0.4rem' }}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={miniLabelStyle}>Energy</label>
                                    <input type="number" value={runState.energy} onChange={e => updateRunState({ energy: parseInt(e.target.value) || 0 })} style={inputStyle} />
                                </div>
                                <div>
                                    <label style={miniLabelStyle}>Mood</label>
                                    <select value={runState.mood} onChange={e => updateRunState({ mood: parseInt(e.target.value) })} style={inputStyle}>
                                        <option value={4}>Very Good</option>
                                        <option value={3}>Good</option>
                                        <option value={2}>Normal</option>
                                        <option value={1}>Bad</option>
                                        <option value={0}>Very Bad</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label style={miniLabelStyle}>Friendship Gauges</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                                    {deck.map((slot, i) => (
                                        <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                                            {slot.id !== 0 && <img src={getCardIconUrl(slot.id)} alt="" style={{ width: 24, height: 24, borderRadius: 4 }} />}
                                            <input 
                                                type="number" 
                                                value={runState.friendship[i]} 
                                                onChange={e => {
                                                    const nf = [...runState.friendship];
                                                    nf[i] = parseInt(e.target.value) || 0;
                                                    updateRunState({ friendship: nf });
                                                }}
                                                style={{ ...inputStyle, padding: '0.2rem', textAlign: 'center', fontSize: '0.7rem' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <button onClick={fetchTurnSimulation} disabled={loading || !selectedTrainee} style={primaryButtonStyle}>
                                {loading ? 'Calculating...' : 'Simulate Next Turn'}
                            </button>
                        </div>
                    </section>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {turnResult && (
                        <section style={sectionStyle}>
                            <h3 style={sectionHeaderStyle}>Expected Outcomes (Turn {runState.turn})</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                                {STAT_NAMES.map((name, idx) => (
                                    <div key={name} style={{ background: '#111', padding: '1rem', borderRadius: 8, border: '1px solid #222' }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <img src={getTypeIconUrl(name)} alt="" style={{ width: 16, height: 16 }} />
                                            {name}
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div style={{ fontSize: '1.2rem', color: '#4ade80', fontWeight: 700 }}>
                                                +{(turnResult.expected_gains[idx] as any)[name.toLowerCase()].toFixed(1)}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                                Cost: {Math.abs(turnResult.expected_energy_costs[idx]).toFixed(1)} E
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: turnResult.failure_rates[idx] > 0.1 ? '#f87171' : 'var(--text-muted)' }}>
                                                Fail Rate: {(turnResult.failure_rates[idx] * 100).toFixed(1)}%
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div style={{ marginTop: '2rem', textAlign: 'right' }}>
                                <button 
                                    onClick={() => updateRunState({ turn: runState.turn + 1 })}
                                    style={{ ...primaryButtonStyle, width: 'auto', background: '#333', border: '1px solid #444' }}
                                >
                                    Log & Next Turn →
                                </button>
                            </div>
                        </section>
                    )}
                </div>
            </div>
        )}
      </div>

      {/* LEGACY EDITOR MODAL */}
      {editingMember && (
          <div style={modalOverlayStyle}>
              <div style={modalStyle}>
                  <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                      <h2 style={{ margin: 0, color: '#fff' }}>Edit {legacies[editingMember].name}</h2>
                      <button onClick={() => setEditingMember(null)} style={closeButtonStyle}>✕</button>
                  </header>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxHeight: '60vh', overflowY: 'auto', paddingRight: '0.5rem' }}>
                      {legacies[editingMember].factors.map((f, idx) => (
                          <div key={idx} style={{ padding: '1rem', background: '#111', borderRadius: 8, border: '1px solid #333', display: 'grid', gridTemplateColumns: '1fr 1fr 60px 40px', gap: '0.5rem', alignItems: 'end' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <label style={miniLabelStyle}>Type</label>
                                  <select value={f.type} onChange={e => updateFactor(editingMember, idx, { type: e.target.value as any })} style={inputStyle}>
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
                                          onChange={val => updateFactor(editingMember, idx, { skill_id: val })}
                                          placeholder="Select Skill"
                                      />
                                  )}
                                  {f.type === 'RaceBonus' && (
                                      <input type="text" placeholder="Race Name" value={f.race_name || ''} onChange={e => updateFactor(editingMember, idx, { race_name: e.target.value })} style={inputStyle} />
                                  )}
                                  {f.type === 'Aptitude' && (
                                      <input type="text" placeholder="Turf/Long/etc" value={f.apt_name || ''} onChange={e => updateFactor(editingMember, idx, { apt_name: e.target.value })} style={inputStyle} />
                                  )}
                                  {f.type === 'Scenario' && (
                                      <input type="text" placeholder="Scenario Name" value={f.name || ''} onChange={e => updateFactor(editingMember, idx, { name: e.target.value })} style={inputStyle} />
                                  )}
                              </div>

                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  <label style={miniLabelStyle}>Stars</label>
                                  <select value={f.stars} onChange={e => updateFactor(editingMember, idx, { stars: parseInt(e.target.value) })} style={inputStyle}>
                                      {[1,2,3].map(s => <option key={s} value={s}>{s}★</option>)}
                                  </select>
                              </div>

                              <button onClick={() => removeFactor(editingMember, idx)} style={{ background: '#450a0a', color: '#f87171', border: '1px solid #7f1d1d', padding: '0.5rem', borderRadius: 6 }}>✕</button>
                          </div>
                      ))}

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

function MemberButton({ label, memberKey, legacies, onClick }: { label: string, memberKey: keyof typeof RunComparison.prototype.legacies, legacies: any, onClick: any }) {
    const factorCount = legacies[memberKey].factors.length;
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

const resultsBoxStyle: React.CSSProperties = {
    background: '#1a1a1a', border: '1px solid #2563eb', borderRadius: 12, padding: '2rem'
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
