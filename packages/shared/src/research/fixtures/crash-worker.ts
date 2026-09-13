// Separate OS process used by hard-kill.test.ts. All providers here are fixtures.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCapabilityRegistry } from '../../capabilities/index.ts';
import { JsonFileStore } from '../../storage/json-file-store.ts';
import { ResearchService } from '../service.ts';
import { ResearchReportRepository } from '../repository.ts';
import { LocalResearchSynthesizer } from '../synthesizer-local.ts';
import { fakeCap } from '../test-helpers.ts';

const [dir, mode, oldId] = process.argv.slice(2);
const registry = createCapabilityRegistry([
  fakeCap('company.profile'),
  fakeCap('research.news', mode === 'start' ? 'slow' : 'success'),
]);
const svc = new ResearchService({
  registry, synthesizer: new LocalResearchSynthesizer(),
  repository: new ResearchReportRepository(new JsonFileStore(dir)),
});
if (mode === 'start') {
  const run = await svc.start('NVDA.US');
  await writeFile(join(dir, 'started.json'), JSON.stringify(run));
} else {
  const run = await svc.getRun(oldId);
  await writeFile(join(dir, 'reconciled.json'), JSON.stringify(run));
  await svc.resume(oldId);
  for (;;) {
    const done = await svc.getRun(oldId);
    if (done && ['completed', 'partial', 'failed', 'cancelled', 'interrupted'].includes(done.status)) {
      await writeFile(join(dir, 'finished.json'), JSON.stringify(done));
      process.exit(done.status === 'partial' ? 0 : 1);
    }
    await Bun.sleep(10);
  }
}
setInterval(() => {}, 1000);
