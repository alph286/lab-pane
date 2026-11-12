import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'lab-pane',
  component: 'Pane',
  requestId: 'lab',
  props: {
    title: 'lab',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 24 },
    view: {},
  },
} as const

const STORED = {
  conn: 'on',
  file: '/home/ubuntusopra/prove/img2img/gen.log',
  lines: ['== img2img gen 10:00', 'passo 3/20 15%', 'Traceback boom'],
  open: '',
  lastLineAt: 1000,
  startedAt: 900,
  now: 5000,
  gpu: { util: 74, used: 5763, total: 16376 },
  lockLive: false,
  lockText: '',
  lockAge: null,
  lockReadAt: null,
  retryIn: null,
  err: '',
  stopReason: null,
}

test('il pannello mostra file, stato, GPU e righe', async ($, on) => {
  on('state.get', () => ({ value: { value: { shape: 'view-1', value: STORED }, version: 1 } }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /prove\/img2img\/gen\.log/ }))?.text).toBe('~/prove/img2img/gen.log')
    expect(await ui.find({ type: 'Text', text: /GPU 74%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Traceback boom/ })).toBeDefined()
    await ui.unmount()
  }
})

test('senza stato salvato il pannello e vuoto', async ($, on) => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Nessuna riga di log/ })).toBeDefined()
  await ui.unmount()
})
