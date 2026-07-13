import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { JsonStore, DeterministicNova, evaluateExpression, buildPlan, createApplication } from './server.mjs';

async function temporaryStore() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-zero-ai-test-'));
  const store = await new JsonStore(path.join(directory, 'state.json')).init();
  return { directory, store };
}

test('calculator is deterministic and rejects unsafe syntax', () => {
  assert.equal(evaluateExpression('12 * (4 + 3)'), 84);
  assert.equal(evaluateExpression('81 / 9 + 5'), 14);
  assert.throws(() => evaluateExpression('process.exit()'), /calculator accepts|unsupported|unknown/);
});

test('planner creates a dependency graph without an AI model', () => {
  const plan = buildPlan('analyze and test this software repository');
  assert.ok(plan.categories.includes('software'));
  assert.ok(plan.nodes.some((node) => node.tool === 'inspect'));
  assert.equal(plan.nodes.at(-1).tool, 'report');
  for (const node of plan.nodes) {
    for (const dependency of node.dependsOn) {
      assert.ok(plan.nodes.some((candidate) => candidate.id === dependency));
    }
  }
});

test('memory stores exact values and deterministic chat recalls them', async (t) => {
  const { directory, store } = await temporaryStore();
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const nova = new DeterministicNova(store, { workspace: directory });
  assert.match(await nova.respond('/remember project = zero ai'), /Stored/);
  assert.match(await nova.respond('/recall project'), /zero ai/);
  assert.match(await nova.respond('Tell me something unknowable'), /will not invent/i);
});

test('work-tree completes with deterministic tools and produces evidence report', async (t) => {
  const { directory, store } = await temporaryStore();
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'sample.py'), 'print("ok")\n');
  const nova = new DeterministicNova(store, { workspace: directory });
  const run = await nova.createRun('analyze this software repository');
  await nova.executeRun(run.id);
  const result = nova.getRun(run.id);
  assert.equal(result.run.status, 'done');
  assert.match(result.run.report, /AI\/model calls:\*\* 0/);
  assert.ok(result.nodes.every((node) => node.status === 'done'));
});

test('HTTP API exposes health and OpenAI-compatible deterministic chat', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-zero-ai-http-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const app = createApplication({ dataFile: path.join(directory, 'state.json'), workspace: directory });
  await app.init();
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const address = app.server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/healthz`).then((response) => response.json());
  assert.equal(health.aiCalls, 0);
  const chat = await fetch(`${base}/api/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'anything', messages: [{ role: 'user', content: '/calc 2+3*4' }] }),
  }).then((response) => response.json());
  assert.equal(chat.model, 'nova-zero-ai');
  assert.match(chat.choices[0].message.content, /14/);
});
