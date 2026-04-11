import {
  compactInputFromJson,
  solveDeckCompact,
  type CompactDeckResult,
} from '../../shared/deckSolverCore'

export type WorkerPayload = Parameters<typeof compactInputFromJson>[0]

type WorkerToMain =
  | { type: 'progress'; comboIdx: number; totalCombos: number; iterations: number }
  | { type: 'done'; result: CompactDeckResult }

self.onmessage = (e: MessageEvent<WorkerPayload>) => {
  const input = compactInputFromJson(e.data)
  const cr = solveDeckCompact(input, {
    onProgress: p => {
      const msg: WorkerToMain = { type: 'progress', ...p }
      self.postMessage(msg)
    },
    progressEveryCombo: 512,
    progressEveryIterations: 65_536,
  })
  const done: WorkerToMain = { type: 'done', result: cr }
  self.postMessage(done)
}
