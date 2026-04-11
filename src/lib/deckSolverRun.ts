import {
  buildDeckSolvePayload,
  reconstructDeckSolutions,
  type SolveDeckArgs,
  type SolveDeckResult,
} from './deckBuilderSolver'
import type { CompactDeckResult, DeckSolveProgress } from '../../shared/deckSolverCore'

type WorkerToMain =
  | { type: 'progress'; comboIdx: number; totalCombos: number; iterations: number }
  | { type: 'done'; result: CompactDeckResult }

export type { DeckSolveProgress }

/** Run search off the main thread (same numeric core as the server). */
export function runDeckSolveInWorker(
  args: SolveDeckArgs,
  options?: { onProgress?: (p: DeckSolveProgress) => void },
): Promise<SolveDeckResult> {
  const payload = buildDeckSolvePayload(args)
  if (!payload) {
    return Promise.resolve({ solutions: [], iterations: 0, capped: false })
  }

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/deckSolver.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const data = ev.data
      if (data.type === 'progress') {
        options?.onProgress?.(data)
        return
      }
      worker.terminate()
      resolve(reconstructDeckSolutions(args, data.result))
    }
    worker.onerror = err => {
      worker.terminate()
      reject(err)
    }
    worker.postMessage(payload)
  })
}

/**
 * When the app is served by Node (npm start), the solver can run on the server
 * so the browser does almost no work. Falls back is not automatic — use worker from UI.
 */
export async function runDeckSolveOnServer(args: SolveDeckArgs): Promise<SolveDeckResult | null> {
  const payload = buildDeckSolvePayload(args)
  if (!payload) return { solutions: [], iterations: 0, capped: false }

  try {
    const res = await fetch('/api/deck-solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const cr = (await res.json()) as CompactDeckResult
    return reconstructDeckSolutions(args, cr)
  } catch {
    return null
  }
}
