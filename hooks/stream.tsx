// Barra di avanzamento sotto il titolo, sull'orologio della superficie. Ogni segno ha un significato:
//  - ━ pieno fin dove è arrivato il lavoro (l'ultima percentuale o N/M del log), ─ spento il resto;
//  - █ sul fronte: lampeggia mentre il lavoro è in corso, fermo quando è finito;
//  - ▶ un impulso per ogni riga nuova del log, che corre dall'inizio fino al fronte (dati arrivati).
// Senza un avanzamento noto la barra è tutta un canale spento e gli impulsi la attraversano intera.
import type { ClientModule, RenderChildren } from 'claude-code'

type Props = {
  /** 0-100, null se il log non ne porta */
  pct: number | null
  /** cambia a ogni riga nuova del log */
  beat: number | null
  /** il lavoro è in corso e la connessione viva */
  active: boolean
  width: number
  fill: string
  head: string
  pulse: string
  dim: string
}
type Ref = { pulses: number[]; beat: number | null; active: boolean; blink: number }
type State = { ref: Ref }

const STEP_MS = 40
const SPEED = 2 // celle per passo
const BLINK = 12 // passi per mezzo lampeggio (~0,5 s)

const Stream: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const width = Math.max(1, surface.columns || props.width)
  const front = props.pct === null ? width : Math.max(1, Math.round((props.pct / 100) * width))
  const ref = surface.state?.ref ?? { pulses: [], beat: props.beat, active: props.active, blink: 0 }
  if (props.beat !== ref.beat) {
    ref.beat = props.beat
    if (ref.pulses.length < 6) ref.pulses.push(0)
  }
  ref.active = props.active
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      let changed = false
      if (ref.pulses.length) {
        ref.pulses = ref.pulses.map(x => x + SPEED).filter(x => x < width + 1)
        changed = true
      }
      if (ref.active) {
        ref.blink += 1
        if (ref.blink % BLINK === 0) changed = true
      }
      if (changed) surface.setState({ ref })
    })
  }

  type Kind = 'fill' | 'rest' | 'head' | 'pulse'
  const cells: { ch: string; kind: Kind }[] = Array.from({ length: width }, (_, i) =>
    props.pct !== null && i < front ? { ch: '━', kind: 'fill' } : { ch: '─', kind: 'rest' },
  )
  if (props.pct !== null) {
    const on = !props.active || Math.floor(ref.blink / BLINK) % 2 === 0
    cells[front - 1] = { ch: on ? '█' : '▌', kind: 'head' }
  }
  for (const x of ref.pulses) {
    const stop = props.pct === null ? width : front - 1
    if (x < stop) cells[x] = { ch: '▶', kind: 'pulse' }
  }

  const color: Record<Kind, string> = { fill: props.fill, rest: props.dim, head: props.head, pulse: props.pulse }
  const runs: { text: string; kind: Kind }[] = []
  for (const c of cells) {
    const last = runs[runs.length - 1]
    if (last && last.kind === c.kind) last.text += c.ch
    else runs.push({ text: c.ch, kind: c.kind })
  }
  const line = (children: RenderChildren) => (
    <Box width={width} overflow="hidden">
      <Box flexShrink={0}>{children}</Box>
    </Box>
  )
  return line(
    runs.map(r => (
      <Text color={color[r.kind]} bold={r.kind !== 'rest'}>
        {r.text}
      </Text>
    )),
  )
}
export default Stream
