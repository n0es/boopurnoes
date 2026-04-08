import { supabase } from './supabase'
import type { CareerSimulatorPersisted } from './careerSimulatorStorage'
import { parseCareerSimulatorPayload } from './careerSimulatorStorage'

const SAVE_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isCareerSimulatorSaveId(s: string | undefined): s is string {
  return typeof s === 'string' && SAVE_ID_RE.test(s)
}

export type CareerSimulatorSaveListItem = {
  id: string
  name: string
  updated_at: string
}

export async function listCareerSimulatorSaves(): Promise<CareerSimulatorSaveListItem[]> {
  const { data, error } = await supabase
    .from('career_simulator_saves')
    .select('id, name, updated_at')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CareerSimulatorSaveListItem[]
}

export async function fetchCareerSimulatorSave(
  id: string,
): Promise<{ id: string; name: string; payload: CareerSimulatorPersisted } | null> {
  const { data, error } = await supabase
    .from('career_simulator_saves')
    .select('id, name, payload')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data?.payload) return null
  const payload = parseCareerSimulatorPayload(data.payload as unknown)
  if (!payload) return null
  return { id: data.id, name: data.name, payload }
}

export async function insertCareerSimulatorSave(
  userId: string,
  name: string,
  payload: CareerSimulatorPersisted,
): Promise<string> {
  const { data, error } = await supabase
    .from('career_simulator_saves')
    .insert({
      user_id: userId,
      name: name.trim() || 'Untitled',
      payload: payload as unknown as Record<string, unknown>,
    })
    .select('id')
    .single()
  if (error) throw error
  return data.id as string
}

export async function updateCareerSimulatorSave(
  id: string,
  name: string,
  payload: CareerSimulatorPersisted,
): Promise<void> {
  const { error } = await supabase
    .from('career_simulator_saves')
    .update({
      name: name.trim() || 'Untitled',
      payload: payload as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function deleteCareerSimulatorSave(id: string): Promise<void> {
  const { error } = await supabase.from('career_simulator_saves').delete().eq('id', id)
  if (error) throw error
}
