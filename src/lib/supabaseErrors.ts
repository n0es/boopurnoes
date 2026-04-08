/** PostgREST: relation missing from schema cache (HTTP 404, code PGRST205). */
export function isMissingTableError(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST205' || /could not find the table/i.test(err.message ?? '')
}
