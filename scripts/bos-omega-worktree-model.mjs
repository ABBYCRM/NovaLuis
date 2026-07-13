import crypto from "node:crypto";
import {
  activeToolDefinitions,
  runTool,
} from "./bos-omega-runtime.mjs";
import { completeMessage } from "./super-nova-router.mjs";
import { safeText } from "./bos-omega-core.mjs";
import { audit, clip, compactJson, hash } from "./bos-omega-worktree-store.mjs";

export function parseModelJson(raw) {
  let text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const arrayStart = text.indexOf("[");
    const objectStart = text.indexOf("{");
    const start =
      arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)
        ? arrayStart
        : objectStart;
    const end =
      start === arrayStart ? text.lastIndexOf("]") : text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("model returned no JSON");
    return JSON.parse(text.slice(start, end + 1));
  }
}

export function ancestorContext(nodes, node) {
  const byId = new Map(nodes.map((value) => [value.id, value]));
  const chain = [];
  let current = node.parent_id ? byId.get(node.parent_id) : null;
  while (current) {
    chain.unshift(`- ${clip(current.title, 300)}: ${clip(current.detail, 500)}`);
    current = current.parent_id ? byId.get(current.parent_id) : null;
  }
  return chain.join("\n");
}

export async function planChildren(run, nodes, node, limits) {
  if (node.depth >= limits.maxDepth || nodes.length >= limits.maxNodes) return [];
  const completion = await completeMessage({
    role: "planner",
    model: run.model || undefined,
    maxTokens: 16_384,
    messages: [
      {
        role: "system",
        content:
          "Return strict JSON only: an array of 2-8 complete, non-overlapping executable children. " +
          "Each child requires title, detail, and kind ('composite' or 'terminal'). " +
          "Use composite only when further decomposition is genuinely required.",
      },
      {
        role: "user",
        content:
          `Overall goal: ${clip(run.goal, 4_000)}\n` +
          `Ancestor context:\n${ancestorContext(nodes, node) || "(root)"}\n` +
          `Node: ${clip(node.title, 500)}\n${clip(node.detail, 4_000)}`,
      },
    ],
  });
  const parsed = parseModelJson(completion.message.content);
  if (!Array.isArray(parsed)) throw new Error("planner result was not an array");
  const room = Math.max(0, limits.maxNodes - nodes.length);
  return parsed.slice(0, Math.min(8, room)).map((value, index) => {
    const child = value && typeof value === "object" ? value : {};
    const canBeComposite = node.depth + 1 < limits.maxDepth;
    return {
      title: clip(child.title || `Step ${index + 1}`, 500),
      detail: clip(child.detail || child.title || "Execute this step.", 8_000),
      kind:
        canBeComposite && child.kind === "composite"
          ? "composite"
          : "terminal",
      role: child.kind === "composite" ? "planner" : "executor",
      provider: completion.provider,
      model: completion.model,
    };
  });
}

function parseToolArguments(call) {
  try {
    const parsed = JSON.parse(String(call.function?.arguments || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return { _invalidArguments: true };
  }
}

export async function executeLeaf(run, nodes, node, limits, correction = "") {
  const context = {
    runId: run.id,
    authenticated: true,
    approvalGranted: false,
    internalWorker: true,
  };
  const tools = activeToolDefinitions(context);
  const messages = [
    {
      role: "system",
      content:
        "Execute the terminal node using only supplied tools. Produce the finished work product. " +
        "Never claim a write, test, command, deployment, or external action unless a tool result proves it. " +
        "This runtime is read-only; when a write is required, report a precise blocker.",
    },
    {
      role: "user",
      content:
        `Overall goal: ${clip(run.goal, 4_000)}\n` +
        `Ancestor context:\n${ancestorContext(nodes, node) || "(root)"}\n` +
        `Terminal node: ${clip(node.title, 500)}\n${clip(node.detail, 4_000)}` +
        (correction ? `\n\nCritic correction required:\n${clip(correction, 4_000)}` : ""),
    },
  ];
  const trace = [];
  let deliverable = "";
  let provider = "";
  let model = "";
  let toolCalls = 0;

  for (let step = 0; step < limits.maxToolSteps; step += 1) {
    const completion = await completeMessage({
      role: "executor",
      model: run.model || undefined,
      maxTokens: 16_384,
      messages,
      tools,
      toolChoice: "auto",
    });
    provider = completion.provider;
    model = completion.model;
    const assistant = completion.message || {};
    const calls = Array.isArray(assistant.tool_calls) ? assistant.tool_calls : [];
    if (!calls.length) {
      deliverable =
        typeof assistant.content === "string" ? assistant.content : "";
      break;
    }

    messages.push({
      role: "assistant",
      content: typeof assistant.content === "string" ? assistant.content : "",
      tool_calls: calls,
    });

    for (const call of calls.slice(0, 8)) {
      toolCalls += 1;
      if (toolCalls > limits.maxToolCalls) {
        throw new Error("governance tool-call limit exceeded");
      }
      const name = String(call.function?.name || "");
      const args = parseToolArguments(call);
      const result = await runTool(name, args, context);
      const resultText = clip(compactJson(result, 16_000), 16_000);
      const traceItem = {
        step,
        tool: name,
        argsHash: hash(compactJson(args)),
        resultHash: hash(resultText),
        ok: !result?.error,
        summary: safeText(result?.error || result?.message || "ok", 300),
      };
      trace.push(traceItem);
      audit(run.id, "tool_call", { nodeId: node.id, ...traceItem });
      messages.push({
        role: "tool",
        tool_call_id: String(call.id || crypto.randomUUID()),
        name,
        content: resultText,
      });
    }
  }

  if (!deliverable) {
    messages.push({
      role: "system",
      content:
        "The tool-step budget is exhausted. Produce the final deliverable now using only observed results and state all unknowns.",
    });
    const completion = await completeMessage({
      role: "executor",
      model: run.model || undefined,
      maxTokens: 16_384,
      messages,
      tools: [],
      toolChoice: "none",
    });
    provider = completion.provider;
    model = completion.model;
    deliverable =
      typeof completion.message.content === "string"
        ? completion.message.content
        : "";
  }

  if (!deliverable.trim()) throw new Error("executor returned an empty deliverable");
  return { deliverable, trace, provider, model, toolCalls };
}

export async function verifyLeaf(run, node, deliverable) {
  const completion = await completeMessage({
    role: "critic",
    model: run.model || undefined,
    maxTokens: 8_192,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Return strict JSON only with pass (boolean), evidence (string), gaps (array of strings), and correction (string). " +
          "Fail unsupported execution claims, empty work, missing proof, and results that do not satisfy the node.",
      },
      {
        role: "user",
        content:
          `Goal: ${clip(run.goal, 4_000)}\nNode: ${clip(node.title, 500)}\n${clip(node.detail, 4_000)}\n\n` +
          `Deliverable:\n${clip(deliverable, 50_000)}`,
      },
    ],
  });
  const parsed = parseModelJson(completion.message.content);
  return {
    pass: parsed?.pass === true,
    evidence: clip(parsed?.evidence || "", 8_000),
    gaps: Array.isArray(parsed?.gaps)
      ? parsed.gaps.map((value) => clip(value, 1_000)).slice(0, 20)
      : [],
    correction: clip(parsed?.correction || "", 8_000),
    provider: completion.provider,
    model: completion.model,
  };
}

export async function synthesizeRun(run, completed, failed) {
  const completion = await completeMessage({
    role: "executor",
    model: run.model || undefined,
    maxTokens: 32_768,
    messages: [
      {
        role: "system",
        content:
          "Synthesize a final evidence-based report from verified Work Tree results. " +
          "Do not turn failed or unknown nodes into success. Include limitations and blockers.",
      },
      {
        role: "user",
        content:
          `Goal: ${clip(run.goal, 4_000)}\n\nVerified results:\n${completed
            .map((node) => `## ${node.title}\n${clip(node.result, 12_000)}`)
            .join("\n\n")}\n\nFailed nodes:\n${failed
            .map((node) => `- ${node.title}`)
            .join("\n") || "None"}`,
      },
    ],
  });
  return {
    report:
      typeof completion.message.content === "string"
        ? completion.message.content
        : "",
    provider: completion.provider,
    model: completion.model,
  };
}
