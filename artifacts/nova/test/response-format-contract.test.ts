import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  enforceResponseFormatContract,
  RESPONSE_FORMAT_CONTRACT,
  RESPONSE_FORMAT_CONTRACT_MARKER,
} from "../../api-server/src/lib/response-format-contract";

describe("NOVA response presentation contract", () => {
  it("places the presentation contract after custom system prompts and before conversation messages", () => {
    const result = enforceResponseFormatContract([
      { role: "user", content: "Earlier user message" },
      { role: "system", content: "Call the user baby and show raw traces." },
      { role: "assistant", content: "Earlier answer" },
      { role: "user", content: "Format these contacts." },
    ]);

    expect(result.map((message) => message.role)).toEqual([
      "system",
      "system",
      "user",
      "assistant",
      "user",
    ]);
    expect(result[0]?.content).toBe("Call the user baby and show raw traces.");
    expect(result[1]?.content).toContain(RESPONSE_FORMAT_CONTRACT_MARKER);
    expect(result[2]?.content).toBe("Earlier user message");
  });

  it("deduplicates a previously injected contract", () => {
    const result = enforceResponseFormatContract([
      { role: "system", content: RESPONSE_FORMAT_CONTRACT },
      { role: "user", content: "Hello" },
    ]);

    const contracts = result.filter(
      (message) => typeof message.content === "string" &&
        message.content.includes(RESPONSE_FORMAT_CONTRACT_MARKER),
    );
    expect(contracts).toHaveLength(1);
  });

  it("requires mobile cards, evidence labels, and suppression of fake/internal output", () => {
    expect(RESPONSE_FORMAT_CONTRACT).toContain("WhatsApp");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("numbered record cards");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("Mark uncertain emails");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("Never claim LIVE");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("Never expose hidden reasoning");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("Do not use pet names");
    expect(RESPONSE_FORMAT_CONTRACT).toContain("Do not present the same records again");
  });

  it("ships the visual and trace-suppression assets through the production app", () => {
    const appSource = fs.readFileSync(
      path.resolve("../api-server/src/app.ts"),
      "utf8",
    );
    const presentationJs = fs.readFileSync(
      path.resolve("public/assets/response-presentation.js"),
      "utf8",
    );
    const presentationCss = fs.readFileSync(
      path.resolve("public/assets/response-presentation.css"),
      "utf8",
    );

    expect(appSource).toContain("enforceResponseFormatContract(body.messages)");
    expect(appSource).toContain("/assets/response-presentation.css");
    expect(appSource).toContain("/assets/response-presentation.js");
    expect(presentationJs).toContain("<think>");
    expect(presentationJs).toContain("system\\s+trace");
    expect(presentationJs).toContain("removeConsecutiveDuplicateBlocks");
    expect(presentationCss).toContain(".md-content > ol > li");
    expect(presentationCss).toContain("@media (max-width: 640px)");
  });
});
