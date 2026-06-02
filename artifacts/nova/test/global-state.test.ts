import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, it, expect } from "vitest";

/**
 * Regression coverage for the Global State sidebar graph.
 *
 * Rather than re-implementing the parser/observer, these tests extract the
 * REAL inline <script> that ships in index.html (the one defining
 * renderGlobalState + the signature-stripping MutationObserver) and execute it
 * inside a fresh JSDOM per test. That way a future edit to the parser, the
 * strip logic, or the markup will be caught here.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.resolve(here, "..", "index.html"), "utf8");

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
  (m) => m[1],
);
const gsScript = inlineScripts.find((s) => s.includes("function renderGlobalState"));

if (!gsScript) {
  throw new Error(
    "Could not locate the GLOBAL_STATE inline script in index.html — has it been renamed or removed?",
  );
}

/** Build one rendered assistant (bot) bubble with a visible body + signature. */
function botBubble(visibleHtml: string, signatureHtml: string): string {
  return `<div class="msg-row bot"><div class="md-content">${visibleHtml}${signatureHtml}</div></div>`;
}

/**
 * Construct a fresh document with the sidebar graph element plus the supplied
 * chat transcript, then execute the shipped script. The script's boot() runs
 * strip() synchronously on load, so the DOM is fully processed on return.
 */
function boot(transcriptHtml: string): JSDOM {
  const dom = new JSDOM(
    `<!DOCTYPE html><html><body>
      <pre class="gs-graph" id="gs-graph"><span class="gs-empty">Awaiting state\u2026</span></pre>
      ${transcriptHtml}
    </body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true },
  );
  dom.window.eval(gsScript as string);
  // If the document was still parsing at eval time, the script deferred boot()
  // to DOMContentLoaded — fire it so the strip/render pass runs. (No-op when the
  // script already booted synchronously.)
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", { bubbles: true }),
  );
  return dom;
}

function graphText(dom: JSDOM): string {
  return dom.window.document.getElementById("gs-graph")?.textContent ?? "";
}

function lastBotBody(dom: JSDOM): string {
  const bodies = dom.window.document.querySelectorAll(".msg-row.bot .md-content");
  return bodies[bodies.length - 1]?.textContent ?? "";
}

describe("renderGlobalState — signature formats", () => {
  it("renders a plain GLOBAL_STATE JSON object as a bar graph", () => {
    const dom = boot(
      botBubble(
        "<p>Hello there.</p>",
        '<pre>GLOBAL_STATE = { "arousal": 0.75, "stress": 0.2 }</pre>',
      ),
    );
    const graph = graphText(dom);
    expect(graph).toContain("arousal");
    expect(graph).toContain("stress");
    expect(graph).toContain("\u2588"); // a filled bar block was rendered
    expect(graph).not.toContain("Awaiting state");
    expect(graph).not.toContain("GLOBAL_STATE"); // the key itself is skipped
  });

  it("renders a fenced code block signature", () => {
    const dom = boot(
      botBubble(
        "<p>Working on it.</p>",
        '<pre><code>GLOBAL_STATE = {\n  "dopamine_tone": 0.9,\n  "stress": 0.1\n}</code></pre>',
      ),
    );
    const graph = graphText(dom);
    expect(graph).toContain("dopamine_tone");
    expect(graph).toContain("stress");
    expect(graph).toContain("\u2588");
  });

  it('renders a "scratchpad:" labelled block', () => {
    const dom = boot(
      botBubble(
        "<p>Noted.</p>",
        '<p>scratchpad: { "mood": 0.6, "drift": 0.1 }</p>',
      ),
    );
    const graph = graphText(dom);
    expect(graph).toContain("mood");
    expect(graph).toContain("drift");
    expect(graph).toContain("\u2588");
  });
});

describe("renderGlobalState — last-bubble semantics", () => {
  it("updates the panel only from the latest bot message, not older ones", () => {
    const dom = boot(
      botBubble(
        "<p>Earlier reply.</p>",
        '<pre>GLOBAL_STATE = { "oldonly": 0.9 }</pre>',
      ) +
        botBubble(
          "<p>Latest reply.</p>",
          '<pre>GLOBAL_STATE = { "newonly": 0.3 }</pre>',
        ),
    );
    const graph = graphText(dom);
    expect(graph).toContain("newonly");
    expect(graph).not.toContain("oldonly");
  });
});

describe("signature stripping — transcript integrity", () => {
  it("preserves the visible reply body while removing GLOBAL_STATE from the transcript", () => {
    const dom = boot(
      botBubble(
        "<p>Visible reply body.</p>",
        '<pre>GLOBAL_STATE = { "arousal": 0.75 }</pre>',
      ),
    );
    const body = lastBotBody(dom);
    expect(body).toContain("Visible reply body.");
    expect(body).not.toContain("GLOBAL_STATE");
    expect(body).not.toContain("arousal");
    // The graph still got the value even though it's hidden from chat.
    expect(graphText(dom)).toContain("arousal");
  });

  it("strips a trailing scratchpad block but keeps the reply text", () => {
    const dom = boot(
      botBubble(
        "<p>Done.</p>",
        '<p>scratchpad: { "mood": 0.6 }</p>',
      ),
    );
    const body = lastBotBody(dom);
    expect(body).toContain("Done.");
    expect(body).not.toContain("scratchpad");
    expect(body).not.toContain("mood");
  });
});
