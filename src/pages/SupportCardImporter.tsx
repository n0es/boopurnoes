import React, { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase'
import BatchCardImporter from '../components/Batchcardimporter';

// ── Effect metadata (for display only — the edge function handles insertion) ──
const EFFECT_META: Record<number, { name: string; symbol: string }> = {
  1: { name: 'Friendship Bonus', symbol: 'percent' },
  2: { name: 'Mood Effect', symbol: 'percent' },
  3: { name: 'Speed Bonus', symbol: 'none' },
  4: { name: 'Stamina Bonus', symbol: 'none' },
  5: { name: 'Power Bonus', symbol: 'none' },
  6: { name: 'Guts Bonus', symbol: 'none' },
  7: { name: 'Wit Bonus', symbol: 'none' },
  8: { name: 'Training Effectiveness', symbol: 'percent' },
  9: { name: 'Initial Speed', symbol: 'none' },
  10: { name: 'Initial Stamina', symbol: 'none' },
  11: { name: 'Initial Power', symbol: 'none' },
  12: { name: 'Initial Guts', symbol: 'none' },
  13: { name: 'Initial Wit', symbol: 'none' },
  14: { name: 'Initial Friendship', symbol: 'none' },
  15: { name: 'Race Bonus', symbol: 'percent' },
  16: { name: 'Fan Bonus', symbol: 'percent' },
  17: { name: 'Hint Levels', symbol: 'level' },
  18: { name: 'Hint Frequency', symbol: 'percent' },
  19: { name: 'Specialty Priority', symbol: 'none' },
  25: { name: 'Event Recovery', symbol: 'percent' },
  26: { name: 'Event Effectiveness', symbol: 'percent' },
  27: { name: 'Failure Protection', symbol: 'percent' },
  28: { name: 'Energy Cost Reduction', symbol: 'percent' },
  30: { name: 'Skill Point Bonus', symbol: 'none' },
};

interface CardEffect {
  name: string;
  effect_type_id: number;
  value_at_50: number;
  unlock_level: number;
}

interface ImportResult {
  success: boolean;
  card: {
    id: number;
    name: string;
    rarity: string;
    card_type: string;
  };
  effects: CardEffect[];
  effects_count: number;
  error?: string;
}

function fmtVal(val: number, symbol: string) {
  if (symbol === 'percent') return `${val}%`;
  if (symbol === 'level') return `Lv ${val}`;
  return String(val);
}

const RARITY_COLORS: Record<string, string> = {
  SSR: '#c084fc',
  SR: '#fbbf24',
  R: '#60a5fa',
};

const TYPE_ICONS: Record<string, string> = {
  speed: '🏃',
  stamina: '💪',
  power: '✊',
  guts: '🔥',
  intelligence: '🧠',
  friend: '🤝',
  group: '👥',
};

export default function SupportCardImporter() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recentCards, setRecentCards] = useState<ImportResult[]>([]);
  const [showBatch, setShowBatch] = useState<boolean>(false);

  const importCard = useCallback(async () => {
    if (!url.includes('gametora.com/umamusume/supports/')) {
      setError('Please enter a valid Gametora support card URL');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'import-support-card',
        { body: { url } }
      );

      if (fnError) throw new Error(fnError.message);
      if (!data.success) throw new Error(data.error || 'Import failed');

      setResult(data);
      setRecentCards((prev) => {
        const filtered = prev.filter((c) => c.card.id !== data.card.id);
        return [data, ...filtered].slice(0, 10);
      });
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !loading) importCard();
  };

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      {/* ── Input Bar ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://gametora.com/umamusume/supports/30086-narita-top-road"
          disabled={loading}
          style={{
            flex: 1,
            padding: '10px 14px',
            borderRadius: 8,
            border: '1px solid var(--border, #333)',
            background: 'var(--input-bg, #1a1a1a)',
            color: 'var(--text, #e4e4e7)',
            fontSize: 14,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={importCard}
          disabled={loading || !url}
          style={{
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            background: loading ? '#555' : '#6d28d9',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            opacity: !url ? 0.5 : 1,
          }}
        >
          {loading ? 'Importing…' : 'Import Card'}
        </button>
        <button
          onClick={() => setShowBatch((s) => !s)}
          disabled={loading}
          style={{
            padding: '10px 16px',
            borderRadius: 8,
            border: '1px solid var(--border, #333)',
            background: showBatch ? '#111827' : 'transparent',
            color: 'var(--text, #e4e4e7)',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'wait' : 'pointer',
            fontFamily: 'inherit',
            marginLeft: 8,
          }}
        >
          {showBatch ? 'Hide Batch Importer' : 'Open Batch Importer'}
        </button>
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#7f1d1d30',
            border: '1px solid #7f1d1d60',
            color: '#fca5a5',
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {/* ── Success Result ────────────────────────────── */}
      {result && (
        <div
          style={{
            padding: 16,
            borderRadius: 10,
            background: 'var(--card-bg, #18181b)',
            border: '1px solid var(--border, #333)',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: '#4ade80' }}>✓ Imported</span>
            <span style={{ fontSize: 18, fontWeight: 700 }}>
              {TYPE_ICONS[result.card.card_type] || ''}{' '}
              {result.card.name}
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 4,
                background: RARITY_COLORS[result.card.rarity] || '#666',
                color: '#000',
              }}
            >
              {result.card.rarity}
            </span>
            <span style={{ fontSize: 12, color: '#888' }}>
              {result.effects_count} effects
            </span>
          </div>

          {/* Effect summary grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 8,
            }}
          >
            {result.effects.map((e, i) => (
              <div
                key={i}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'var(--bg, #0c0c0e)',
                  border: '1px solid var(--border, #333)',
                }}
              >
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
                  {e.name}
                </div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  {fmtVal(
                    e.value_at_50,
                    EFFECT_META[e.effect_type_id]?.symbol || 'none'
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#666' }}>
                  unlocks lv{e.unlock_level}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Recent Imports ────────────────────────────── */}
      {recentCards.length > 0 && (
        <div>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: '#888',
              marginBottom: 8,
            }}
          >
            Recent Imports
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentCards.map((r) => (
              <div
                key={r.card.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'var(--card-bg, #18181b)',
                  border: '1px solid var(--border, #272727)',
                  fontSize: 13,
                }}
              >
                <span>{TYPE_ICONS[r.card.card_type] || '?'}</span>
                <span style={{ fontWeight: 600, flex: 1 }}>{r.card.name}</span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 6px',
                    borderRadius: 3,
                    background: RARITY_COLORS[r.card.rarity] || '#666',
                    color: '#000',
                  }}
                >
                  {r.card.rarity}
                </span>
                <span style={{ fontSize: 11, color: '#666' }}>
                  ID: {r.card.id}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* Batch importer (toggled) */}
      {showBatch && (
        <div style={{ marginTop: 16 }}>
          <BatchCardImporter supabase={supabase} />
        </div>
      )}
    </div>
  );
}