// BatchCardImporter.jsx
// Drop into your Vite app alongside SupportCardImporter.
// Usage: <BatchCardImporter supabase={supabase} />

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

const RARITY_COLORS: Record<string, string> = { SSR: '#c084fc', SR: '#fbbf24', R: '#60a5fa' };

type Rarity = 'SSR' | 'SR' | 'R' | string;

interface Card {
  id: number | string;
  name: string;
  slug: string;
  rarity: Rarity;
  [k: string]: any;
}

type ProgressResult = { id: number | string; name: string; status: 'success' | 'error'; error?: string };

interface ProgressState {
  current: number;
  total: number;
  currentCard: string;
  results: ProgressResult[];
}

export default function BatchCardImporter({ supabase }: { supabase: SupabaseClient }) {
  const [cards, setCards] = useState<Card[]>([]);
  const [importedIds, setImportedIds] = useState<Set<number | string>>(new Set());
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [rarityFilter, setRarityFilter] = useState<Record<Rarity, boolean>>({ SSR: true, SR: true, R: true });
  const [searchText, setSearchText] = useState<string>('');
  const [hideImported, setHideImported] = useState<boolean>(false);

  // Import state
  const [importing, setImporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressState>({ current: 0, total: 0, currentCard: '', results: [] });
  const abortRef = useRef<boolean>(false);

  // ── Fetch card list from Gametora (via edge function) ─────────
  const fetchCardList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await supabase.functions.invoke('list-support-cards')) as any;
      const { data, error: fnError } = res ?? {};
      if (fnError) throw new Error(fnError.message ?? String(fnError));
      if (!data?.success) throw new Error(data?.error ?? 'Unknown response');
      setCards(data.cards ?? []);
    } catch (err) {
      setError((err as Error)?.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  // ── Check which cards are already imported ────────────────────
  const fetchImportedIds = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('support_cards').select('id') as any;
      if (!error && Array.isArray(data)) {
        setImportedIds(new Set(data.map((r: any) => r.id)));
      }
    } catch (_) {}
  }, [supabase]);

  useEffect(() => {
    fetchImportedIds();
  }, [fetchImportedIds]);

  // ── Filtered card list ────────────────────────────────────────
  const filteredCards = cards.filter((c) => {
    if (!rarityFilter[c.rarity]) return false;
    if (hideImported && importedIds.has(c.id)) return false;
    if (searchText && !c.name.toLowerCase().includes(searchText.toLowerCase()) && !String(c.id).includes(searchText)) return false;
    return true;
  });

  // ── Batch import ──────────────────────────────────────────────
  const startBatchImport = useCallback(async (cardsToImport: Card[]) => {
    setImporting(true);
    abortRef.current = false;
    const results: ProgressResult[] = [];
    setProgress({ current: 0, total: cardsToImport.length, currentCard: '', results: [] });

    for (let i = 0; i < cardsToImport.length; i++) {
      if (abortRef.current) break;

      const card = cardsToImport[i];
      setProgress((p) => ({ ...p, current: i + 1, currentCard: card.name || card.slug }));

      try {
        const res = (await supabase.functions.invoke('import-support-card', {
          body: { url: `https://gametora.com/umamusume/supports/${card.slug}` },
        })) as any;
        const { data, error: fnError } = res ?? {};

        if (fnError) throw new Error(fnError.message ?? String(fnError));
        if (!data?.success) throw new Error(data?.error ?? 'Unknown response');

        results.push({ id: card.id, name: card.name, status: 'success' } as ProgressResult);
        setImportedIds((prev) => new Set([...Array.from(prev), card.id]));
      } catch (err) {
        results.push({ id: card.id, name: card.name, status: 'error', error: (err as Error)?.message ?? String(err) } as ProgressResult);
      }

      setProgress((p) => ({ ...p, results: [...results] }));

      // Rate limit: wait 500ms between requests to be respectful
      if (i < cardsToImport.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setImporting(false);
  }, [supabase]);

  const stopImport = () => {
    abortRef.current = true;
  };

  // ── Stats ─────────────────────────────────────────────────────
  const successCount = progress.results.filter((r) => r.status === 'success').length;
  const errorCount = progress.results.filter((r) => r.status === 'error').length;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* ── Header & Fetch ─────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          onClick={fetchCardList}
          disabled={loading || importing}
          style={{
            padding: '10px 20px', borderRadius: 8, border: 'none',
            background: '#6d28d9', color: '#fff', fontSize: 14,
            fontWeight: 600, cursor: loading ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {loading ? 'Fetching…' : cards.length ? `Refresh List (${cards.length})` : 'Fetch Card List from Gametora'}
        </button>
        {cards.length > 0 && (
          <span style={{ fontSize: 13, color: '#888' }}>
            {importedIds.size} / {cards.length} already imported
          </span>
        )}
      </div>

      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, background: '#7f1d1d30',
          border: '1px solid #7f1d1d60', color: '#fca5a5', fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* ── Filters ────────────────────────────── */}
      {cards.length > 0 && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap',
          padding: '10px 14px', borderRadius: 8,
          background: 'var(--card-bg, #18181b)', border: '1px solid var(--border, #333)',
        }}>
          {/* Rarity toggles */}
          {['SSR', 'SR', 'R'].map((r) => (
            <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={rarityFilter[r]}
                onChange={() => setRarityFilter((f) => ({ ...f, [r]: !f[r] }))}
                style={{ accentColor: RARITY_COLORS[r] }}
              />
              <span style={{ color: RARITY_COLORS[r], fontWeight: 700, fontSize: 12 }}>{r}</span>
              <span style={{ color: '#666', fontSize: 11 }}>
                ({cards.filter((c) => c.rarity === r).length})
              </span>
            </label>
          ))}

          <span style={{ color: '#444' }}>|</span>

          <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={hideImported}
              onChange={() => setHideImported((h) => !h)}
              style={{ accentColor: '#6d28d9' }}
            />
            <span style={{ color: '#888' }}>Hide imported</span>
          </label>

          <input
            type="text"
            placeholder="Search by name or ID…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{
              marginLeft: 'auto', padding: '6px 10px', borderRadius: 6,
              border: '1px solid var(--border, #333)', background: 'var(--bg, #0c0c0e)',
              color: 'var(--text, #e4e4e7)', fontSize: 12, fontFamily: 'inherit',
              width: 180, outline: 'none',
            }}
          />
        </div>
      )}

      {/* ── Batch Import Controls ──────────────── */}
      {cards.length > 0 && !importing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => startBatchImport(filteredCards.filter((c) => !importedIds.has(c.id)))}
            disabled={filteredCards.filter((c) => !importedIds.has(c.id)).length === 0}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: '#059669', color: '#fff', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              opacity: filteredCards.filter((c) => !importedIds.has(c.id)).length === 0 ? 0.4 : 1,
            }}
          >
            Import {filteredCards.filter((c) => !importedIds.has(c.id)).length} New Cards
          </button>
          <button
            onClick={() => startBatchImport(filteredCards)}
            style={{
              padding: '10px 20px', borderRadius: 8,
              border: '1px solid var(--border, #333)', background: 'transparent',
              color: 'var(--text, #e4e4e7)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Re-import All {filteredCards.length} Filtered
          </button>
        </div>
      )}

      {/* ── Progress Bar ───────────────────────── */}
      {(importing || progress.results.length > 0) && (
        <div style={{
          padding: 16, borderRadius: 10,
          background: 'var(--card-bg, #18181b)', border: '1px solid var(--border, #333)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {importing ? `Importing… ${progress.current} / ${progress.total}` : `Done — ${progress.results.length} processed`}
            </span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {successCount > 0 && <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {successCount}</span>}
              {errorCount > 0 && <span style={{ fontSize: 12, color: '#fca5a5' }}>✕ {errorCount}</span>}
              {importing && (
                <button
                  onClick={stopImport}
                  style={{
                    padding: '4px 12px', borderRadius: 6, border: '1px solid #dc2626',
                    background: 'transparent', color: '#fca5a5', fontSize: 12,
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Stop
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{
            height: 6, borderRadius: 3, background: '#27272a', overflow: 'hidden', marginBottom: 8,
          }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: 'linear-gradient(90deg, #6d28d9, #a855f7)',
              width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
              transition: 'width 0.3s ease',
            }} />
          </div>

          {importing && progress.currentCard && (
            <div style={{ fontSize: 12, color: '#888' }}>Current: {progress.currentCard}</div>
          )}

          {/* Error log */}
          {errorCount > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Errors:</div>
              <div style={{ maxHeight: 120, overflow: 'auto', fontSize: 11 }}>
                {progress.results
                  .filter((r) => r.status === 'error')
                  .map((r, i) => (
                    <div key={i} style={{ color: '#fca5a5', padding: '2px 0' }}>
                      {r.name} (#{r.id}): {r.error}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Card List ──────────────────────────── */}
      {cards.length > 0 && (
        <div style={{
          maxHeight: 500, overflow: 'auto', borderRadius: 8,
          border: '1px solid var(--border, #333)',
        }}>
          {filteredCards.map((card) => {
            const isImported = importedIds.has(card.id);
            const importResult = progress.results.find((r) => r.id === card.id);
            return (
              <div
                key={card.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 14px',
                  borderBottom: '1px solid var(--border, #27272a)',
                  background: importResult?.status === 'error' ? '#7f1d1d15' : 'transparent',
                  opacity: isImported && !importResult ? 0.5 : 1,
                  fontSize: 13,
                }}
              >
                {/* Status indicator */}
                <span style={{ width: 18, textAlign: 'center', fontSize: 12 }}>
                  {importResult?.status === 'success' ? '✓' :
                   importResult?.status === 'error' ? '✕' :
                   isImported ? '●' : '○'}
                </span>

                {/* Rarity badge */}
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                  background: RARITY_COLORS[card.rarity], color: '#000', minWidth: 28, textAlign: 'center',
                }}>
                  {card.rarity}
                </span>

                {/* Name & ID */}
                <span style={{ fontWeight: 500, flex: 1 }}>{card.name}</span>
                <span style={{ fontSize: 11, color: '#555' }}>#{card.id}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}