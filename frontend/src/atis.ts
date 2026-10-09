import { useEffect, useState } from 'react'
import { ATIS, FEED } from './config'

/** One D-ATIS broadcast. Busy airports have separate arrival and departure ATIS; others one combined. */
export interface Atis {
  type: 'arr' | 'dep' | 'combined'
  /** The information letter, e.g. "Y" (pilots report "with information Yankee"). */
  code: string
  /** Full broadcast text. */
  datis: string
}

/**
 * Digital ATIS from atis.info (formerly datis.clowd.io), which covers the larger
 * US airports. It allows browser requests, so no proxy is needed.
 */
async function fetchAtis(icao: string, signal: AbortSignal): Promise<Atis[]> {
  const res = await fetch(`https://atis.info/api/${icao}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(FEED.requestTimeoutMs)]),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  // Airports without D-ATIS return an error object instead of a list.
  return Array.isArray(data) ? data : []
}

/** Current ATIS broadcasts for `icao`, arrival first, refreshed every ATIS.refreshMs. */
export function useAtis(icao: string): Atis[] {
  const [atis, setAtis] = useState<Atis[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const load = () =>
      fetchAtis(icao, controller.signal)
        .then((list) => setAtis(list.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type))))
        .catch((err) => {
          if (!controller.signal.aborted) console.warn('ATIS unavailable:', err)
        })
    load()
    const id = setInterval(load, ATIS.refreshMs)
    return () => {
      controller.abort()
      clearInterval(id)
    }
  }, [icao])

  return atis
}

const ORDER: Atis['type'][] = ['arr', 'combined', 'dep']

/** Shorter pieces (e.g. "NOTICE TO AIRMEN") are joined to the sentence that follows. */
const MIN_SENTENCE_CHARS = 24

/** Splits the operational text into sentences to show one at a time. */
export function atisSentences(text: string): string[] {
  const sentences: string[] = []
  let pending = ''
  for (const part of atisBody(text).split(/\.{3}\s*|\.\s+/)) {
    const sentence = part
      .replace(/\.+$/, '')
      // Tidy the source's stray spacing and doubled commas ("C10 , , TWY").
      .replace(/(\s*,)+/g, ',')
      .replace(/\s+/g, ' ')
      .trim()
    if (!sentence) continue
    pending = pending ? `${pending}. ${sentence}` : sentence
    if (pending.length >= MIN_SENTENCE_CHARS) {
      sentences.push(pending)
      pending = ''
    }
  }
  if (pending) sentences.push(pending)
  return sentences
}

/**
 * The operational part of the broadcast: runways, approaches, closures and
 * notices. Drops the opening weather report (the METAR line already shows it)
 * and the closing "advise you have info X".
 */
function atisBody(text: string) {
  return (
    text
      // Header and weather run through the sentence containing the altimeter (A3000).
      .replace(/^.*?\bA\d{4}\b[^.]*\.\s*/, '')
      .replace(/\.*\s*\.\.\.\s*ADVS? YOU HAVE.*$/i, '')
      .trim()
  )
}
