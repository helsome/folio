import { describe, expect, it } from 'bun:test'

describe('provider E2E runner guard', () => {
  function cleanEnv(overrides: Record<string, string>): Record<string, string> {
    const env = { ...process.env, ...overrides } as Record<string, string | undefined>
    delete env.MASSIVE_API_KEY
    delete env.POLYGON_API_KEY
    return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined)) as Record<string, string>
  }

  it('requires explicit opt-in before live requests', async () => {
    const proc = Bun.spawn([process.execPath, 'run', 'scripts/provider-e2e.ts'], {
      cwd: process.cwd(),
      env: cleanEnv({ FINAGENT_PROVIDER_E2E: '0' }),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    expect(exitCode).toBe(0)
    expect(stdout).toContain('未运行')
  })

  it('fails clearly when live mode has no Massive credential', async () => {
    const proc = Bun.spawn([process.execPath, 'run', 'scripts/provider-e2e.ts'], {
      cwd: process.cwd(),
      env: cleanEnv({ FINAGENT_PROVIDER_E2E: '1' }),
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()
    expect(exitCode).toBe(2)
    expect(stderr).toContain('缺少 MASSIVE_API_KEY')
  })
})
