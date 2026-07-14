import assert from "node:assert/strict";
import {
  atomicMemoryUnits,
  classifyQueryIntent,
  contentHash,
  inferRuntimePhase,
  scoreVectorMemoryHit,
  type VectorMemoryHit,
} from "./vector-memory";

function hit(overrides: Partial<VectorMemoryHit> = {}): VectorMemoryHit {
  const now = new Date();
  return {
    id: 1,
    content: "Verified deployment evidence for commit abc123",
    contentHash: contentHash("Verified deployment evidence for commit abc123"),
    memoryType: "evidence",
    scope: "mission",
    scopeKey: "repo",
    missionId: "42",
    agentId: null,
    source: "self-test",
    externalId: null,
    verification: "verified",
    confidence: 1,
    importance: 0.9,
    salience: 0.9,
    metadata: {},
    entities: ["abc123"],
    relationships: {},
    validFrom: now,
    validUntil: null,
    supersedesId: null,
    accessCount: 0,
    successfulUses: 3,
    failedUses: 0,
    createdAt: now,
    lastAccessedAt: now,
    semanticScore: 0.9,
    lexicalScore: 0.8,
    score: 0,
    ...overrides,
  };
}

assert.equal(classifyQueryIntent("why did the deploy fail with a timeout"), "debug");
assert.equal(classifyQueryIntent("verify the production commit with evidence"), "verify");
assert.equal(classifyQueryIntent("build and wire this runtime"), "execute");
assert.equal(inferRuntimePhase("fix the broken deployment"), "CORRECT");
assert.equal(inferRuntimePhase("design the architecture"), "PLAN");

const units = atomicMemoryUnits(`${"A".repeat(900)}\n\n${"B".repeat(900)}`, 1000);
assert.equal(units.length, 2);
assert.ok(units.every((unit) => unit.length <= 1000));
assert.equal(contentHash("hello\r\nworld"), contentHash("hello\nworld"));

const verified = scoreVectorMemoryHit(hit(), {
  missionId: "42",
  scopeKey: "repo",
  intent: "verify",
  phase: "VERIFY",
});
const claimed = scoreVectorMemoryHit(hit({ verification: "claimed" }), {
  missionId: "42",
  scopeKey: "repo",
  intent: "verify",
  phase: "VERIFY",
});
const otherMission = scoreVectorMemoryHit(hit({ missionId: "99", scope: "mission" }), {
  missionId: "42",
  scopeKey: "different",
  intent: "verify",
  phase: "VERIFY",
});
const contradicted = scoreVectorMemoryHit(hit({ verification: "contradicted" }), {
  missionId: "42",
  scopeKey: "repo",
  intent: "verify",
  phase: "VERIFY",
});

assert.ok(verified > claimed, `verified=${verified} must outrank claimed=${claimed}`);
assert.ok(verified > otherMission, `same mission=${verified} must outrank other mission=${otherMission}`);
assert.ok(contradicted < claimed, `contradicted=${contradicted} must rank below claimed=${claimed}`);

console.log(JSON.stringify({
  ok: true,
  checks: 11,
  scores: { verified, claimed, otherMission, contradicted },
}));
