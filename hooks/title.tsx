// Titolo al neon, sull'orologio della superficie: solo questa riga si ridisegna.
// Ogni movimento dice qualcosa:
//  - un'onda di luce attraversa "LAB-RUNNERS" una volta per ogni riga nuova del log (il lab ha scritto);
//  - le lettere si guastano solo mentre il segnale è disturbato (ssh caduto, in riconnessione, o errore).
// Il resto è fermo, e la riga ha sempre la stessa larghezza: la scritta di stato non si sposta.
import type { ClientModule } from 'claude-code'

type Props = {
  text: string
  /** stato dopo il titolo, già in maiuscolo; resta fermo */
  tail: string
  /** cambia a ogni riga nuova del log (l'ora dell'ultima riga) */
  beat: number | null
  /** segnale disturbato */
  noisy: boolean
  base: string
  wave: string
  glitch: string
  tailColor: string
  frame: string
}
type Ref = { wave: number; beat: number | null; noisy: boolean; noise: number }
type State = { ref: Ref }

const STEP_MS = 60
const WAVE_LEN = 3
const GLITCH = '#$%&*+=<>?/\\|~^01'

function rnd(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

const Title: ClientModule<Props, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  const n = Array.from(props.text).length
  const ref = surface.state?.ref ?? { wave: -1, beat: props.beat, noisy: props.noisy, noise: 0 }
  // una riga nuova (non la prima lettura): parte un'onda
  if (props.beat !== ref.beat) {
    ref.beat = props.beat
    ref.wave = 0
  }
  ref.noisy = props.noisy
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      let changed = false
      if (ref.wave >= 0) {
        ref.wave += 1
        if (ref.wave > n + WAVE_LEN) ref.wave = -1
        changed = true
      }
      if (ref.noisy) {
        ref.noise += 1
        changed = true
      }
      if (changed) surface.setState({ ref })
    })
  }

  const k = Math.floor(ref.noise / 2)
  const cells = Array.from(props.text).map((ch, i) => {
    if (ref.noisy && ch !== ' ' && rnd(k * 31 + i) > 0.8) {
      return { ch: GLITCH[Math.floor(rnd(k * 7 + i) * GLITCH.length)] ?? ch, color: props.glitch }
    }
    const d = ref.wave - i
    if (ref.wave >= 0 && d === 0) return { ch, color: '#ffffff' }
    if (ref.wave >= 0 && d > 0 && d <= WAVE_LEN) return { ch, color: props.wave }
    return { ch, color: props.base }
  })
  // la cornice si accende mentre passa l'onda: cambia solo il colore, mai la larghezza
  const frameColor = ref.wave >= 0 ? props.wave : props.frame

  return (
    <Box justifyContent="center" width={Math.max(1, surface.columns)}>
      <Text wrap="truncate">
        <Text color={frameColor}>░▒▓ </Text>
        {cells.map(c => (
          <Text color={c.color} bold>
            {c.ch}
          </Text>
        ))}
        <Text color={frameColor}> ▓▒░</Text>
        {props.tail ? <Text color={props.tailColor} bold>{` ${props.tail}`}</Text> : null}
      </Text>
    </Box>
  )
}
export default Title
