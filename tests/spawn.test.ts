import { expect, mock, test } from 'claude-code/testing'

test('un lab-runner apre il pannello lab e avvia ssh; gli altri no', async ($, on) => {
  const clock = mock.clock(on)
  const opened: string[] = []
  const argvs: string[][] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('agent.spawn', () => ({ model: 'x', agentId: 'a1' }))
  on('agent.list', () => ({ value: [] }))
  on('process.spawn', async function* (_, e) {
    argvs.push([...e.argv])
    yield { stream: 'stdout' as const, text: '\x1eFILE /home/u/log/x/a.log\x1f3\nciao\n' }
    return { value: { code: 0, signal: null } }
  })

  await $.agent.spawn({ prompt: 'p', subagentType: 'general-purpose' })
  expect(opened).toEqual([])

  await $.agent.spawn({ prompt: 'p', subagentType: 'lab-runner' })
  expect(opened).toEqual(['lab'])
  await clock.advance(1000)
  expect(argvs[0]?.slice(0, 9)).toEqual([
    'ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=3',
  ])
  expect(argvs[0]?.[9]).toBe('lab')
})

test('/lab stop ferma la connessione', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.list', () => ({ value: [] }))
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '\x1eFILE /home/u/log/x/a.log\x1f3\n' }
    await new Promise(() => {})
    return { value: { code: 0, signal: null } }
  })
  const out = await $.command.run({ command: 'lab', args: '' })
  expect(JSON.stringify(out)).toContain('Pannello lab aperto')
  await clock.advance(1000)
  const stopped = await $.command.run({ command: 'lab', args: 'stop' })
  expect(JSON.stringify(stopped)).toContain('fermata')
})
