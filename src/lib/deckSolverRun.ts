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
  options?: { onProgress?: (p: DeckSolveProgress) => void; signal?: AbortSignal },
): Promise<SolveDeckResult> {
  const payload = buildDeckSolvePayload(args)
  if (!payload) {
    return Promise.resolve({ solutions: [], iterations: 0, capped: false })
  }

  const signal = options?.signal

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }

    const worker = new Worker(new URL('../workers/deckSolver.worker.ts', import.meta.url), {
      type: 'module',
    })

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
    }

    const onAbort = () => {
      cleanup()
      worker.terminate()
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (ev: MessageEvent<WorkerToMain>) => {
      const data = ev.data
      if (data.type === 'progress') {
        options?.onProgress?.(data)
        return
      }
      cleanup()
      worker.terminate()
      resolve(reconstructDeckSolutions(args, data.result))
    }
    worker.onerror = err => {
      cleanup()
      worker.terminate()
      reject(err)
    }
    worker.postMessage(payload)
  })
}

/**
 * Optional server-side solve (e.g. scripts or future use). The Deck Builder UI uses
 * {@link runDeckSolveInWorker} only so searches do not load the app server.
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
