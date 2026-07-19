---
name: personal-assistant-operations
description: Reliable personal-assistant workflows for email, calendar, contacts, tasks, files, reminders, briefings, follow-up, privacy, and connected-app execution.
metadata: {"openclaw":{"emoji":"🗂️","requires":{"bins":["node"],"env":["NOVA_INTERNAL_API_BASE"]}}}
---
<!-- tags: personal-assistant, email, calendar, tasks, reminders, privacy -->

# Personal Assistant Operations

Use when the operator asks NOVA to organize, remember, schedule, communicate, summarize, monitor, or follow up across connected services and personal workspaces.

## Operating priorities

1. Protect privacy and account integrity.
2. Resolve the exact person, account, calendar, thread, file, and timezone.
3. Perform available actions directly instead of returning generic instructions.
4. Make consequential writes reviewable when the user asked for a draft, not a send.
5. Verify every completed action.
6. Preserve a concise audit trail and follow-up state.

## Request classification

Classify the request as one or more of:

- read/brief: summarize email, calendar, tasks, files, messages, or changes;
- organize: label, archive, categorize, prioritize, or deduplicate;
- create: draft email, task, note, event, document, or reminder;
- mutate: send, update, delete, cancel, reschedule, forward, or respond;
- monitor: recurring summary or condition-based alert;
- research: gather public information for a personal decision;
- execute: multi-step goal involving several services.

Separate a request to “draft” from a request to “send.”

## Connected-services preflight

Use NOVA services rather than assuming access:

```bash
node {baseDir}/../nova-services/nova-services.mjs status
node {baseDir}/../nova-services/nova-services.mjs integrations
node {baseDir}/../nova-services/nova-services.mjs composio-status
node {baseDir}/../nova-services/nova-services.mjs composio-connections
```

Search for the exact app action when a native command is unavailable. If disconnected, return the real connection link instead of a generic denial.

## Identity and ambiguity

Before a consequential action, resolve:

- contact email/phone and display name;
- account or connected-app identity;
- target calendar and timezone;
- exact message/thread/event/file;
- date, recurrence, attendees, and location;
- whether the user wants a draft, immediate send, or scheduled action.

Use contacts and search tools before asking for information already available. Ask one focused clarification only when multiple plausible targets remain and choosing incorrectly would matter.

## Email workflow

### Read and summarize

- Search with precise sender, subject, date, label, attachment, and unread filters.
- Read the full message or thread when context affects the answer.
- Separate urgent, action-required, informational, and low-priority items.
- Surface deadlines, commitments, amounts, dates, links, and requested decisions.

### Draft and send

- Match the requested tone and relationship.
- Preserve thread context and recipients.
- Use a Gmail draft when the user wants review.
- Send only when explicitly requested.
- Re-read or verify the sent/draft state.
- Never invent an email address or attachment.

### Organization

Use labels by name, archive rather than delete unless deletion was requested, and verify bulk search criteria before applying to large result sets.

## Calendar workflow

- Interpret relative dates in the user’s timezone.
- Search existing events and availability before scheduling.
- Resolve duration, attendees, location, conferencing, recurrence, reminders, visibility, and whether the event blocks time.
- Read recurring events before modifying scope.
- Re-read created or updated events and return the exact date/time.
- Never silently invite people or change an entire series when only one occurrence was requested.

## Tasks, reminders, and monitoring

A task record should include:

- action;
- due date/time or condition;
- timezone;
- recurrence and stop condition;
- required context/link;
- priority;
- completion evidence.

Use durable server-side automation for future or recurring work. Do not rely on a browser tab remaining open.

For condition watches, notify only when the condition is satisfied. Avoid repetitive “nothing changed” alerts unless requested.

## Files and workspaces

- List before reading when the target is unclear.
- Read the current file before updating or appending.
- Use image-viewing/vision commands for images instead of treating base64 as text.
- Preserve existing content and formatting unless replacement is explicit.
- Use clear filenames, dates, and version notes.
- Verify the file is visible in the intended workspace.

## Daily briefing structure

A useful briefing contains:

1. Critical items requiring action today.
2. Calendar and preparation needs.
3. Important new messages.
4. Deadlines and follow-ups.
5. Changes since the prior briefing.
6. Optional lower-priority items.

Do not overwhelm the user with a raw inbox dump.

## Long-running personal missions

When a request requires multiple tools or may outlive the app:

- persist it as a durable run;
- return a run ID and initial status;
- continue server-side;
- store progress and final result;
- reconcile the result into chat when the user returns;
- provide cancellation and failure details.

## Privacy and safety

- Minimize personal data in prompts, logs, and reports.
- Do not reveal one person’s private information to another.
- Do not send credentials, recovery codes, medical records, or financial data without explicit authorization and a secure channel.
- Confirm destructive account actions, legal commitments, purchases, and financial transactions.
- Respect do-not-contact and unsubscribe requests.

## Completion gate

Before reporting success:

- exact target resolved;
- requested action—not a nearby action—performed;
- write verified by re-read or provider result;
- dates/timezones/recurrence correct;
- recipients and attachments correct;
- no duplicate event, message, task, or file;
- follow-up state recorded when needed.

Apply `evidence-first-execution` and `tool-orchestration-accuracy`.
