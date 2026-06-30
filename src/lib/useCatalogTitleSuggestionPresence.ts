import { useCallback, useEffect, useState } from 'react'
import { uma } from './supabase'

export type CatalogTitleEntityKind = 'trainee' | 'support_card'

export function useCatalogTitleSuggestionPresence(isAdmin: boolean) {
  const [entityKeys, setEntityKeys] = useState<Set<string>>(() => new Set())

  const refreshSuggestionPresence = useCallback(async () => {
    if (!isAdmin) {
      setEntityKeys(new Set())
      return
    }
    const { data, error } = await uma
      .from('catalog_title_suggestions')
      .select('entity_type, entity_id')
    if (error) {
      if (!error.message.includes('does not exist')) {
        console.warn('catalog_title_suggestions:', error.message)
      }
      return
    }
    setEntityKeys(new Set((data ?? []).map((r: { entity_type: string; entity_id: number }) => `${r.entity_type}:${r.entity_id}`)))
  }, [isAdmin])

  useEffect(() => {
    void refreshSuggestionPresence()
  }, [refreshSuggestionPresence])

  const hasPendingSuggestions = useCallback(
    (kind: CatalogTitleEntityKind, id: number) => entityKeys.has(`${kind}:${id}`),
    [entityKeys]
  )

  return { hasPendingSuggestions, refreshSuggestionPresence }
}
