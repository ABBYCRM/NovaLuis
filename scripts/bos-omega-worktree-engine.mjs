import { boundedInt, safeText } from "./bos-omega-core.mjs";
import {
  ancestorContext,
  executeLeaf,
  planChildren,
  synthesizeRun,
  verifyLeaf,
} from "./bos-omega-worktree-model.mjs";
import {
  audit,
  clip,
  compactJson,
  freshRun,
  hash,
  insertNode,
  loadNodes,
  setNode,
  setRun,
} from "./bos-omega-worktree-store.mjs";

const MAX_DEPTH = boundedInt(process.env.WORK_TREE_MAX_DEPTH, 3, 1, 8);
const MAX_NODES = boundedInt(process.env.WORK_TREE_MAX_NODES, 60, 1, 500);
const MAX_TOOL_STEPS = boundedInt(
  process.env.SUPER_NOVA_MAX_TOOL_STEPS,
  8,
  1,
  20,
);
const MAX_CORRECTIONS = boundedInt(
  process.env.WORK_TREE_MAX_CORRECTIONS,
  2,
  0,
  10,
);
const MAX_FAILURES = boundedInt(
  process.env.WORK_TREE_MAX_RUN_FAILURES,
  20,
  1,
  100,
);

export function engineLimits(governance) {
  return {
    maxDepth: MAX_DEPTH,
    maxNodes: MAX_NODES,
    maxToolSteps: MAX_TOOL_STEPS,
    maxCorrections: MAX_CORRECTIONS,
    maxFailures: MAX_FAILURES,
    maxToolCalls: governance.maxToolCalls,
  };
}

async function seed(run) {
  const current = await loadNodes(run.id);
  if (current.length) return;
  await insertNode({
    runId: run.id,
    parentId: null,
    title: clip(run.goal, 300),
    detail: run.goal,
    kind: "composite",
    depth: 0,
    position: 0,
    role: "planner",
  });
  audit(run.id, "run_seeded", { goalHash: hash(run.goal) });
}

async function decompose(run, nodes, node, limits) {
  const children = await planChildren(run, nodes, node, limits);
  if (!children.length) {
    await setNode(node.id, {
      kind: "terminal",
      status: "pending",
      role: "executor",
    });
    return;
  }
  for (let position = 0; position < children.length; position += 1) {
    const child = children[position];
    await insertNode({
      runId: run.id,
      parentId: node.id,
      title: child.title,
      detail: child.detail,
      kind: child.kind,
      depth: node.depth + 1,
      position,
      role: child.kind === "composite" ? "planner" : "executor",
    });
  }
  await setNode(node.id, {
    status: "running",
    role: "planner",
    trace: compactJson({ childCount: children.length }),
  });
  audit(run.id, "node_decomposed", {
    nodeId: node.id,
    childCount: children.length,
  });
}

async function executeTerminal(run, nodes, node, limits) {
  await setNode(node.id, {
    status: "running",
    role: "executor",
    attempts: Number(node.attempts || 0) + 1,
  });
  let correction = "";
  const trace = [];

  for (let attempt = 0; attempt <= limits.maxCorrections; attempt += 1) {
    const execution = await executeLeaf(
      run,
      nodes,
      node,
      limits,
      correction,
    );
    trace.push(...execution.trace);
    const verification = await verifyLeaf(
      run,
      node,
      execution.deliverable,
    );
    audit(run.id, "node_verified", {
      nodeId: node.id,
      attempt,
      pass: verification.pass,
      evidenceHash: hash(verification.evidence),
      gapCount: verification.gaps.length,
      provider: verification.provider,
      model: verification.model,
    });

    if (verification.pass) {
      await setNode(node.id, {
        status: "done",
        result: clip(execution.deliverable, 60_000),
        verification: compactJson(verification),
        trace: compactJson(trace),
        role: "critic",
      });
      return;
    }
    correction =
      verification.correction || verification.gaps.join("\n") || "Address the verification failure.";
  }

  await setNode(node.id, {
    status: "failed",
    result: "",
    verification: compactJson({
      pass: false,
      reason: "correction budget exhausted",
    }),
    trace: compactJson(trace),
    role: "critic",
  });
}

async function settleComposites(runId) {
  const nodes = await loadNodes(runId);
  const composites = nodes
    .filter((node) => node.kind === "composite" && node.status === "running")
    .sort((left, right) => right.depth - left.depth);

  for (const composite of composites) {
    const children = nodes.filter((node) => node.parent_id === composite.id);
    if (!children.length) continue;
    if (children.some((child) => ["pending", "running"].includes(child.status))) continue;
    const failed = children.some((child) => child.status === "failed");
    await setNode(composite.id, {
      status: failed ? "failed" : "done",
      result: failed
        ? "One or more child nodes failed verification."
        : children
            .map((child) => `- ${child.title}: ${clip(child.result, 1_000)}`)
            .join("\n"),
      verification: compactJson({ pass: !failed, childCount: children.length }),
    });
  }
}

async function finalize(run) {
  const nodes = await loadNodes(run.id);
  if (nodes.some((node) => ["pending", "running"].includes(node.status))) {
    return false;
  }
  const failed = nodes.filter((node) => node.status === "failed");
  const completed = nodes.filter(
    (node) => node.kind === "terminal" && node.status === "done",
  );
  const synthesis = await synthesizeRun(run, completed, failed);
  const status = failed.length ? "failed" : "done";
  await setRun(run.id, {
    status,
    report: clip(synthesis.report, 60_000),
    error: failed.length
      ? `${failed.length} Work Tree node(s) failed verification.`
      : "",
    model: synthesis.model,
    stage_trace: compactJson({
      provider: synthesis.provider,
      model: synthesis.model,
      nodeCount: nodes.length,
      completed: completed.length,
      failed: failed.length,
    }),
  });
  audit(run.id, "run_finished", {
    status,
    nodeCount: nodes.length,
    completed: completed.length,
    failed: failed.length,
    reportHash: hash(synthesis.report),
  });
  return true;
}

export async function processRun(run, governance) {
  const limits = engineLimits(governance);
  const startedAt = Date.now();
  await seed(run);

  while (Date.now() - startedAt < governance.maxRunMs) {
    const currentRun = await freshRun(run.id);
    if (!currentRun || currentRun.status === "cancelled") return;
    let nodes = await loadNodes(run.id);
    const failureCount = nodes.filter((node) => node.status === "failed").length;
    if (failureCount > limits.maxFailures) {
      await setRun(run.id, {
        status: "failed",
        error: `failure budget exceeded (${failureCount}/${limits.maxFailures})`,
      });
      return;
    }

    const pending = nodes.find((node) => node.status === "pending");
    if (!pending) {
      await settleComposites(run.id);
      if (await finalize(currentRun)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }

    try {
      if (pending.kind === "composite") {
        await decompose(currentRun, nodes, pending, limits);
      } else {
        await executeTerminal(currentRun, nodes, pending, limits);
      }
    } catch (error) {
      const message = safeText(error?.message || error, 1_000);
      await setNode(pending.id, {
        status: "failed",
        verification: compactJson({ pass: false, error: message }),
      });
      audit(run.id, "node_failed", {
        nodeId: pending.id,
        error: message,
      });
    }
    await settleComposites(run.id);
  }

  await setRun(run.id, {
    status: "failed",
    error: "governance run-duration limit exceeded",
  });
  audit(run.id, "run_timeout", {});
}

export function engineSummary() {
  return {
    maxDepth: MAX_DEPTH,
    maxNodes: MAX_NODES,
    maxToolSteps: MAX_TOOL_STEPS,
    maxCorrections: MAX_CORRECTIONS,
    maxFailures: MAX_FAILURES,
  };
}
