import { compactInputFromJson, solveDeckCompact } from '../../shared/deckSolverCore'

export type WorkerPayload = Parameters<typeof compactInputFromJson>[0]

self.onmessage = (e: MessageEvent<WorkerPayload>) => {
  const cr = solveDeckCompact(compactInputFromJson(e.data))
  self.postMessage(cr)
}
