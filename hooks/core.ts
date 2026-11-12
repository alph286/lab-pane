// Logica pura di lab-pane: nessun accesso a `$`, tutto testabile.
import type { LabGpu, LabView } from '../types'

export const MARK = '\x1e'
export const SEP = '\x1f'

export const EMPTY_VIEW: LabView = {
  conn: 'off',
  file: null,
  lines: [],
  open: '',
  lastLineAt: null,
  startedAt: null,
  now: 0,
  gpu: null,
  lockLive: null,
  lockText: '',
  lockAge: null,
  lockReadAt: null,
  retryIn: null,
  err: '',
  stopReason: null,
}

// ---------------------------------------------------------------- testo

const ANSI =
  // CSI, OSC (fino a BEL o ST), altre sequenze a due caratteri
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[@-Z\\-_]/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI, '')
}

/** Toglie ANSI e caratteri di controllo (tab diventa quattro spazi). */
export function clean(s: string): string {
  return (
    stripAnsi(s)
      .replace(/\t/g, '    ')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')
  )
}

/** Di una riga con \r tiene l'ultimo segmento non vuoto (un \r\n finale non cancella la riga). */
export function lastSegment(raw: string): string {
  const parts = raw.split('\r')
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = clean(parts[i] ?? '')
    if (p.trim() !== '') return p
  }
  return ''
}

// ---------------------------------------------------------------- flusso

export type Feed = {
  lines: string[]
  /** segmento corrente della riga aperta (dopo l'ultimo \r) */
  open: string
  /** ultimo segmento non vuoto prima di un \r: si mostra finché `open` è vuoto */
  held: string
  /** riga marcata in lettura (dopo \x1e, fino a \n), oppure null */
  marker: string | null
}

export type Marked =
  | { kind: 'FILE'; path: string; age: number | null }
  | {
      kind: 'STATO'
      live: boolean
      lockAge: number | null
      lock: string
      gpu: LabGpu | null
    }

export function emptyFeed(): Feed {
  return { lines: [], open: '', held: '', marker: null }
}

export function parseGpu(s: string): LabGpu | null {
  const m = s.trim().match(/^(\d+)\s*,\s*(\d+)\s*,\s*(\d+)$/)
  if (!m) return null
  return { util: Number(m[1]), used: Number(m[2]), total: Number(m[3]) }
}

export function parseMarker(s: string): Marked | null {
  if (s.startsWith('FILE ')) {
    const [path, age] = s.slice(5).split(SEP)
    if (!path) return null
    const n = Number(age)
    return {
      kind: 'FILE',
      path,
      age: age !== undefined && age !== '' && Number.isFinite(n) ? Math.max(0, n) : null,
    }
  }
  if (s.startsWith('STATO ')) {
    const [live, mtime, now, lock, gpu] = s.slice(6).split(SEP)
    const m = Number(mtime)
    const n = Number(now)
    const ok = Number.isFinite(m) && Number.isFinite(n) && m > 0 && n > 0
    return {
      kind: 'STATO',
      live: live === '1',
      lockAge: ok ? Math.max(0, n - m) : null,
      lock: (lock ?? '').trim(),
      gpu: parseGpu(gpu ?? ''),
    }
  }
  return null
}

/**
 * Aggiunge un pezzo di output. Le righe marcate (\x1e... fino a \n) escono come eventi e
 * non toccano la riga aperta; \r tiene l'ultimo segmento; tutto il resto è testo del log.
 * `gotText` dice se è arrivato testo del log (non una riga marcata).
 */
export function feed(
  f: Feed,
  text: string,
  max = 80,
): { feed: Feed; events: Marked[]; gotText: boolean } {
  const lines = f.lines.slice()
  let { open, held, marker } = f
  const events: Marked[] = []
  let gotText = false
  for (const ch of text) {
    if (marker !== null) {
      if (ch === '\n') {
        const ev = parseMarker(marker)
        if (ev) events.push(ev)
        marker = null
      } else marker += ch
      continue
    }
    if (ch === MARK) {
      marker = ''
    } else if (ch === '\n') {
      const line = open !== '' && clean(open).trim() !== '' ? clean(open) : lastSegment(held)
      if (line.trim() !== '') lines.push(line)
      open = ''
      held = ''
      gotText = true
    } else if (ch === '\r') {
      if (clean(open).trim() !== '') held = open
      open = ''
      gotText = true
    } else {
      open += ch
      gotText = true
      if (open.length > 4000) open = open.slice(-2000)
    }
  }
  if (marker !== null && marker.length > 8000) marker = null
  return {
    feed: { lines: lines.slice(-max), open, held, marker },
    events,
    gotText,
  }
}

/** La riga ancora aperta come si mostra (vuota se non c'è nulla). */
export function openLine(f: { open: string; held?: string }): string {
  const o = clean(f.open)
  return o.trim() !== '' ? o : clean(f.held ?? '')
}

// ---------------------------------------------------------------- colori

export type LineKind = 'error' | 'warn' | 'done' | 'head' | 'plain'

export function lineKind(line: string): LineKind {
  if (/error|errore|traceback|exception|fallit|failed|killed|out of memory|non riuscit/i.test(line))
    return 'error'
  if (/warning|avviso|ignored|deprecat/i.test(line)) return 'warn'
  if (/^\s*(fatto|pronto|finito|done)\b|modello pronto|completat/i.test(line)) return 'done'
  if (/^\s*(--|==)/.test(line)) return 'head'
  return 'plain'
}

export type Seg = { text: string; pct: boolean }

/** Spezza una riga normale in pezzi, con le percentuali a parte. */
export function pctSegments(line: string): Seg[] {
  const out: Seg[] = []
  const re = /\d+(?:[.,]\d+)?%/g
  let last = 0
  for (const m of line.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: line.slice(last, i), pct: false })
    out.push({ text: m[0], pct: true })
    last = i + m[0].length
  }
  if (last < line.length) out.push({ text: line.slice(last), pct: false })
  return out.length ? out : [{ text: line, pct: false }]
}

/**
 * Avanzamento del lavoro (0-100) dall'ultima riga che ne porta uno: "37%" vince, se no "N/M".
 * null se nelle righe recenti non c'è; una riga di intestazione (== ...) segna un lavoro nuovo e ferma la ricerca.
 */
export function progressOf(v: Pick<LabView, 'lines' | 'open'>): number | null {
  const all = v.open.trim() !== '' ? [...v.lines, v.open] : v.lines
  for (let i = all.length - 1; i >= 0; i--) {
    const t = all[i] ?? ''
    const pcts = [...t.matchAll(/(\d+(?:[.,]\d+)?)%/g)]
    const last = pcts[pcts.length - 1]
    if (last) return Math.max(0, Math.min(100, parseFloat((last[1] ?? '0').replace(',', '.'))))
    const frac = t.match(/\b(\d+)\s*\/\s*(\d+)\b/)
    if (frac && Number(frac[2]) > 0) return Math.max(0, Math.min(100, (Number(frac[1]) / Number(frac[2])) * 100))
    if (/^\s*==/.test(t)) return null
  }
  return null
}

// ---------------------------------------------------------------- stato e fine

const END = /^\s*(Fatto|ERRORE|finito)\b/i

export function isEndLine(line: string): boolean {
  return END.test(line)
}

export function lastLineOf(v: Pick<LabView, 'lines' | 'open'>): string {
  const o = v.open.trim() !== '' ? v.open : ''
  return o || (v.lines[v.lines.length - 1] ?? '')
}

export type Status = 'in corso' | 'fatto' | 'errore' | 'fermo'

export const IDLE_STOP_MS = 30 * 60 * 1000
export const END_STOP_MS = 2 * 60 * 1000

export function statusOf(v: LabView): Status {
  const last = lastLineOf(v)
  if (isEndLine(last)) return /^\s*ERRORE/i.test(last) ? 'errore' : 'fatto'
  if (v.conn === 'off' || v.file === null) return 'fermo'
  const idle = v.lastLineAt !== null ? v.now - v.lastLineAt : 0
  if (v.lockLive === false && idle >= IDLE_STOP_MS) return 'fermo'
  return 'in corso'
}

/**
 * Quando la mod può fermarsi da sola: nessun lab-runner attivo, GPU libera (lock letto e non
 * tenuto) e una tra: ultima riga di fine da almeno 2 minuti, log fermo da 30 minuti.
 * `moveAt` è l'ultimo istante in cui il log si è mosso (o l'avvio della connessione).
 */
export function shouldStop(a: {
  runnerActive: boolean
  lockLive: boolean | null
  lastLine: string
  now: number
  moveAt: number
}): boolean {
  if (a.runnerActive) return false
  if (a.lockLive !== false) return false
  const idle = a.now - a.moveAt
  if (isEndLine(a.lastLine) && idle >= END_STOP_MS) return true
  return idle >= IDLE_STOP_MS
}

/** Attese di riconnessione in secondi: 15, 30, 60, poi sempre 60. */
export function backoff(attempt: number): number {
  return [15, 30, 60][attempt] ?? 60
}

// ---------------------------------------------------------------- testi

export function ago(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${String(m % 60).padStart(2, '0')}`
}

export function clip(s: string, n: number): string {
  if (n <= 0) return ''
  return s.length > n ? s.slice(0, Math.max(0, n - 1)) + '…' : s
}

/** Percorso relativo alla home del lab. */
export function homeRel(p: string): string {
  return p.replace(/^\/home\/[^/]+\//, '').replace(/^\/root\//, '')
}

function gib(mib: number): string {
  return (mib / 1024).toFixed(1).replace('.', ',')
}

export function gpuText(v: LabView): string {
  const g = v.gpu
  const parts: string[] = []
  parts.push(g ? `GPU ${g.util}%` : 'GPU ?')
  parts.push(g ? `VRAM ${gib(g.used)}/${gib(g.total)} GiB` : 'VRAM ?')
  if (v.lockLive === null) parts.push('lock ?')
  else if (!v.lockLive) parts.push('lock libero')
  else {
    let s = `lock: ${v.lockText || '?'}`
    if (v.lockAge !== null && v.lockReadAt !== null) {
      s += ` da ${ago(v.lockAge + Math.max(0, (v.now - v.lockReadAt) / 1000))}`
    }
    parts.push(s)
  }
  return parts.join(' · ')
}

export type Described = {
  file: string
  status: Status
  lastText: string
  conn: string | null
  stop: string | null
  gpu: string
  rows: { kind: LineKind; segs: Seg[] }[]
}

/** Tutto ciò che il pannello disegna, già tagliato alla larghezza. */
export function describe(v: LabView, cols: number, rows: number): Described {
  const c = Math.max(10, cols)
  const all = v.lines.slice()
  const o = openLine(v)
  if (o.trim() !== '') all.push(o)
  const shown = all.slice(-Math.max(1, rows)).map(l => {
    const t = clip(l, c)
    const kind = lineKind(t)
    return {
      kind,
      segs: kind === 'plain' ? pctSegments(t) : [{ text: t, pct: false }],
    }
  })
  let conn: string | null = null
  if (v.conn === 'lost') {
    conn = `connessione persa, riprovo tra ${v.retryIn ?? 0}s`
  } else if (v.conn === 'connecting') conn = 'mi collego al lab…'
  const last =
    v.lastLineAt === null
      ? 'nessuna riga ancora'
      : `ultima riga ${ago((v.now - v.lastLineAt) / 1000)} fa`
  return {
    file: clip(v.file ? '~/' + homeRel(v.file) : 'nessun log trovato', c),
    status: statusOf(v),
    lastText: last,
    conn: conn ? clip(conn, c) : null,
    stop: v.stopReason ? clip(v.stopReason, c) : null,
    gpu: clip(gpuText(v), c),
    rows: shown,
  }
}

// ---------------------------------------------------------------- comando remoto

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function validHost(h: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9._@:-]*$/.test(h)
}

/** Il ciclo che gira sul lab: solo lettura, muore per SIGPIPE quando ssh se ne va. */
export const REMOTE_SCRIPT = String.raw`
trap 'exit 0' PIPE HUP TERM INT
trap '[ -n "$pid" ] && kill $pid 2>/dev/null' EXIT
cur=""; pid=""; nx=0
NV=nvidia-smi
command -v nvidia-smi >/dev/null 2>&1 || NV=/usr/lib/wsl/lib/nvidia-smi
stato() {
  L="$HOME/prove/.gpu.lock"; live=0; txt=""; mt=0
  if [ -e "$L" ]; then
    txt=$(head -n 1 "$L" 2>/dev/null | head -c 300 | tr -d '\036\037')
    mt=$(stat -c %Y "$L" 2>/dev/null || echo 0)
    ino=$(stat -c %i "$L" 2>/dev/null)
    p=$(printf '%s' "$txt" | sed -n 's/.*(pid \([0-9][0-9]*\).*/\1/p')
    # /proc/locks decide; il pid scritto nel lock resta dopo il rilascio (e il servizio img2img
    # resta vivo), quindi serve solo se /proc/locks non si legge
    if [ -r /proc/locks ]; then
      awk -v i=":$ino" '$6 ~ (i "$") {f=1} END{exit !f}' /proc/locks && live=1
    elif [ -n "$p" ] && [ -d "/proc/$p" ]; then live=1; fi
  fi
  g=$(timeout 8 "$NV" --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits 2>/dev/null | head -n 1 | tr -d '\036\037')
  printf '\036STATO %s\037%s\037%s\037%s\037%s\n' "$live" "$mt" "$(date +%s)" "$txt" "$g"
}
while :; do
  if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then pid=""; cur="-"; fi
  f=""
  if [ -e "$HOME/log/corrente" ]; then f=$(readlink -f "$HOME/log/corrente" 2>/dev/null); fi
  if [ -z "$f" ] || [ ! -f "$f" ]; then f=$(ls -t "$HOME"/log/*/*.log 2>/dev/null | head -n 1); fi
  if [ -z "$f" ]; then f=$(ls -t "$HOME"/prove/*/*.log 2>/dev/null | head -n 1); fi
  if [ "$f" != "$cur" ]; then
    if [ -n "$pid" ]; then kill $pid 2>/dev/null; wait $pid 2>/dev/null; pid=""; fi
    cur="$f"
    if [ -n "$f" ]; then
      age=$(( $(date +%s) - $(stat -c %Y "$f" 2>/dev/null || echo 0) ))
      printf '\036FILE %s\037%s\n' "$f" "$age"
      tail -n 40 -F --pid=$$ "$f" 2>/dev/null &
      pid=$!
    fi
  fi
  n=$(date +%s)
  if [ "$n" -ge "$nx" ]; then stato; nx=$((n+15)); fi
  sleep 2
done
`

export function sshArgv(host: string): string[] {
  return [
    'ssh',
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=15',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    host,
    'bash -c ' + shq(REMOTE_SCRIPT),
  ]
}
