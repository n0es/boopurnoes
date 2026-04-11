import type { RegionAvailabilityFilter } from './releaseMetadata'

const STORAGE_KEY = 'uma.regionServer'

export function getStoredRegionServer(): RegionAvailabilityFilter {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'global' || v === 'jp') return v
  } catch {
    /* ignore */
  }
  return 'jp'
}

export function setStoredRegionServer(r: RegionAvailabilityFilter): void {
  try {
    localStorage.setItem(STORAGE_KEY, r)
  } catch {
    /* ignore */
  }
}
