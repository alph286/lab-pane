import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LabView } from '../types'
import {
  EMPTY_VIEW,
  backoff,
  clip,
  describe,
  emptyFeed,
  feed,
  lastLineOf,
  openLine,
  shouldStop,
  sshArgv,
  validHost,
} from './core'
import type { Feed, Status } from './core'

const PANE = 'lab'
const TITLE = 'lab'

// Cambia l'etichetta quando cambiano i campi: lo stato salvato sopravvive ai reload.
const view = atom({ plugin: 'lab-pane', key: 'view' } as const, EMPTY_VIEW, {
  shape: 'view-1',
})

type Run = {
  cancelled: boolean
  wake: () => void
  stopStream: () => void
}

// Variabili del modulo: si perdono a un reload (la connessione muore con il modulo).
let run: Run | null = null
let live: LabView = { ...EMPTY_VIEW }
let buf: Feed = emptyFeed()
let ignoreTextUntil = 0
let flushing = false

const STATUS_COLOR: Record<Status, string> = {
  'in corso': 'suggestion',
  fatto: 'success',
  errore: 'error',
  fermo: 'inactive',
}

type Cfg = { host: string; rows: number; openOnLabRunner: boolean }
let cfg: Cfg = { host: 'lab', rows: 14, openOnLabRunner: true }


async function flush($: EngineInterface) {
  if (flushing) return
  flushing = true
  try {
    await $.clock.sleep(250)
    flushing = false
    live = { ...live, now: await $.clock.now() }
    const snap = live
    await update($, view, () => snap)
  } catch {
    flushing = false // modulo scaricato o chiamata rifiutata: niente da fare
  }
}

async function touch($: EngineInterface, patch: Partial<LabView>) {
  live = { ...live, ...patch }
  void flush($)
}

async function stop($: EngineInterface, reason: string | null) {
  const r = run
  run = null
  if (r) {
    r.cancelled = true
    r.stopStream()
    r.wake()
  }
  await touch($, { conn: 'off', retryIn: null, stopReason: reason })
}

async function runnerActive($: EngineInterface): Promise<boolean> {
  try {
    const list = await $.agent.list()
    return list.some(
      a =>
        a.type.endsWith('lab-runner') &&
        (a.status === 'pending' || a.status === 'running' || a.status === 'waiting'),
    )
  } catch {
    return true // nel dubbio non si ferma
  }
}

function handleEvents(
  $: EngineInterface,
  now: number,
  events: ReturnType<typeof feed>['events'],
  gotText: boolean,
) {
  const patch: Partial<LabView> = {}
  for (const ev of events) {
    if (ev.kind === 'FILE') {
      // un nuovo file (o una riconnessione): tail rimanda le ultime 40 righe, si riparte da zero
      buf = { ...emptyFeed(), marker: buf.marker }
      patch.file = ev.path
      patch.lastLineAt = ev.age === null ? now : now - ev.age * 1000
      ignoreTextUntil = now + 2000
      patch.stopReason = null
    } else {
      patch.gpu = ev.gpu
      patch.lockLive = ev.live
      patch.lockText = ev.live ? ev.lock : ''
      patch.lockAge = ev.lockAge
      patch.lockReadAt = now
    }
  }
  if (gotText && now >= ignoreTextUntil) patch.lastLineAt = now
  patch.lines = buf.lines
  patch.open = openLine(buf)
  live = { ...live, ...patch, now }
  void flush($)
}

async function connect($: EngineInterface, r: Run) {
  let attempt = 0
  while (!r.cancelled) {
    const startedAt = await $.clock.now()
    let gotAny = false
    let errText = ''
    buf = emptyFeed()
    await touch($, { conn: 'connecting', retryIn: null })
    try {
      const stream = $.process.spawn({ argv: sshArgv(cfg.host) })
      const it = stream[Symbol.asyncIterator]()
      const cancelled = new Promise<'stop'>(res => {
        r.wake = () => res('stop')
      })
      r.stopStream = () => {
        void it.return(undefined as never).catch(() => {})
      }
      while (!r.cancelled) {
        const got = await Promise.race([it.next(), cancelled])
        if (got === 'stop' || got.done) break
        const { stream: pipe, text } = got.value
        const now = await $.clock.now()
        if (pipe === 'stderr') {
          errText = clip(text.trim().split('\n').pop() ?? '', 120)
          continue
        }
        if (!gotAny) {
          gotAny = true
          attempt = 0
          live = { ...live, conn: 'on', err: '', startedAt }
        }
        const res = feed(buf, text)
        buf = res.feed
        handleEvents($, now, res.events, res.gotText)
      }
      r.stopStream()
    } catch (e) {
      errText = clip(String((e as Error)?.message ?? e), 120)
    }
    if (r.cancelled) return
    // caduta: attese crescenti 15, 30, 60, poi ogni 60 s
    const wait = backoff(attempt)
    attempt += 1
    for (let left = wait; left > 0 && !r.cancelled; left--) {
      await touch($, { conn: 'lost', retryIn: left, err: errText })
      await $.clock.sleep(1000)
    }
  }
}

async function start($: EngineInterface) {
  if (run) return
  if (!validHost(cfg.host)) {
    await touch($, { conn: 'off', stopReason: `host non valido: ${cfg.host}` })
    return
  }
  const r: Run = { cancelled: false, wake: () => {}, stopStream: () => {} }
  run = r
  const now = await $.clock.now()
  buf = emptyFeed()
  live = { ...live, startedAt: now, stopReason: null, err: '', now }
  // controllo periodico: ferma da sola quando il lavoro è davvero finito
  const tick = $.clock.every(3000, () => {
    void (async () => {
      if (r.cancelled) return
      const t = await $.clock.now()
      live = { ...live, now: t }
      const stopNow = shouldStop({
        runnerActive: await runnerActive($),
        lockLive: live.lockLive,
        lastLine: lastLineOf(live),
        now: t,
        moveAt: Math.max(live.lastLineAt ?? 0, live.startedAt ?? 0),
      })
      if (stopNow && !r.cancelled) {
        tick.cancel()
        await stop($, 'Lavoro finito: connessione chiusa.')
        return
      }
      void flush($)
    })().catch(() => {})
  })
  void connect($, r)
    .catch(() => {})
    .finally(() => tick.cancel())
}

async function open($: EngineInterface) {
  await $.ui.open({ id: PANE, title: TITLE })
}


export const register: Register = (on, options) => {
  cfg = {
    host: typeof options.host === 'string' && options.host ? options.host : 'lab',
    rows: typeof options.rows === 'number' && options.rows >= 1 ? Math.floor(options.rows) : 14,
    openOnLabRunner: options.openOnLabRunner !== false,
  }
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'lab',
      description: 'Apre il pannello con il log del lab in diretta (/lab stop ferma la connessione)',
    })
    // dopo un reload la connessione non c'è più: lo stato salvato si legge come fermo
    await update($, view, v => {
      live = { ...v, conn: 'off', retryIn: null, now: v.now }
      return live
    })
    return next(e)
  })

  on('command.run', { command: 'lab' }, async ($, e) => {
    if (e.args.trim() === 'stop') {
      await stop($, 'Fermato dalla persona.')
      return { text: 'Connessione al lab fermata.' }
    }
    await open($)
    if (!validHost(cfg.host)) return { text: `Host non valido nelle opzioni: ${cfg.host}` }
    await start($)
    return { text: `Pannello lab aperto, mi collego a ${cfg.host}.` }
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    const denied = (res as { deny?: unknown }).deny
    if (cfg.openOnLabRunner && !denied && e.subagentType.endsWith('lab-runner')) {
      await open($)
      await start($)
    }
    return res
  })

  on('ui.close', async ($, e, next) => {
    const res = await next(e)
    if (e.id === PANE && e.origin.kind === 'person') await stop($, null)
    return res
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const s: LabView = await read($, view)
    const cols = e.props.bodyColumns
    const room = Math.max(1, e.props.scroll.bodyRows - 5)
    const d = describe(s, cols, Math.min(cfg.rows, room))

    return (
      <Box flexDirection="column">
        <Text bold wrap="truncate">
          {d.file}
        </Text>
        <Text wrap="truncate">
          <Text color={STATUS_COLOR[d.status]} bold>
            {d.status}
          </Text>
          <Text dimColor> · {d.lastText}</Text>
        </Text>
        {d.conn && (
          <Text color="warning" wrap="truncate">
            {d.conn}
          </Text>
        )}
        {d.conn && s.err && (
          <Text dimColor wrap="truncate">
            {clip(s.err, cols)}
          </Text>
        )}
        {d.stop && (
          <Text dimColor wrap="truncate">
            {d.stop}
          </Text>
        )}
        <Text color="suggestion" wrap="truncate">
          {d.gpu}
        </Text>
        {d.rows.length === 0 && <Text dimColor>Nessuna riga di log.</Text>}
        {d.rows.map(r => {
          if (r.kind === 'error')
            return (
              <Text color="error" wrap="truncate">
                {r.segs[0]?.text}
              </Text>
            )
          if (r.kind === 'warn')
            return (
              <Text dimColor wrap="truncate">
                {r.segs[0]?.text}
              </Text>
            )
          if (r.kind === 'done')
            return (
              <Text color="success" bold wrap="truncate">
                {r.segs[0]?.text}
              </Text>
            )
          if (r.kind === 'head')
            return (
              <Text color="warning" bold wrap="truncate">
                {r.segs[0]?.text}
              </Text>
            )
          return (
            <Text wrap="truncate">
              {r.segs.map(g => (g.pct ? <Text color="suggestion">{g.text}</Text> : g.text))}
            </Text>
          )
        })}
      </Box>
    )
  })
}
