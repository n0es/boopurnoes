import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getStoredRegionServer, setStoredRegionServer } from './regionPreference'
import { parseRegionParam, type RegionAvailabilityFilter } from './releaseMetadata'

/**
 * Syncs `?region=` with localStorage so Japan / Global persists across visits.
 * URL wins when present; when absent, stored Global adds `?region=global`.
 */
export function useRegionSearchParam() {
  const [searchParams, setSearchParams] = useSearchParams()

  const region = useMemo(
    () => parseRegionParam(searchParams.get('region')),
    [searchParams],
  )

  useEffect(() => {
    if (searchParams.has('region')) {
      setStoredRegionServer(parseRegionParam(searchParams.get('region')))
      return
    }
    if (getStoredRegionServer() === 'global') {
      setSearchParams(
        p => {
          const n = new URLSearchParams(p)
          n.set('region', 'global')
          return n
        },
        { replace: true },
      )
    }
  }, [searchParams, setSearchParams])

  const setRegion = useCallback(
    (r: RegionAvailabilityFilter) => {
      setStoredRegionServer(r)
      setSearchParams(
        p => {
          const n = new URLSearchParams(p)
          if (r === 'jp') n.delete('region')
          else n.set('region', 'global')
          return n
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { region, setRegion, searchParams, setSearchParams }
}
