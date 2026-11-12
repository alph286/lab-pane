export type LabGpu = { util: number; used: number; total: number }

export type LabView = {
  /** off = nessuna connessione, connecting, on, lost = ssh caduto (si riprova) */
  conn: 'off' | 'connecting' | 'on' | 'lost'
  /** percorso assoluto del log seguito sul lab */
  file: string | null
  /** ultime righe complete (già ripulite da ANSI e \r) */
  lines: string[]
  /** riga ancora aperta (senza \n) */
  open: string
  lastLineAt: number | null
  startedAt: number | null
  now: number
  gpu: LabGpu | null
  /** null = stato del lock non ancora letto */
  lockLive: boolean | null
  lockText: string
  /** da quanti secondi il lock è stato scritto, quando fu letto */
  lockAge: number | null
  lockReadAt: number | null
  retryIn: number | null
  err: string
  stopReason: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'lab-pane': { view: Shaped<LabView> }
  }
}
