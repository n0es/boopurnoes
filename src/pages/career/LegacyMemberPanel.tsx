import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { supabase } from '../../lib/supabase'
import { lookupSparkAffinity, SPARK_AFFINITY_SYMBOL, type SuccessionData } from '../../lib/successionAffinity'
import { normalizeMemberFactors } from './legacyNormalize'
import type { Factor, LegacyMember, RaceOption, TraineeUniqueSkillOption } from './legacyTypes'

export type LegacySlotKey = 'legacy_1' | 'legacy_2'
export type LegacyMemberKey = 'parent' | 'grandparent_1' | 'grandparent_2'

export interface TraineeLite {
  id: number
  name: string
  name_jp: string | null
  title: string | null
  icon_path: string | null
  image_path: string | null
}

const chipRemoveBtn: CSSProperties = {
  background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: '0.85rem', lineHeight: 1, padding: '0 0.15rem',
}

/** Default green when linking a portrait: highest star gate, then latest `sort_order` (promoted unique). */
function pickDefaultUniqueOption(opts: TraineeUniqueSkillOption[]): TraineeUniqueSkillOption {
  return opts.reduce((a, b) => {
    if (b.min_star_rank !== a.min_star_rank) return b.min_star_rank > a.min_star_rank ? b : a
    return b.sort_order > a.sort_order ? b : a
  })
}

function StarsInline({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 1, alignItems: 'center' }}>
      {([1, 2, 3] as const).map(i => (
        <button
          key={i}
          type="button"
          onClick={() => onChange(i)}
          aria-label={`${i} star${i > 1 ? 's' : ''}`}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '0 0.12rem',
            lineHeight: 1,
            fontSize: '1rem',
            color: i <= value ? '#fbbf24' : '#27272a',
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}

function FactorBarRow({ hue, label, children }: { hue: 'blue' | 'pink' | 'green' | 'white'; label: string; children: React.ReactNode }) {
  const bg = {
    blue: 'linear-gradient(90deg, rgba(96,165,250,0.4) 0%, rgba(96,165,250,0.14) 100%)',
    pink: 'linear-gradient(90deg, rgba(244,114,182,0.42) 0%, rgba(244,114,182,0.14) 100%)',
    green: 'linear-gradient(90deg, rgba(74,222,128,0.4) 0%, rgba(74,222,128,0.14) 100%)',
    white: 'linear-gradient(90deg, rgba(244,244,245,0.28) 0%, rgba(244,244,245,0.08) 100%)',
  }[hue]
  const border = {
    blue: 'rgba(96,165,250,0.45)',
    pink: 'rgba(244,114,182,0.45)',
    green: 'rgba(74,222,128,0.45)',
    white: 'rgba(244,244,245,0.22)',
  }[hue]
  return (
    <div style={{ marginBottom: '0.4rem' }}>
      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#71717a', marginBottom: 4, letterSpacing: '0.04em' }}>{label}</div>
      <div style={{
        borderRadius: 12,
        padding: '0.5rem 0.6rem',
        background: bg,
        border: `1px solid ${border}`,
        minHeight: 40,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.5rem',
      }}>
        {children}
      </div>
    </div>
  )
}

interface LegacyMemberPanelProps {
  slotKey: LegacySlotKey
  memberKey: LegacyMemberKey
  member: LegacyMember
  runnerTraineeId: number | null
  /** Slot parent id; used with grandparents for 3-way succession scoring. */
  slotParentTraineeId: number | null
  successionData: SuccessionData | null
  /** Parsed from DB when a portrait is linked (can be multiple star-gated uniques). */
  uniqueSkillOptions: TraineeUniqueSkillOption[]
  trainees: TraineeLite[]
  aptitudeNames: string[]
  scenarioNames: string[]
  raceOptions: RaceOption[]
  skillNameById: Record<number, string>
  statNames: string[]
  getArtUrl: (trainee: Pick<TraineeLite, 'id' | 'icon_path' | 'image_path'>) => string
  inputStyle: CSSProperties
  selectStyle: CSSProperties
  dropdownStyle: CSSProperties
  dropdownItemStyle: CSSProperties
  patchMemberFactors: (slot: LegacySlotKey, mk: LegacyMemberKey, fn: (f: Factor[]) => Factor[]) => void
  setLegacyMemberName: (slot: LegacySlotKey, mk: LegacyMemberKey, name: string) => void
  setLegacyMemberTrainee: (slot: LegacySlotKey, mk: LegacyMemberKey, id: number | null) => void
  cacheSkillNames: (m: Record<number, string>) => void
}

export function LegacyMemberPanel({
  slotKey,
  memberKey,
  member,
  runnerTraineeId,
  slotParentTraineeId,
  successionData,
  uniqueSkillOptions,
  trainees,
  aptitudeNames,
  scenarioNames,
  raceOptions,
  skillNameById,
  statNames,
  getArtUrl,
  inputStyle,
  selectStyle,
  dropdownStyle,
  dropdownItemStyle,
  patchMemberFactors,
  setLegacyMemberName,
  setLegacyMemberTrainee,
  cacheSkillNames,
}: LegacyMemberPanelProps) {
  const memberLabel = memberKey === 'parent' ? 'Parent' : memberKey === 'grandparent_1' ? 'Grandparent 1' : 'Grandparent 2'
  const linked = member.trainee_id != null ? trainees.find(t => t.id === member.trainee_id) : null
  const displayName = (linked?.name || member.name || 'Legacy member').trim() || 'Legacy member'
  const subtitle = linked?.title ?? memberLabel
  const successionAff =
    successionData && runnerTraineeId != null && member.trainee_id != null
      ? lookupSparkAffinity(
          successionData,
          runnerTraineeId,
          member.trainee_id,
          memberKey !== 'parent' ? slotParentTraineeId : null,
        )
      : undefined

  const blue = member.factors.find((f): f is Extract<Factor, { type: 'BlueStat' }> => f.type === 'BlueStat')
  const pink = member.factors.find((f): f is Extract<Factor, { type: 'Aptitude' }> => f.type === 'Aptitude')
  const green = member.factors.find((f): f is Extract<Factor, { type: 'UniqueSkill' }> => f.type === 'UniqueSkill')
  const whites = member.factors
    .map((f, i) => ({ f, i }))
    .filter((x): x is { f: Extract<Factor, { type: 'SkillHint' | 'RaceBonus' | 'Scenario' }>; i: number } =>
      x.f.type === 'SkillHint' || x.f.type === 'RaceBonus' || x.f.type === 'Scenario')

  const [blueStatIdx, setBlueStatIdx] = useState(blue?.stat_index ?? 0)
  const [blueStarsDraft, setBlueStarsDraft] = useState(blue?.stars ?? 1)
  const [pinkApt, setPinkApt] = useState(() => aptitudeNames[0] ?? 'Turf')
  const [pinkStarsDraft, setPinkStarsDraft] = useState(pink?.stars ?? 1)
  const [greenSearch, setGreenSearch] = useState('')
  const [greenHits, setGreenHits] = useState<{ id: number; name: string }[]>([])
  const [greenOpen, setGreenOpen] = useState(false)
  const [greenStarsDraft, setGreenStarsDraft] = useState(green?.stars ?? 1)
  /** When no green chip yet but DB options exist, controlled pick for auto-commit on change. */
  const [greenDraftSkillId, setGreenDraftSkillId] = useState<number | null>(null)
  const greenBoxRef = useRef<HTMLDivElement>(null)

  const [whitePickerOpen, setWhitePickerOpen] = useState(false)
  const [whiteMode, setWhiteMode] = useState<'skill' | 'race' | 'scenario'>('skill')
  const [whiteSearch, setWhiteSearch] = useState('')
  const [whiteSkillHits, setWhiteSkillHits] = useState<{ id: number; name: string }[]>([])
  const [whiteOpen, setWhiteOpen] = useState(false)
  const [whiteStarsDraft, setWhiteStarsDraft] = useState(1)
  const whiteBoxRef = useRef<HTMLDivElement>(null)

  const effectivePinkApt = aptitudeNames.includes(pinkApt) ? pinkApt : (aptitudeNames[0] ?? 'Turf')
  const pinkSelectValue = pink
    ? (aptitudeNames.includes(pink.apt_name) ? pink.apt_name : effectivePinkApt)
    : effectivePinkApt

  const effectiveGreenDraftId = useMemo(() => {
    if (green != null || uniqueSkillOptions.length === 0) return null
    const def = pickDefaultUniqueOption(uniqueSkillOptions).skill_id
    if (greenDraftSkillId != null && uniqueSkillOptions.some(o => o.skill_id === greenDraftSkillId)) {
      return greenDraftSkillId
    }
    return def
  }, [green, uniqueSkillOptions, greenDraftSkillId])

  useEffect(() => {
    let cancelled = false
    const q = greenSearch.trim()
    const delayMs = q.length < 1 ? 0 : 200
    const t = window.setTimeout(() => {
      if (cancelled) return
      if (q.length < 1) {
        setGreenHits([])
        return
      }
      void (async () => {
        const { data } = await supabase.from('skills').select('id, name').ilike('name', `%${q}%`).order('name').limit(20)
        if (!cancelled) {
          setGreenHits((data ?? []).map((r: { id: number; name: string }) => ({ id: Number(r.id), name: r.name })))
        }
      })()
    }, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [greenSearch])

  useEffect(() => {
    let cancelled = false
    const q = whiteSearch.trim()
    const idle = whiteMode !== 'skill' || q.length < 1
    const delayMs = idle ? 0 : 200
    const t = window.setTimeout(() => {
      if (cancelled) return
      if (whiteMode !== 'skill' || q.length < 1) {
        setWhiteSkillHits([])
        return
      }
      void (async () => {
        const { data } = await supabase.from('skills').select('id, name').ilike('name', `%${q}%`).order('name').limit(20)
        if (!cancelled) {
          setWhiteSkillHits((data ?? []).map((r: { id: number; name: string }) => ({ id: Number(r.id), name: r.name })))
        }
      })()
    }, delayMs)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [whiteSearch, whiteMode])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (greenBoxRef.current && !greenBoxRef.current.contains(e.target as Node)) setGreenOpen(false)
      if (whiteBoxRef.current && !whiteBoxRef.current.contains(e.target as Node)) setWhiteOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  /** When portrait / DB options change, default green to highest star-gated unique; do not fight user remove on same selection. */
  const greenAutoSyncRef = useRef<{ traineeId: number | null; optionsKey: string }>({ traineeId: null, optionsKey: '' })
  useLayoutEffect(() => {
    const tid = member.trainee_id ?? null
    if (tid == null) {
      greenAutoSyncRef.current = { traineeId: null, optionsKey: '' }
      return
    }
    if (uniqueSkillOptions.length === 0) return

    const optionsKey = uniqueSkillOptions.map(o => o.skill_id).join(',')
    const cacheKey = `${tid}:${optionsKey}`
    if (
      greenAutoSyncRef.current.traineeId === tid
      && greenAutoSyncRef.current.optionsKey === cacheKey
    ) {
      return
    }
    greenAutoSyncRef.current = { traineeId: tid, optionsKey: cacheKey }

    patchMemberFactors(slotKey, memberKey, factors => {
      const greenF = factors.find((f): f is Extract<Factor, { type: 'UniqueSkill' }> => f.type === 'UniqueSkill')
      const valid = greenF != null && uniqueSkillOptions.some(o => o.skill_id === greenF.skill_id)
      if (valid) return factors
      const pick = pickDefaultUniqueOption(uniqueSkillOptions)
      const rest = factors.filter(f => f.type !== 'UniqueSkill')
      return normalizeMemberFactors([
        ...rest,
        { type: 'UniqueSkill', skill_id: pick.skill_id, stars: greenF?.stars ?? 3 },
      ])
    })
  }, [member.trainee_id, uniqueSkillOptions, slotKey, memberKey, patchMemberFactors])

  const removeFactorAt = (globalIndex: number) => {
    patchMemberFactors(slotKey, memberKey, factors => {
      const next = [...factors]
      next.splice(globalIndex, 1)
      return next
    })
  }

  const setGreenStars = (stars: number) => {
    if (!green) return
    patchMemberFactors(slotKey, memberKey, factors => {
      const rest = factors.filter(x => x.type !== 'UniqueSkill')
      return [...rest, { type: 'UniqueSkill', skill_id: green.skill_id, stars }]
    })
  }

  const setWhiteLineStars = (globalIdx: number, stars: number) => {
    patchMemberFactors(slotKey, memberKey, factors =>
      factors.map((f, i) => {
        if (i !== globalIdx) return f
        if (f.type === 'SkillHint') return { ...f, stars }
        if (f.type === 'RaceBonus') return { ...f, stars }
        if (f.type === 'Scenario') return { ...f, stars }
        return f
      }),
    )
  }

  const filteredRaces =
    whiteMode === 'race'
      ? raceOptions.filter(r => r.name_en.toLowerCase().includes(whiteSearch.trim().toLowerCase())).slice(0, 22)
      : []

  const filteredScenarios =
    whiteMode === 'scenario'
      ? scenarioNames.filter(n => n.toLowerCase().includes(whiteSearch.trim().toLowerCase())).slice(0, 22)
      : []

  const portraitUrl = linked ? getArtUrl(linked) : null

  return (
    <div style={{
      marginBottom: '1rem', padding: '0.75rem', borderRadius: 16,
      background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.07)',
    }}>
      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginBottom: '0.65rem' }}>
        <div style={{
          width: 52, height: 52, borderRadius: 12, flexShrink: 0,
          background: 'rgba(255,255,255,0.06)',
          overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {portraitUrl
            ? (
                <img src={portraitUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => (e.currentTarget.style.display = 'none')} />
              )
            : (
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#52525b' }}>
                  {displayName.charAt(0).toUpperCase()}
                </span>
              )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fafafa', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{displayName}</span>
            {successionAff && (
              <span title="Succession vs runner (mid-run spark rate)" style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 900 }}>
                {SPARK_AFFINITY_SYMBOL[successionAff]}
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.7rem', color: '#71717a', marginTop: 2 }}>{subtitle}</div>
          <select
            value={member.trainee_id ?? ''}
            onChange={e => {
              const v = e.target.value
              setLegacyMemberTrainee(slotKey, memberKey, v === '' ? null : Number(v))
            }}
            style={{ ...selectStyle, marginTop: 6, width: '100%', maxWidth: 280, fontSize: '0.72rem' }}
          >
            <option value="">Link portrait (optional)…</option>
            {trainees.map(t => (
              <option key={t.id} value={t.id}>{t.name}{t.title ? ` — ${t.title}` : ''}</option>
            ))}
          </select>
          <input
            placeholder="Custom name override"
            value={member.name}
            onChange={e => setLegacyMemberName(slotKey, memberKey, e.target.value)}
            style={{ ...inputStyle, marginTop: 6, fontSize: '0.72rem', padding: '0.35rem 0.5rem' }}
          />
        </div>
      </div>

      <FactorBarRow hue="blue" label="BLUE · STATS">
        <>
          <select
            value={blue?.stat_index ?? blueStatIdx}
            onChange={e => {
              const v = Number(e.target.value)
              setBlueStatIdx(v)
              const stars = blue?.stars ?? blueStarsDraft
              patchMemberFactors(slotKey, memberKey, factors => {
                const rest = factors.filter(x => x.type !== 'BlueStat')
                return [...rest, { type: 'BlueStat', stat_index: v, stars }]
              })
            }}
            style={{ ...selectStyle, flex: '1 1 120px' }}
          >
            {statNames.map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
          <StarsInline
            value={blue?.stars ?? blueStarsDraft}
            onChange={s => {
              setBlueStarsDraft(s)
              const idx = blue?.stat_index ?? blueStatIdx
              patchMemberFactors(slotKey, memberKey, factors => {
                const rest = factors.filter(x => x.type !== 'BlueStat')
                return [...rest, { type: 'BlueStat', stat_index: idx, stars: s }]
              })
            }}
          />
        </>
      </FactorBarRow>

      <FactorBarRow hue="pink" label="PINK · APTITUDE">
        <>
          <select
            value={pinkSelectValue}
            onChange={e => {
              const apt = e.target.value
              setPinkApt(apt)
              const stars = pink?.stars ?? pinkStarsDraft
              patchMemberFactors(slotKey, memberKey, factors => {
                const rest = factors.filter(x => x.type !== 'Aptitude')
                return [...rest, { type: 'Aptitude', apt_name: apt, stars }]
              })
            }}
            style={{ ...selectStyle, flex: '1 1 140px' }}
          >
            {aptitudeNames.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <StarsInline
            value={pink?.stars ?? pinkStarsDraft}
            onChange={s => {
              setPinkStarsDraft(s)
              const apt = pink?.apt_name ?? effectivePinkApt
              patchMemberFactors(slotKey, memberKey, factors => {
                const rest = factors.filter(x => x.type !== 'Aptitude')
                return [...rest, { type: 'Aptitude', apt_name: apt, stars: s }]
              })
            }}
          />
        </>
      </FactorBarRow>

      <FactorBarRow hue="green" label="GREEN · UNIQUE">
        {uniqueSkillOptions.length > 0 && green
          ? (
              <>
                {uniqueSkillOptions.length >= 2
                  ? (
                      <select
                        value={green.skill_id}
                        onChange={e => {
                          const id = Number(e.target.value)
                          const o = uniqueSkillOptions.find(x => x.skill_id === id)
                          if (o) cacheSkillNames({ [id]: o.name })
                          patchMemberFactors(slotKey, memberKey, factors => {
                            const rest = factors.filter(x => x.type !== 'UniqueSkill')
                            return normalizeMemberFactors([
                              ...rest,
                              { type: 'UniqueSkill', skill_id: id, stars: green.stars },
                            ])
                          })
                        }}
                        style={{ ...selectStyle, flex: '1 1 220px', fontSize: '0.72rem' }}
                        aria-label="Unique skill by star rank"
                      >
                        {uniqueSkillOptions.map(o => (
                          <option key={o.skill_id} value={o.skill_id}>
                            {o.min_star_rank}
                            ★+ — 
                            {o.name}
                          </option>
                        ))}
                      </select>
                    )
                  : (
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#bbf7d0', flex: '1 1 120px' }}>
                        {uniqueSkillOptions[0].min_star_rank}
                        ★+ — 
                        {uniqueSkillOptions[0].name}
                      </span>
                    )}
                <StarsInline value={green.stars} onChange={setGreenStars} />
              </>
            )
          : uniqueSkillOptions.length > 0 && !green
            ? (
                <>
                  <select
                    value={effectiveGreenDraftId ?? pickDefaultUniqueOption(uniqueSkillOptions).skill_id}
                    onChange={e => {
                      const id = Number(e.target.value)
                      setGreenDraftSkillId(id)
                      const o = uniqueSkillOptions.find(x => x.skill_id === id)
                      if (o) cacheSkillNames({ [id]: o.name })
                      patchMemberFactors(slotKey, memberKey, factors => {
                        const rest = factors.filter(x => x.type !== 'UniqueSkill')
                        return normalizeMemberFactors([
                          ...rest,
                          { type: 'UniqueSkill', skill_id: id, stars: greenStarsDraft },
                        ])
                      })
                    }}
                    style={{ ...selectStyle, flex: '1 1 220px', fontSize: '0.72rem' }}
                    aria-label="Choose unique skill"
                  >
                    {uniqueSkillOptions.map(o => (
                      <option key={o.skill_id} value={o.skill_id}>
                        {o.min_star_rank}
                        ★+ — 
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <StarsInline
                    value={greenStarsDraft}
                    onChange={s => {
                      setGreenStarsDraft(s)
                      const id = effectiveGreenDraftId ?? pickDefaultUniqueOption(uniqueSkillOptions).skill_id
                      const o = uniqueSkillOptions.find(x => x.skill_id === id)
                      if (o) cacheSkillNames({ [id]: o.name })
                      patchMemberFactors(slotKey, memberKey, factors => {
                        const rest = factors.filter(x => x.type !== 'UniqueSkill')
                        return normalizeMemberFactors([
                          ...rest,
                          { type: 'UniqueSkill', skill_id: id, stars: s },
                        ])
                      })
                    }}
                  />
                </>
              )
            : green
              ? (
                  <>
                    <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#bbf7d0', flex: '1 1 120px' }}>
                      {skillNameById[green.skill_id] ?? `Skill #${green.skill_id}`}
                    </span>
                    <StarsInline value={green.stars} onChange={setGreenStars} />
                  </>
                )
              : (
                  <div ref={greenBoxRef} style={{ position: 'relative', width: '100%' }}>
                    <input
                      placeholder="Search skills…"
                      value={greenSearch}
                      onChange={e => { setGreenSearch(e.target.value); setGreenOpen(true) }}
                      onFocus={() => setGreenOpen(true)}
                      style={{ ...inputStyle, fontSize: '0.78rem', padding: '0.4rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
                    />
                    {greenOpen && greenHits.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 25, maxHeight: 160, overflow: 'auto', ...dropdownStyle }}>
                        {greenHits.map(h => (
                          <div
                            key={h.id}
                            onMouseDown={e => e.preventDefault()}
                            onClick={() => {
                              cacheSkillNames({ [h.id]: h.name })
                              patchMemberFactors(slotKey, memberKey, factors => {
                                const rest = factors.filter(x => x.type !== 'UniqueSkill')
                                return normalizeMemberFactors([
                                  ...rest,
                                  { type: 'UniqueSkill', skill_id: h.id, stars: greenStarsDraft },
                                ])
                              })
                              setGreenSearch('')
                              setGreenHits([])
                              setGreenOpen(false)
                            }}
                            style={dropdownItemStyle}
                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          >
                            <span style={{ fontSize: '0.75rem', color: '#e4e4e7' }}>{h.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: 6 }}>
                      <span style={{ fontSize: '0.62rem', color: '#71717a' }}>Stars</span>
                      <StarsInline value={greenStarsDraft} onChange={setGreenStarsDraft} />
                    </div>
                  </div>
                )}
      </FactorBarRow>

      {whites.map(({ f, i }) => (
        <FactorBarRow key={`w-${i}`} hue="white" label="WHITE · SKILL / RACE / SCENARIO">
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e4e4e7', flex: '1 1 100px' }}>
            {f.type === 'SkillHint'
              ? (skillNameById[f.skill_id] ?? `Skill #${f.skill_id}`)
              : f.type === 'RaceBonus'
                ? f.race_name
                : f.name}
          </span>
          <span style={{ fontSize: '0.6rem', color: '#71717a' }}>
            {f.type === 'SkillHint' ? 'skill' : f.type === 'RaceBonus' ? 'race' : 'scenario'}
          </span>
          <StarsInline value={f.stars} onChange={s => setWhiteLineStars(i, s)} />
          <button type="button" onClick={() => removeFactorAt(i)} style={chipRemoveBtn}>×</button>
        </FactorBarRow>
      ))}

      {whitePickerOpen && (
        <div ref={whiteBoxRef} style={{ marginBottom: '0.5rem', padding: '0.5rem', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
            {(['skill', 'race', 'scenario'] as const).map(mode => (
              <button
                key={mode}
                type="button"
                onClick={() => { setWhiteMode(mode); setWhiteOpen(false) }}
                style={{
                  padding: '0.25rem 0.5rem', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.7rem', fontWeight: 600,
                  background: whiteMode === mode ? 'rgba(244,244,245,0.12)' : 'rgba(255,255,255,0.05)',
                  color: whiteMode === mode ? '#fff' : '#71717a',
                }}
              >
                {mode === 'skill' ? 'Skill' : mode === 'race' ? 'Race' : 'Scenario'}
              </button>
            ))}
          </div>
          <input
            placeholder={
              whiteMode === 'skill'
                ? 'Search skills…'
                : whiteMode === 'race'
                  ? 'Filter races…'
                  : 'Filter scenarios…'
            }
            value={whiteSearch}
            onChange={e => { setWhiteSearch(e.target.value); setWhiteOpen(true) }}
            onFocus={() => setWhiteOpen(true)}
            style={{ ...inputStyle, fontSize: '0.78rem', padding: '0.4rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
          />
          {whiteMode === 'skill' && whiteOpen && whiteSkillHits.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 140, overflow: 'auto', ...dropdownStyle }}>
              {whiteSkillHits.map(h => (
                <div
                  key={h.id}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    cacheSkillNames({ [h.id]: h.name })
                    patchMemberFactors(slotKey, memberKey, factors => [...factors, { type: 'SkillHint', skill_id: h.id, stars: whiteStarsDraft }])
                    setWhiteSearch('')
                    setWhiteSkillHits([])
                    setWhiteOpen(false)
                    setWhitePickerOpen(false)
                  }}
                  style={dropdownItemStyle}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: '0.75rem', color: '#e4e4e7' }}>{h.name}</span>
                </div>
              ))}
            </div>
          )}
          {whiteMode === 'race' && whiteOpen && filteredRaces.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 140, overflow: 'auto', ...dropdownStyle }}>
              {filteredRaces.map(r => (
                <div
                  key={r.id}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    patchMemberFactors(slotKey, memberKey, factors => [...factors, { type: 'RaceBonus', race_name: r.name_en, stars: whiteStarsDraft }])
                    setWhiteSearch('')
                    setWhiteOpen(false)
                    setWhitePickerOpen(false)
                  }}
                  style={dropdownItemStyle}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: '0.75rem', color: '#e4e4e7' }}>{r.name_en}</span>
                </div>
              ))}
            </div>
          )}
          {whiteMode === 'scenario' && whiteOpen && filteredScenarios.length > 0 && (
            <div style={{ marginTop: 6, maxHeight: 140, overflow: 'auto', ...dropdownStyle }}>
              {filteredScenarios.map(name => (
                <div
                  key={name}
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    patchMemberFactors(slotKey, memberKey, factors => [...factors, { type: 'Scenario', name, stars: whiteStarsDraft }])
                    setWhiteSearch('')
                    setWhiteOpen(false)
                    setWhitePickerOpen(false)
                  }}
                  style={dropdownItemStyle}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                >
                  <span style={{ fontSize: '0.75rem', color: '#e4e4e7' }}>{name}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: 8 }}>
            <span style={{ fontSize: '0.62rem', color: '#71717a' }}>Stars</span>
            <StarsInline value={whiteStarsDraft} onChange={setWhiteStarsDraft} />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setWhitePickerOpen(v => !v)}
        style={{
          width: '100%',
          padding: '0.65rem',
          borderRadius: 12,
          border: '2px dashed rgba(255,255,255,0.25)',
          background: 'rgba(255,255,255,0.03)',
          cursor: 'pointer',
          color: '#e4e4e7',
          fontSize: '1.5rem',
          lineHeight: 1,
          fontWeight: 300,
        }}
        aria-label={whitePickerOpen ? 'Close add white factor' : 'Add white factor'}
      >
        +
      </button>
    </div>
  )
}
