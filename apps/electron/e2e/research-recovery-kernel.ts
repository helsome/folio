// Live, opt-in headless AgentKernel + ResearchService crash acceptance.
// Uses real DeepSeek HTTP streaming and Longbridge CLI, or a live MCP relay.
// No LocalResearchSynthesizer, fake capability, or pre-seeded interrupted run.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';
import type { AgentRuntime, AgentEvent, AgentRunInput, FinanceCapability } from '@finagent/core';
import { AgentKernel } from '../../../packages/shared/src/kernel/agent-kernel';
import { ResearchService } from '../../../packages/shared/src/research/service';
import { ResearchReportRepository } from '../../../packages/shared/src/research/repository';
import { JsonFileStore } from '../../../packages/shared/src/storage/json-file-store';
import { createCapabilityRegistry } from '../../../packages/shared/src/capabilities';
import { parseSynthesisJson } from '../../../packages/shared/src/research/agent-synth';

const output = resolve(process.env.FINAGENT_RECOVERY_OUTPUT ?? 'apps/electron/e2e/artifacts/research-recovery-kernel');
const model = process.env.FINAGENT_RECOVERY_MODEL ?? 'deepseek-chat';
const symbol = 'NVDA.US';
const [mode, oldId] = process.argv.slice(2);
await mkdir(output, { recursive: true });
const json = async (name: string) => JSON.parse(await readFile(join(output, name), 'utf8'));
const save = (name: string, value: unknown) => writeFile(join(output, name), JSON.stringify(value, null, 2));
const repo = new ResearchReportRepository(new JsonFileStore(join(output, 'store')));
async function until<T>(read: () => Promise<T | undefined>, timeout = 240000): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await read(); if (result) return result; }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    await Bun.sleep(20);
  }
  throw new Error('Live acceptance timed out');
}
function launch(args: string[]) {
  const log = openSync(join(output, 'worker.log'), 'a');
  try { return spawn(process.execPath, [import.meta.path, ...args], {
    stdio: ['ignore', log, log], windowsHide: true, env: process.env,
  }); } finally { closeSync(log); }
}

if (!mode) {
  assert.ok(process.env.DEEPSEEK_API_KEY, 'Set DEEPSEEK_API_KEY. No fixture fallback.');
  // Use a new output directory per execution, preventing reuse of old relay data.
  try { await readFile(join(output, 'started.json')); throw new Error('Use a fresh output directory.'); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  let child = launch(['start']);
  let spawnError: Error | undefined;
  child.on('error', e => { spawnError = e; });
  try {
    const started = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error('Worker exited before starting');
      return json('started.json');
    });
    console.log('Started live research ' + started.id + '; waiting for live retrieval and model streaming.');
    const before = await until(async () => {
      if (child.exitCode !== null) throw new Error('Worker exited before kill point');
      const cp = await repo.getCheckpoint(started.id);
      const stream = await json('stream-started.json');
      return cp?.phase === 'synthesizing' && !cp.synthesis && cp.outcomes.some(o =>
        o.record.capabilityId === 'research.news' && o.record.status === 'success') &&
        cp.events.some(e => e.agentRunId === stream.runId) ? cp : undefined;
    });
    const killedPid = child.pid;
    const killed = once(child, 'exit');
    child.kill('SIGKILL'); await killed;
    await save('before-checkpoint.json', before);
    child = launch(['resume', started.id]);
    child.on('error', e => { spawnError = e; });
    const exited = once(child, 'exit');
    const finished = await until(async () => {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null && child.exitCode !== 0) throw new Error('Recovery worker failed');
      return json('finished.json');
    });
    assert.equal((await exited)[0], 0);
    const after = (await repo.getCheckpoint(started.id))!;
    assert.equal((await json('reconciled.json')).status, 'interrupted');
    assert.equal(after.summary.id, before.summary.id);
    assert.ok(['completed','partial'].includes(finished.status));
    assert.deepEqual(after.outcomes, before.outcomes);
    assert.deepEqual(after.retry.attempts, before.retry.attempts);
    assert.equal(after.retry.synthesisAttempts, before.retry.synthesisAttempts + 1);
    const reports = await repo.listBySymbol(symbol);
    assert.equal(reports.length, 1);
    const report = reports[0];
    const evidence = report.sections.flatMap(s => s.evidence);
    assert.equal(new Set(report.sections.map(s => s.key)).size, report.sections.length);
    assert.equal(new Set(evidence.map(e => e.capabilityId + ':' + e.runId)).size, evidence.length);
    assert.equal(evidence.length, 1);
    await save('after-checkpoint.json', after);
    await save('final-report.json', report);
    const verification = {
      mode:'live AgentKernel + ResearchService; DeepSeek HTTP runtime; Longbridge news',
      transport:process.env.FINAGENT_RECOVERY_NEWS_RELAY === '1' ? 'live MCP relay' : 'Longbridge CLI',
      killedPid, killPoint:'first real model stream delta after durable news retrieval',
      beforeRunId:before.summary.id, afterRunId:after.summary.id,
      beforeAgentRunId:(await json('stream-started.json')).runId,
      afterAgentRunIds:after.events.filter(e=>e.type==='synthesis').map(e=>e.agentRunId),
      recoveryCount:after.summary.recoveryCount, checkpointVersion:after.version,
      savedRetrievalCount:before.outcomes.length, newsAttempts:after.retry.attempts['research.news'],
      synthesisAttempts:after.retry.synthesisAttempts, evidenceCount:evidence.length,
      noDuplicateEvidence:true, noRepeatedCompletedSteps:true, reportCount:reports.length,
      reportId:report.id, status:finished.status,
    };
    await save('verification.json', verification);
    console.log(JSON.stringify(verification));
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped;
    }
  }
} else {
  const abort = new AbortController();
  let sequence = 0;
  const event = (input: AgentRunInput, type: string, payload: unknown = {}) => ({
    id: randomUUID(), sessionId:input.sessionId, runId:input.runId, sequence:++sequence,
    timestamp:Date.now(), type, payload,
  }) as AgentEvent;
  const runtime: AgentRuntime = {
    async getTools() { return {ok:true, data:[]}; },
    async ensureSession(s) { return {sessionId:s.id,status:'active'}; },
    async cancel() { abort.abort(); },
    async dispose() { abort.abort(); },
    async *run(input) {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method:'POST', headers:{Authorization:'Bearer '+process.env.DEEPSEEK_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({model,stream:true,stream_options:{include_usage:true},
          response_format:{type:'json_object'},max_tokens:6000,messages:[{role:'user',content:input.content}]}),
        signal:AbortSignal.any([abort.signal,AbortSignal.timeout(180000)]),
      });
      if (!response.ok || !response.body) throw new Error('DeepSeek returned HTTP '+response.status);
      yield event(input,'message_started');
      let answer = '', buffer = '', first = true;
      const decoder = new TextDecoder();
      for await (const bytes of response.body) {
        buffer += decoder.decode(bytes,{stream:true});
        let newline;
        while ((newline=buffer.indexOf('\n'))>=0) {
          const line=buffer.slice(0,newline).trim(); buffer=buffer.slice(newline+1);
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
          const part=JSON.parse(line.slice(6));
          if(part.usage) await save('model-usage-'+mode+'.json',{model:part.model,usage:part.usage});
          const delta=part.choices?.[0]?.delta?.content;
          if(!delta) continue;
          if(first && mode==='start') await save('stream-started.json',{runId:input.runId,at:Date.now(),model:part.model});
          first=false; answer+=delta;
          yield event(input,'message_delta',{delta,answer});
        }
      }
      yield event(input,'message_completed',{answer});
      yield event(input,'run_completed',{answer,toolCalls:[]});
    },
  };
  const kernel = new AgentKernel({storageDir:join(output,'kernel'),piSessionDir:join(output,'sessions'),runtime});
  const news: FinanceCapability = {
    id:'research.news',name:'Longbridge live news',description:'Live Longbridge retrieval for crash acceptance',
    category:'research',riskLevel:'read',auth:'public',toolName:'research_news',
    inputSchema:Type.Object({symbol:Type.String()}),
    async execute() {
      const request={id:randomUUID(),symbol,requestedAt:Date.now()};
      await save('retrieval-request.json',request);
      let data;
      if(process.env.FINAGENT_RECOVERY_NEWS_RELAY==='1') {
        const response=await until(async()=> {
          const value=await json('retrieval-response.json');
          return value.requestId===request.id ? value : undefined;
        },18000);
        assert.ok(response.fetchedAt>=request.requestedAt);
        data=response.data;
      } else {
        const file=openSync(join(output,'news-cli.json'),'w');
        const err=openSync(join(output,'news-cli.log'),'w');
        const cli=spawn(process.env.LONGBRIDGE_BIN??'longbridge',['news',symbol,'--format','json'],
          {stdio:['ignore',file,err],windowsHide:true});
        closeSync(file);closeSync(err);
        const code=await once(cli,'exit'); assert.equal(code[0],0,'Longbridge news failed');
        data=await json('news-cli.json');
      }
      assert.ok(Array.isArray(data) && data.length>0,'Live news retrieval returned no articles');
      assert.ok(data.every((item:{url?:string})=>item.url?.startsWith('https://longbridge.com/news/')));
      return {data:data.slice(0,10),provenance:{provider:'longbridge',fetchedAt:Date.now(),stale:false},
        summary:'Retrieved '+data.length+' live Longbridge news articles'};
    },
  };
  const svc=new ResearchService({
    registry:createCapabilityRegistry([news]),repository:repo,
    getIdentity:async()=>({provider:'deepseek',model,config:'live-http-news-v1'}),
    synthesizer:{async synthesize(input) {
      const session=await kernel.sessions.createSession('Live crash recovery acceptance');
      const prompt=[
        'Analyze only these saved facts for '+symbol+'. Return JSON with summary, stance (bullish/bearish/neutral), confidence (0..1),',
        'sections (key/title/verdict/summary), bullCase, bearCase, catalysts, risks (string arrays).',
        'Every planned key must have exactly one section. Missing data means verdict unavailable. Do not invent facts.',
        'Section verdict must be positive, negative, neutral or unavailable. State data gaps. Respond in English.',
        'Planned keys: '+input.plannedCapabilities.join(', '), 'Outcomes: '+JSON.stringify(input.runs),
        'Saved facts: '+input.dataBundle,
      ].join('\n');
      let unsubscribe=()=>{};
      const result=new Promise<string>((resolve,reject)=>{
        unsubscribe=kernel.runs.subscribe(e=>{
          if(e.sessionId!==session.id)return;
          if(e.type==='run_completed')resolve(e.payload.answer??'');
          if(e.type==='run_failed')reject(new Error(e.payload.error.message));
        });
      });
      void result.catch(()=>{});
      try {
        const run=await kernel.runs.startRun(session.id,prompt);
        await input.recovery?.onAgentRun(run.id,session.id);
        return parseSynthesisJson(await result);
      } finally {unsubscribe();}
    }},
  });
  let run;
  if(mode==='start') {run=await svc.start(symbol);await save('started.json',run);}
  else {await save('reconciled.json',await svc.getRun(oldId));run=await svc.resume(oldId);}
  const done=await until(async()=>{
    const current=await svc.getRun(run.id);
    return current && ['completed','partial','failed','cancelled','interrupted'].includes(current.status)?current:undefined;
  });
  while(kernel.runs.isRunning())await Bun.sleep(20);
  await save('finished.json',done);
  await kernel.dispose();
  process.exit(['completed','partial'].includes(done.status)?0:1);
}
