// BatchCardImporter.tsx
// Drop into your Vite app.
// Usage: <BatchCardImporter supabase={supabase} />
//
// Requires: src/data/supportCardSlugs.json
//   (downloaded from Gametora list page — 526 cards)
//   Place the downloaded JSON file at that path, or adjust the import below.

import { useState, useCallback, useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import cardList from '../data/supportCardSlugs.json';

// ── Types ───────────────────────────────────────────────────────
interface CardEntry {
  id: number;
  slug: string;
  name: string;
  rarity: 'SSR' | 'SR' | 'R';
}

interface ImportResult {
  id: number;
  name: string;
  status: 'success' | 'error';
  error?: string;
}

interface ImportProgress {
  current: number;
  total: number;
  currentCard: string;
  results: ImportResult[];
}

interface ImageDownloadResult {
  success: boolean;
  processed: number;
  icons_downloaded: number;
  art_downloaded: number;
  errors: { card_id: number; icon_error?: string | null; art_error?: string | null }[];
  message?: string;
}

interface BatchCardImporterProps {
  supabase: SupabaseClient;
}

type RarityFilter = Record<'SSR' | 'SR' | 'R', boolean>;

// ── Constants ───────────────────────────────────────────────────
const RARITY_COLORS: Record<string, string> = {
  SSR: '#c084fc',
  SR: '#fbbf24',
  R: '#60a5fa',
};

const typedCardList = cardList as CardEntry[];

// ── Component ───────────────────────────────────────────────────
export default function BatchCardImporter({ supabase }: BatchCardImporterProps) {
  const [importedIds, setImportedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  // Filters
  const [rarityFilter, setRarityFilter] = useState<RarityFilter>({ SSR: true, SR: true, R: true });
  const [searchText, setSearchText] = useState('');
  const [hideImported, setHideImported] = useState(false);

  // Import state
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<ImportProgress>({
    current: 0, total: 0, currentCard: '', results: [],
  });
  const abortRef = useRef(false);

  // Image download state
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [imageResult, setImageResult] = useState<ImageDownloadResult | null>(null);

  // ── Check which cards are already imported ────────────────────
  const fetchImportedIds = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .schema('uma').from('support_cards')
        .select('id');
      if (!error && data) {
        setImportedIds(new Set(data.map((r: { id: number }) => r.id)));
      }
    } catch (_) {
      // silently fail
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchImportedIds();
  }, [fetchImportedIds]);

  // ── Filtered card list ────────────────────────────────────────
  const filteredCards = typedCardList.filter((c) => {
    if (!rarityFilter[c.rarity]) return false;
    if (hideImported && importedIds.has(c.id)) return false;
    if (
      searchText &&
      !c.name.toLowerCase().includes(searchText.toLowerCase()) &&
      !String(c.id).includes(searchText)
    )
      return false;
    return true;
  });

  const newCards = filteredCards.filter((c) => !importedIds.has(c.id));

  // ── Batch import ──────────────────────────────────────────────
  const startBatchImport = useCallback(async (cardsToImport: CardEntry[]) => {
    setImporting(true);
    abortRef.current = false;
    const results: ImportResult[] = [];
    setProgress({ current: 0, total: cardsToImport.length, currentCard: '', results: [] });

    for (let i = 0; i < cardsToImport.length; i++) {
      if (abortRef.current) break;

      const card = cardsToImport[i];
      setProgress((p) => ({ ...p, current: i + 1, currentCard: card.name || card.slug }));

      try {
        const { data, error: fnError } = await supabase.functions.invoke(
          'import-support-card',
          { body: { url: `https://gametora.com/umamusume/supports/${card.slug}` } },
        );

        if (fnError) throw new Error(fnError.message);
        if (!data.success) throw new Error(data.error || 'Import failed');

        results.push({ id: card.id, name: card.name, status: 'success' });
        setImportedIds((prev) => new Set([...prev, card.id]));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ id: card.id, name: card.name, status: 'error', error: message });
      }

      setProgress((p) => ({ ...p, results: [...results] }));

      // Rate limit: 500ms between requests
      if (i < cardsToImport.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    setImporting(false);
  }, [supabase]);

  const stopImport = () => {
    abortRef.current = true;
  };

  // ── Image download ────────────────────────────────────────────
  const downloadAllImages = useCallback(async (skipExisting = true) => {
    setDownloadingImages(true);
    setImageResult(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        'download-support-images',
        { body: { skip_existing: skipExisting } },
      );
      if (fnError) throw new Error(fnError.message);
      if (!data.success) throw new Error(data.error || 'Image download failed');
      setImageResult(data as ImageDownloadResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setImageResult({
        success: false,
        processed: 0,
        icons_downloaded: 0,
        art_downloaded: 0,
        errors: [{ card_id: 0, icon_error: message }],
      });
    }
    setDownloadingImages(false);
  }, [supabase]);

  const successCount = progress.results.filter((r) => r.status === 'success').length;
  const errorCount = progress.results.filter((r) => r.status === 'error').length;

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {typedCardList.length} cards available
        </span>
        <span style={{ fontSize: 13, color: '#888' }}>
          {loading ? 'Checking imported…' : `${importedIds.size} already imported`}
        </span>
        <button
          onClick={fetchImportedIds}
          style={{
            padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border, #333)',
            background: 'transparent', color: 'var(--text, #e4e4e7)', fontSize: 12,
            cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          Refresh
        </button>
      </div>

      {/* ── Filters ────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap',
        padding: '10px 14px', borderRadius: 8,
        background: 'var(--card-bg, #18181b)', border: '1px solid var(--border, #333)',
      }}>
        {(['SSR', 'SR', 'R'] as const).map((r) => (
          <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={rarityFilter[r]}
              onChange={() => setRarityFilter((f) => ({ ...f, [r]: !f[r] }))}
              style={{ accentColor: RARITY_COLORS[r] }}
            />
            <span style={{ color: RARITY_COLORS[r], fontWeight: 700, fontSize: 12 }}>{r}</span>
            <span style={{ color: '#666', fontSize: 11 }}>
              ({typedCardList.filter((c) => c.rarity === r).length})
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

      {/* ── Batch Import Controls ──────────────── */}
      {!importing && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => startBatchImport(newCards)}
            disabled={newCards.length === 0}
            style={{
              padding: '10px 20px', borderRadius: 8, border: 'none',
              background: '#059669', color: '#fff', fontSize: 13,
              fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              opacity: newCards.length === 0 ? 0.4 : 1,
            }}
          >
            Import {newCards.length} New Cards
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

      {/* ── Image Download Controls ────────────── */}
      <div style={{
        padding: 16, borderRadius: 10, marginBottom: 16,
        background: 'var(--card-bg, #18181b)', border: '1px solid var(--border, #333)',
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, marginRight: 4 }}>Card Images</span>
          <button
            onClick={() => downloadAllImages(true)}
            disabled={downloadingImages || importing}
            style={{
              padding: '8px 16px', borderRadius: 6, border: 'none',
              background: downloadingImages ? '#555' : '#2563eb', color: '#fff', fontSize: 12,
              fontWeight: 600, cursor: downloadingImages ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            {downloadingImages ? 'Downloading…' : 'Download Missing Images'}
          </button>
          <button
            onClick={() => downloadAllImages(false)}
            disabled={downloadingImages || importing}
            style={{
              padding: '8px 16px', borderRadius: 6,
              border: '1px solid var(--border, #333)', background: 'transparent',
              color: 'var(--text, #e4e4e7)', fontSize: 12,
              cursor: downloadingImages ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >
            Re-download All
          </button>
          {downloadingImages && (
            <span style={{ fontSize: 11, color: '#888' }}>
              Processing in parallel batches of 10 — this may take a minute…
            </span>
          )}
        </div>

        {imageResult && (
          <div style={{ marginTop: 12 }}>
            {imageResult.message ? (
              <span style={{ fontSize: 12, color: '#4ade80' }}>✓ {imageResult.message}</span>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#4ade80' }}>
                    ✓ {imageResult.processed} cards processed
                  </span>
                  <span style={{ color: '#93c5fd' }}>
                    🖼 {imageResult.icons_downloaded} icons
                  </span>
                  <span style={{ color: '#c4b5fd' }}>
                    🎨 {imageResult.art_downloaded} art
                  </span>
                  {imageResult.errors.length > 0 && (
                    <span style={{ color: '#fca5a5' }}>
                      ✕ {imageResult.errors.length} errors
                    </span>
                  )}
                </div>
                {imageResult.errors.length > 0 && (
                  <div style={{ maxHeight: 100, overflow: 'auto', fontSize: 11, marginTop: 6 }}>
                    {imageResult.errors.map((e, i) => (
                      <div key={i} style={{ color: '#fca5a5', padding: '1px 0' }}>
                        #{e.card_id}: {e.icon_error || ''} {e.art_error || ''}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Progress Bar ───────────────────────── */}
      {(importing || progress.results.length > 0) && (
        <div style={{
          padding: 16, borderRadius: 10,
          background: 'var(--card-bg, #18181b)', border: '1px solid var(--border, #333)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {importing
                ? `Importing… ${progress.current} / ${progress.total}`
                : `Done — ${progress.results.length} processed`}
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

          <div style={{ height: 6, borderRadius: 3, background: '#27272a', overflow: 'hidden', marginBottom: 8 }}>
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
              <span style={{ width: 18, textAlign: 'center', fontSize: 12, flexShrink: 0 }}>
                {importResult?.status === 'success'
                  ? '✓'
                  : importResult?.status === 'error'
                    ? '✕'
                    : isImported
                      ? '●'
                      : '○'}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
                background: RARITY_COLORS[card.rarity], color: '#000',
                minWidth: 28, textAlign: 'center', flexShrink: 0,
              }}>
                {card.rarity}
              </span>
              <span style={{ fontWeight: 500, flex: 1 }}>{card.name}</span>
              <span style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>#{card.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}