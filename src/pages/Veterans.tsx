import React, { useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Trainee {
  id: number;
  name: string;
  title: string | null;
  image_path: string | null;
  icon_path: string | null;
}

interface Spark {
  name: string;
  stars: number;
}

interface SparkData {
  blue: Spark | null;
  pink: Spark | null;
  green: Spark | null;
  white: Spark[];
}

interface Veteran {
  id: string;
  trainee_id: number;
  parent1_id?: string;
  parent2_id?: string;
  spark_data: SparkData;
  g1_races: string[];
  is_friend: boolean;
  created_at: string;
  trainee?: Trainee;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SUPABASE_STORAGE = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/umamusume`;

const BLUE_SPARK_OPTIONS = ['Speed', 'Stamina', 'Power', 'Guts', 'Wisdom'];
const PINK_SPARK_OPTIONS = ['Turf', 'Dirt', 'Short', 'Mile', 'Medium', 'Long', 'Runner', 'Leader', 'Betweener', 'Chaser'];
const G1_RACES = [
  "Arima Kinen", "Asahi Hai Futurity Stakes", "Champions Cup", "February Stakes",
  "Hanshin Juvenile Fillies", "Hopeful Stakes", "JBC Classic", "JBC Ladies' Classic",
  "JBC Sprint", "Japan Cup", "Japan Dirt Derby", "Kawasaki Kinen", "Kikuka Sho",
  "Mile Championship", "NHK Mile Cup", "Oka Sho", "Osaka Hai", "Queen Elizabeth II Cup",
  "Satsuki Sho", "Shuka Sho", "Sprinters Stakes", "Takamatsunomiya Kinen",
  "Takarazuka Kinen", "Teio Sho", "Tenno Sho (Autumn)", "Tenno Sho (Spring)",
  "Tokyo Daishoten", "Tokyo Yushun (Japanese Derby)", "Victoria Mile",
  "Yasuda Kinen", "Yushun Himba (Japanese Oaks)"
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPortraitUrl(path: string | null, id: number) {
  return `${SUPABASE_STORAGE}/${path ?? `trainees/art/${id}.png`}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Veterans() {
  const { user } = useAuth();
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [veterans, setVeterans] = useState<Veteran[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVeteran, setSelectedVeteran] = useState<Veteran | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingVeteran, setEditingVeteran] = useState<Veteran | null>(null);
  const [cardSize, setCardSize] = useState(160);

  useEffect(() => {
    const root = document.getElementById('root')
    if (root) { root.style.maxWidth = 'none'; root.style.padding = '0' }
    return () => {
      if (root) { root.style.maxWidth = ''; root.style.padding = '' }
    }
  }, [])

  useEffect(() => {
    async function loadData() {
      if (!user) return;
      setLoading(true);

      const [vRes, tRes] = await Promise.all([
        supabase
          .from('veterans')
          .select('*, trainee:trainees(name, title, image_path, icon_path)')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('trainees')
          .select('id, name, title')
          .order('name')
      ]);

      if (vRes.data) setVeterans(vRes.data as Veteran[]);
      if (tRes.data) setTrainees(tRes.data as Trainee[]);
      setLoading(false);
    }
    loadData();
  }, [user]);

  const refresh = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('veterans')
      .select('*, trainee:trainees(name, title, image_path, icon_path)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setVeterans(data as Veteran[]);
  };

  if (!user) {
    return <div style={{ padding: '4rem', textAlign: 'center' }}>Please log in to manage your veterans.</div>;
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f13', color: '#fff', fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'rgba(15,15,19,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid #222',
      }}>
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/umamusume" style={{ color: '#aaa', textDecoration: 'none', fontSize: 13 }}>← Home</Link>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Legacy Veterans</h1>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
              <span style={{ fontSize: 10, color: '#444' }}>Size</span>
              <input
                type="range" min={100} max={240} value={cardSize}
                onChange={e => setCardSize(Number(e.target.value))}
                style={{ width: 70, accentColor: '#2563eb' }}
              />
            </div>
            <button
              onClick={() => setIsAdding(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '7px 14px', borderRadius: 8, border: 'none',
                background: '#2563eb',
                color: '#fff',
                cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.15s',
              }}
            >
              + Add Veteran
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {loading ? (
          <div style={{ color: '#444', textAlign: 'center', padding: '4rem' }}>Loading veterans…</div>
        ) : veterans.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: '#444', border: '1px dashed #222', borderRadius: 12 }}>
            No veterans saved yet. Click "Add Veteran" to record your first legacy unit!
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardSize}px, 100%), 1fr))`,
            gap: 8,
          }}>
            {veterans.map(v => (
              <VeteranCard key={v.id} veteran={v} onClick={() => setSelectedVeteran(v)} />
            ))}
          </div>
        )}
      </div>

      {selectedVeteran && (
        <VeteranModal 
          veteran={selectedVeteran} 
          onClose={() => setSelectedVeteran(null)} 
          onEdit={() => {
            setEditingVeteran(selectedVeteran);
            setSelectedVeteran(null);
          }}
        />
      )}

      {(isAdding || editingVeteran) && (
        <AddVeteranModal 
          trainees={trainees}
          veterans={veterans}
          initialData={editingVeteran}
          onClose={() => {
            setIsAdding(false);
            setEditingVeteran(null);
          }}
          onSave={() => { 
            setIsAdding(false); 
            setEditingVeteran(null);
            refresh(); 
          }}
        />
      )}
    </div>
  );
}

// ─── Add/Edit Veteran Modal ───────────────────────────────────────────────────

function AddVeteranModal({ trainees, veterans, initialData, onClose, onSave }: any) {
    const { user } = useAuth();
    const [form, setForm] = useState<Partial<Veteran>>({
        trainee_id: initialData?.trainee_id || undefined,
        parent1_id: initialData?.parent1_id || undefined,
        parent2_id: initialData?.parent2_id || undefined,
        spark_data: initialData?.spark_data || {
            blue: { name: 'Speed', stars: 3 },
            pink: { name: 'Turf', stars: 2 },
            green: { name: '', stars: 2 },
            white: []
        },
        g1_races: initialData?.g1_races || [],
        is_friend: initialData?.is_friend || false
    });

    const [newWhiteSpark, setNewWhiteSpark] = useState({ name: '', stars: 1 });

    const handleSave = async () => {
        if (!user || !form.trainee_id) return;
        
        // Clean up empty green spark if necessary
        const payload = { ...form };
        if (payload.spark_data?.green && !payload.spark_data.green.name.trim()) {
            payload.spark_data.green = null;
        }

        let error;
        if (initialData?.id) {
            const { error: updateError } = await supabase.from('veterans').update({
                ...payload
            }).eq('id', initialData.id);
            error = updateError;
        } else {
            const { error: insertError } = await supabase.from('veterans').insert({
                ...payload,
                user_id: user.id
            });
            error = insertError;
        }

        if (error) alert(error.message);
        else onSave();
    };

    const handleToggleRace = (race: string) => {
        setForm(prev => {
            const races = prev.g1_races || [];
            if (races.includes(race)) {
                return { ...prev, g1_races: races.filter(r => r !== race) };
            } else {
                return { ...prev, g1_races: [...races, race] };
            }
        });
    };

    const handleAddWhiteSpark = () => {
        if (!newWhiteSpark.name.trim()) return;
        setForm(prev => {
            const whites = prev.spark_data?.white || [];
            return {
                ...prev,
                spark_data: {
                    ...prev.spark_data!,
                    white: [...whites, newWhiteSpark]
                }
            };
        });
        setNewWhiteSpark({ name: '', stars: 1 });
    };

    const handleRemoveWhiteSpark = (index: number) => {
        setForm(prev => {
            const whites = [...(prev.spark_data?.white || [])];
            whites.splice(index, 1);
            return {
                ...prev,
                spark_data: {
                    ...prev.spark_data!,
                    white: whites
                }
            };
        });
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 110, padding: 16 }}>
            <div style={{ background: '#16161e', borderRadius: 16, width: '100%', maxWidth: 800, border: '1px solid #2a2a38', display: 'flex', flexDirection: 'column', maxHeight: '95vh', overflow: 'hidden' }}>
                <div style={{ padding: '1.5rem', borderBottom: '1px solid #222', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{initialData ? 'Edit Veteran' : 'Add New Veteran'}</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: '1.5rem' }}>×</button>
                </div>
                
                <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <Section title="Basic Info">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={labelStyle}>Trainee</label>
                                    <select 
                                        value={form.trainee_id || ""} 
                                        onChange={e => setForm({ ...form, trainee_id: parseInt(e.target.value) })}
                                        style={inputStyle}
                                    >
                                        <option value="">-- Select --</option>
                                        {trainees.map((t: any) => <option key={t.id} value={t.id}>[{t.title}] {t.name}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', marginTop: '0.5rem', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={form.is_friend || false}
                                            onChange={e => setForm({ ...form, is_friend: e.target.checked })}
                                        />
                                        This is a Friend's Veteran
                                    </label>
                                </div>
                            </div>
                        </Section>

                        <Section title="Parents (Inheritance)">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={labelStyle}>Parent 1</label>
                                    <select
                                        value={form.parent1_id || ""}
                                        onChange={e => setForm({ ...form, parent1_id: e.target.value || undefined })}
                                        style={inputStyle}
                                    >
                                        <option value="">-- None --</option>
                                        {veterans?.map((v: any) => {
                                            const b = v.spark_data?.blue;
                                            const s = b ? `[${b.name} ${b.stars}★]` : '';
                                            return <option key={v.id} value={v.id}>{s} {v.trainee?.name}</option>
                                        })}
                                    </select>
                                </div>
                                <div>
                                    <label style={labelStyle}>Parent 2</label>
                                    <select
                                        value={form.parent2_id || ""}
                                        onChange={e => setForm({ ...form, parent2_id: e.target.value || undefined })}
                                        style={inputStyle}
                                    >
                                        <option value="">-- None --</option>
                                        {veterans?.map((v: any) => {
                                            const b = v.spark_data?.blue;
                                            const s = b ? `[${b.name} ${b.stars}★]` : '';
                                            return <option key={v.id} value={v.id}>{s} {v.trainee?.name}</option>
                                        })}
                                    </select>
                                </div>
                            </div>
                        </Section>

                        <Section title="Sparks (Inheritance Traits)">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {/* Blue Spark */}
                                <div>
                                    <label style={labelStyle}>Blue Spark (Base Stat)</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <select 
                                            value={form.spark_data?.blue?.name || ""}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, blue: { ...form.spark_data!.blue!, name: e.target.value } } })}
                                            style={{ ...inputStyle, flex: 1 }}
                                        >
                                            {BLUE_SPARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                        <select 
                                            value={form.spark_data?.blue?.stars || 1}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, blue: { ...form.spark_data!.blue!, stars: parseInt(e.target.value) } } })}
                                            style={{ ...inputStyle, width: '80px' }}
                                        >
                                            <option value={1}>1★</option>
                                            <option value={2}>2★</option>
                                            <option value={3}>3★</option>
                                        </select>
                                    </div>
                                </div>
                                
                                {/* Pink Spark */}
                                <div>
                                    <label style={labelStyle}>Pink Spark (Aptitude)</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <select 
                                            value={form.spark_data?.pink?.name || ""}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, pink: { ...form.spark_data!.pink!, name: e.target.value } } })}
                                            style={{ ...inputStyle, flex: 1 }}
                                        >
                                            {PINK_SPARK_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                                        </select>
                                        <select 
                                            value={form.spark_data?.pink?.stars || 1}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, pink: { ...form.spark_data!.pink!, stars: parseInt(e.target.value) } } })}
                                            style={{ ...inputStyle, width: '80px' }}
                                        >
                                            <option value={1}>1★</option>
                                            <option value={2}>2★</option>
                                            <option value={3}>3★</option>
                                        </select>
                                    </div>
                                </div>

                                {/* Green Spark */}
                                <div>
                                    <label style={labelStyle}>Green Spark (Unique Skill)</label>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input 
                                            type="text"
                                            placeholder="Skill name"
                                            value={form.spark_data?.green?.name || ""}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, green: { ...form.spark_data!.green!, name: e.target.value } } })}
                                            style={{ ...inputStyle, flex: 1 }}
                                        />
                                        <select 
                                            value={form.spark_data?.green?.stars || 1}
                                            onChange={e => setForm({ ...form, spark_data: { ...form.spark_data!, green: { ...form.spark_data!.green!, stars: parseInt(e.target.value) } } })}
                                            style={{ ...inputStyle, width: '80px' }}
                                        >
                                            <option value={1}>1★</option>
                                            <option value={2}>2★</option>
                                            <option value={3}>3★</option>
                                        </select>
                                    </div>
                                </div>

                                {/* White Sparks */}
                                <div>
                                    <label style={labelStyle}>White Sparks (Other Skills/Races)</label>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        {form.spark_data?.white?.map((ws, i) => (
                                            <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <span style={{ flex: 1, fontSize: '0.875rem' }}>{ws.name}</span>
                                                <span style={{ width: '40px', fontSize: '0.875rem' }}>{ws.stars}★</span>
                                                <button onClick={() => handleRemoveWhiteSpark(i)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>×</button>
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                        <input 
                                            type="text"
                                            placeholder="URA Scenario, etc."
                                            value={newWhiteSpark.name}
                                            onChange={e => setNewWhiteSpark({ ...newWhiteSpark, name: e.target.value })}
                                            style={{ ...inputStyle, flex: 1 }}
                                        />
                                        <select 
                                            value={newWhiteSpark.stars}
                                            onChange={e => setNewWhiteSpark({ ...newWhiteSpark, stars: parseInt(e.target.value) })}
                                            style={{ ...inputStyle, width: '80px' }}
                                        >
                                            <option value={1}>1★</option>
                                            <option value={2}>2★</option>
                                            <option value={3}>3★</option>
                                        </select>
                                        <button onClick={handleAddWhiteSpark} style={{ ...secondaryButtonStyle, padding: '0 0.75rem' }}>Add</button>
                                    </div>
                                </div>
                            </div>
                        </Section>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                        <Section title="G1 Race History (For Affinity)">
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '500px', overflowY: 'auto', paddingRight: '0.5rem' }}>
                                {G1_RACES.map(race => (
                                    <label key={race} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                                        <input 
                                            type="checkbox" 
                                            checked={form.g1_races?.includes(race) || false}
                                            onChange={() => handleToggleRace(race)}
                                        />
                                        {race}
                                    </label>
                                ))}
                            </div>
                        </Section>
                    </div>
                </div>

                <div style={{ padding: '1.5rem', borderTop: '1px solid #222', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                    <button onClick={onClose} style={secondaryButtonStyle}>Cancel</button>
                    <button onClick={handleSave} style={primaryButtonStyle}>{initialData ? 'Save Changes' : 'Save Veteran'}</button>
                </div>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={sectionHeaderStyle}>{title}</h3>
            {children}
        </div>
    );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const primaryButtonStyle: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', fontWeight: 600, cursor: 'pointer'
};

const secondaryButtonStyle: React.CSSProperties = {
    padding: '0.75rem 1.5rem', borderRadius: 8, border: '1px solid #333', background: '#1a1a1a', color: '#fff', fontWeight: 600, cursor: 'pointer'
};

const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #333', background: '#111', color: '#fff', fontSize: '0.875rem', boxSizing: 'border-box'
};

const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em'
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#555',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 8,
  borderBottom: '1px solid #222',
  paddingBottom: 4,
};

// ─── Veteran Card ────────────────────────────────────────────────────────────

function VeteranCard({ veteran, onClick }: { veteran: Veteran; onClick: () => void }) {
  const [artLoaded, setArtLoaded] = useState(false)
  const blueSpark = veteran.spark_data?.blue;
  const shadow      = '0 2px 12px rgba(0,0,0,0.5)'
  const hoverShadow = '0 6px 24px rgba(0,0,0,0.7)'

  return (
    <div
      onClick={onClick}
      style={{
        position: 'relative', borderRadius: 12, overflow: 'hidden',
        background: '#1a1a22', aspectRatio: '3 / 4',
        boxShadow: shadow,
        transition: 'transform 0.15s, box-shadow 0.15s',
        cursor: 'pointer',
      }}
      onMouseEnter={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1.03)'
        d.style.boxShadow = hoverShadow
      }}
      onMouseLeave={e => {
        const d = e.currentTarget as HTMLDivElement
        d.style.transform = 'scale(1)'
        d.style.boxShadow = shadow
      }}
    >
      <img
        src={getPortraitUrl(veteran.trainee?.image_path ?? null, veteran.trainee_id)}
        onLoad={() => setArtLoaded(true)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: artLoaded ? 1 : 0, transition: 'opacity 0.3s' }}
      />
      {!artLoaded && (
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1e1e2a 0%, #2a2a38 50%, #1e1e2a 100%)' }} />
      )}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, padding: '28px 8px 8px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, transparent 100%)',
      }} />

      {veteran.is_friend && (
          <div style={{
            position: 'absolute', top: 6, left: 6,
            background: 'rgba(168, 85, 247, 0.25)', border: '1px solid rgba(168, 85, 247, 0.6)', color: '#c084fc',
            padding: '1px 5px', borderRadius: 5,
            fontSize: 10, fontWeight: 700, lineHeight: 1.5,
            boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
          }}>
            Friend
          </div>
      )}
      
      {/* Main Spark Badge */}
      {blueSpark && (
          <div style={{
            position: 'absolute', top: 6, right: 6,
            background: 'rgba(59, 130, 246, 0.25)', border: '1px solid rgba(59, 130, 246, 0.6)', color: '#60a5fa',
            padding: '1px 5px', borderRadius: 5,
            fontSize: 10, fontWeight: 700, lineHeight: 1.5,
            boxShadow: '0 2px 4px rgba(0,0,0,0.5)',
          }}>
            {blueSpark.name} {blueSpark.stars}★
          </div>
      )}

      <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', lineHeight: 1.3, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{veteran.trainee?.name}</div>
        <div style={{ fontSize: 9, color: '#bbb', marginTop: 1, textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{veteran.g1_races?.length || 0} G1 Wins</div>
      </div>
    </div>
  );
}

// ─── Veteran Modal ────────────────────────────────────────────────────────────

function VeteranModal({ veteran, onClose, onEdit }: { veteran: Veteran; onClose: () => void; onEdit: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const sparks = veteran.spark_data;

  return (
    <div
      ref={overlayRef}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 16,
      }}
    >
      <div style={{
        background: '#16161e', borderRadius: 16, width: '100%', maxWidth: 540,
        border: '1px solid #2a2a38', display: 'flex', flexDirection: 'column',
        maxHeight: '90vh', overflow: 'hidden',
        position: 'relative',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
      }}>
        
        {/* Header Section */}
        <div style={{ position: 'relative', height: 'min(260px, 38dvh)', flexShrink: 0, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', height: '100%' }}>
            <img
              src={getPortraitUrl(veteran.trainee?.image_path ?? null, veteran.trainee_id)}
              style={{ float: 'left', height: '100%', width: 'auto', objectFit: 'contain', objectPosition: 'top left', display: 'block', WebkitMaskImage: 'linear-gradient(to right, black 55%, transparent 100%)', maskImage: 'linear-gradient(to right, black 55%, transparent 100%)' }}
            />
          </div>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, #16161e 0%, rgba(22,22,30,0.55) 38%, transparent 65%)' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, transparent 28%)' }} />
          
          <button
              onClick={onClose}
              style={{
                position: 'absolute', top: 10, left: 10,
                width: 30, height: 30, padding: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)',
                border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8,
                color: '#ccc', cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}
            >×</button>
          
          <button 
            onClick={onEdit} 
            style={{ 
              position: 'absolute', top: 10, right: 10, 
              background: 'rgba(37,99,235,0.8)', border: '1px solid rgba(255,255,255,0.1)', 
              color: '#fff', borderRadius: 8, padding: '6px 14px', 
              fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
              backdropFilter: 'blur(6px)'
            }}
          >Edit</button>

          <div style={{ position: 'absolute', bottom: 12, right: 14, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <div style={{ textAlign: 'right' }}>
                {veteran.is_friend && (
                  <div style={{ fontSize: 11, color: '#c084fc', textShadow: '0 1px 4px rgba(0,0,0,0.9)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
                    Friend Unit
                  </div>
                )}
                {veteran.trainee?.title && (
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                    [{veteran.trainee?.title}]
                  </div>
                )}
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', textShadow: '0 2px 8px rgba(0,0,0,0.9)', lineHeight: 1.15, letterSpacing: '-0.01em' }}>
                  {veteran.trainee?.name}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
          
          <div>
              {/* Sparks Data */}
              <section style={{ marginBottom: '2rem' }}>
                <h4 style={sectionHeaderStyle}>Sparks</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {sparks?.blue && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', borderLeft: '4px solid #3b82f6', borderRadius: 4 }}>
                            <span style={{ fontSize: '0.8rem' }}>{sparks.blue.name}</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{sparks.blue.stars}★</span>
                        </div>
                    )}
                    {sparks?.pink && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(236, 72, 153, 0.1)', borderLeft: '4px solid #ec4899', borderRadius: 4 }}>
                            <span style={{ fontSize: '0.8rem' }}>{sparks.pink.name}</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{sparks.pink.stars}★</span>
                        </div>
                    )}
                    {sparks?.green && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(34, 197, 94, 0.1)', borderLeft: '4px solid #22c55e', borderRadius: 4 }}>
                            <span style={{ fontSize: '0.8rem' }}>{sparks.green.name}</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{sparks.green.stars}★</span>
                        </div>
                    )}
                    {sparks?.white && sparks.white.length > 0 && sparks.white.map((ws, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem', background: 'rgba(255, 255, 255, 0.05)', borderLeft: '4px solid #fff', borderRadius: 4 }}>
                            <span style={{ fontSize: '0.8rem' }}>{ws.name}</span>
                            <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{ws.stars}★</span>
                        </div>
                    ))}
                </div>
              </section>
          </div>

          <div>
              {/* G1 Races */}
              <section>
                <h4 style={sectionHeaderStyle}>G1 Races Won ({veteran.g1_races?.length || 0})</h4>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {veteran.g1_races?.map((r, i) => (
                    <span key={i} style={{ background: '#1a1a26', border: '1px solid #2a2a38', padding: '4px 8px', borderRadius: 6, fontSize: 10, color: '#ccc' }}>{r}</span>
                  ))}
                  {(!veteran.g1_races || veteran.g1_races.length === 0) && (
                      <span style={{ fontSize: '0.8rem', color: '#555' }}>No G1 races recorded.</span>
                  )}
                </div>
              </section>
          </div>
        </div>
      </div>
    </div>
  );
}
