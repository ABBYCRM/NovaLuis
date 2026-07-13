import { arraySchema as A, jsonSchema as O, stringSchema as S } from "./bos-omega-core.mjs";
import { githubCreateIssue, githubCreatePullRequest } from "./bos-omega-github.mjs";
import { discordSendMessage, inngestSendEvent, resendSendEmail } from "./bos-omega-services.mjs";
import { memoryPut, writeFile } from "./bos-omega-files.mjs";

const str = (d) => S(d);
const arr = (d, items) => A(d, items);
const obj = (properties, required = []) => O(properties, required);
const def = (name, category, description, schema, run, capability = null, aliases = []) => ({ name, category, description, schema, run, risk: "high", requiresAuth: true, requiresApproval: true, internalOnly: false, capability, aliases });

export const WRITE_TOOLS = [
  def("github_create_issue", "git", "Create a GitHub issue after explicit approval.", obj({ repo: str("owner/name or URL."), title: str("Title."), body: str("Body.") }, ["repo", "title"]), githubCreateIssue, "github.api"),
  def("github_create_pr", "git", "Create a draft GitHub pull request after explicit approval.", obj({ repo: str("owner/name or URL."), title: str("Title."), body: str("Body."), head: str("Head branch."), base: str("Base branch."), draft: { type: "boolean" } }, ["repo", "title", "head", "base"]), githubCreatePullRequest, "github.api"),
  def("send_email", "productivity", "Send an idempotent email through Resend after explicit approval.", obj({ to: arr("Recipients.", { type: "string" }), subject: str("Subject."), text: str("Text body."), html: str("HTML body."), idempotency_key: str("Optional idempotency key.") }, ["to", "subject"]), resendSendEmail, "email.resend"),
  def("discord_send_message", "messaging", "Send a Discord bot message after explicit approval.", obj({ channel_id: str("Channel ID."), content: str("Message.") }, ["channel_id", "content"]), discordSendMessage, "messaging.discord"),
  def("inngest_send_event", "automation", "Send an Inngest event after explicit approval.", obj({ name: str("Event name."), id: str("Optional idempotency ID."), data: { type: "object", additionalProperties: true } }, ["name"]), inngestSendEvent, "events.inngest"),
  def("write_file", "filesystem", "Atomically write a run file after explicit approval.", obj({ path: str("Run-relative path."), content: str("Complete content."), overwrite: { type: "boolean" } }, ["path", "content"]), writeFile, null, ["write"]),
  def("memory_put", "memory", "Atomically write local memory after explicit approval.", obj({ key: str("Key."), value: {} }, ["key", "value"]), memoryPut),
];
