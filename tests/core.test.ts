import { expect, test } from 'claude-code/testing'

import {
  EMPTY_VIEW,
  backoff,
  describe as describeView,
  emptyFeed,
  feed,
  lineKind,
  openLine,
  parseMarker,
  pctSegments,
  shouldStop,
  statusOf,
} from '../hooks/core'

const SEP = '\x1f'

test('\\r: si tiene l ultimo segmento e la riga aperta si aggiorna', async () => {
  let r = feed(emptyFeed(), 'inizio\n 10%|#  \r 50%|### \r')
  expect(r.feed.lines).toEqual(['inizio'])
  expect(openLine(r.feed)).toBe(' 50%|### ')
  r = feed(r.feed, ' 90%|#### \r100%|#####\n')
  expect(r.feed.lines).toEqual(['inizio', '100%|#####'])
  expect(openLine(r.feed)).toBe('')
})

test('\\r\\n finale non cancella la riga; ANSI tolti', async () => {
  const r = feed(emptyFeed(), '\x1b[31mrosso\x1b[0m\r\n\x1b[2K\rdopo\r\n')
  expect(r.feed.lines).toEqual(['rosso', 'dopo'])
})

test('le righe marcate escono come eventi, anche spezzate e dentro una riga aperta', async () => {
  let r = feed(emptyFeed(), 'barra 40%\r\x1eFILE /home/u/prove/a/gen.log' + SEP + '12')
  expect(r.events).toEqual([])
  r = feed(r.feed, '\n\x1eSTATO 1' + SEP + '100' + SEP + '160' + SEP + 'x (pid 3, dalle 10:00:00)' + SEP + '74, 5763, 16376\nok\n')
  expect(r.events).toEqual([
    { kind: 'FILE', path: '/home/u/prove/a/gen.log', age: 12 },
    {
      kind: 'STATO',
      live: true,
      lockAge: 60,
      lock: 'x (pid 3, dalle 10:00:00)',
      gpu: { util: 74, used: 5763, total: 16376 },
    },
  ])
  expect(r.feed.lines).toEqual(['ok'])
})

test('parseMarker ignora il resto', async () => {
  expect(parseMarker('BOH')).toBeNull()
  expect(parseMarker('STATO 0' + SEP + '0' + SEP + '0' + SEP + SEP)?.kind).toBe('STATO')
})

test('colori come lab-log', async () => {
  expect(lineKind('Traceback (most recent call last)')).toBe('error')
  expect(lineKind('ERRORE generazione')).toBe('error')
  expect(lineKind('Guidance scale ignored')).toBe('warn')
  expect(lineKind('Fatto in 12 s')).toBe('done')
  expect(lineKind('modello pronto')).toBe('done')
  expect(lineKind('-- scarico')).toBe('head')
  expect(lineKind('== img 10:00')).toBe('head')
  expect(lineKind('step 3/20')).toBe('plain')
  expect(pctSegments('a 50% b 7,5% c').filter(s => s.pct).map(s => s.text)).toEqual(['50%', '7,5%'])
})

test('fermarsi: serve lab-runner spento, GPU libera e fine da 2 min o 30 min fermo', async () => {
  const base = { runnerActive: false, lockLive: false as boolean | null, lastLine: 'Fatto in 3 s', now: 1_000_000, moveAt: 1_000_000 - 121_000 }
  expect(shouldStop(base)).toBe(true)
  expect(shouldStop({ ...base, moveAt: 1_000_000 - 100_000 })).toBe(false)
  expect(shouldStop({ ...base, runnerActive: true })).toBe(false)
  expect(shouldStop({ ...base, lockLive: true })).toBe(false)
  expect(shouldStop({ ...base, lockLive: null })).toBe(false)
  const idle = { ...base, lastLine: 'step 3/20', moveAt: 1_000_000 - 29 * 60_000 }
  expect(shouldStop(idle)).toBe(false)
  expect(shouldStop({ ...idle, moveAt: 1_000_000 - 30 * 60_000 })).toBe(true)
  expect(shouldStop({ ...idle, moveAt: 1_000_000 - 3 * 3_600_000, lockLive: true })).toBe(false)
})

test('attese di riconnessione', async () => {
  expect([0, 1, 2, 3, 9].map(backoff)).toEqual([15, 30, 60, 60, 60])
})

test('stato e vista', async () => {
  const v = {
    ...EMPTY_VIEW,
    conn: 'on' as const,
    file: '/home/ubuntusopra/prove/img2img/gen.log',
    lines: ['== img2img gen 10:00', '50% fatto?'],
    lastLineAt: 90_000,
    now: 100_000,
    gpu: { util: 74, used: 5763, total: 16376 },
    lockLive: true,
    lockText: 'spirula (pid 3, dalle 10:00:00)',
    lockAge: 3600,
    lockReadAt: 100_000,
  }
  expect(statusOf(v)).toBe('in corso')
  expect(statusOf({ ...v, lines: [...v.lines, 'Fatto in 5 s'] })).toBe('fatto')
  expect(statusOf({ ...v, open: 'ERRORE: boom' })).toBe('errore')
  expect(statusOf({ ...v, conn: 'off' })).toBe('fermo')
  const d = describeView({ ...v, conn: 'lost', retryIn: 30 }, 100, 14)
  expect(d.file).toBe('~/prove/img2img/gen.log')
  expect(d.lastText).toBe('ultima riga 10 s fa')
  expect(d.conn).toBe('connessione persa, riprovo tra 30s')
  expect(d.gpu).toBe('GPU 74% · VRAM 5,6/16,0 GiB · lock: spirula (pid 3, dalle 10:00:00) da 1 h 00')
  expect(describeView(v, 12, 1).rows.length).toBe(1)
  expect(describeView(v, 12, 14).rows[0]?.segs[0]?.text.length).toBe(12)
})
