---
name: osint-deep-research
description: Lawful, source-preserving OSINT and deep research with query planning, identity disambiguation, corroboration, provenance, chronology, confidence, and ethical safeguards.
metadata: {"openclaw":{"emoji":"🔎"}}
---
<!-- tags: osint, research, search, verification, provenance, chronology -->

# OSINT and Deep Research

Use for public-information investigations, company/person/entity research, chronology reconstruction, due diligence, technical research, legal-source gathering, and exhaustive web searches.

## Legal and ethical boundary

Use only publicly available or explicitly authorized information. Do not bypass authentication, paywalls, access controls, robots restrictions, CAPTCHA, rate limits, or platform safeguards. Do not obtain credentials, private communications, precise sensitive location, financial data, medical data, or other restricted personal information through deception or intrusion.

Minimize collection of personal data. Exclude irrelevant private details. Apply heightened care to minors, victims, witnesses, protected classes, and vulnerable people.

## Investigation plan

Before searching, define:

- exact question and decision the research supports;
- entities, aliases, identifiers, locations, languages, and date range;
- inclusion and exclusion criteria;
- required source quality;
- legal/privacy risks;
- stopping condition;
- expected deliverable: answer, chronology, comparison, source map, or confidence assessment.

Separate entity identification from fact research. Never merge people or organizations only because names match.

## Query matrix

Build multiple query families:

1. Exact identifiers: quoted names, domains, usernames, registration numbers, addresses, product IDs, case numbers, commit SHAs.
2. Alias and spelling variants: transliterations, abbreviations, former names, subsidiaries, handles.
3. Time queries: exact dates, month/year, before/after event, archived versions.
4. Relationship queries: entity plus employer, director, repository, court, regulator, location, partner, or product.
5. Source-specific queries: official sites, government domains, court systems, company filings, academic indexes, GitHub, standards bodies, news archives.
6. Negative queries: exclude unrelated people, locations, products, and duplicated syndication.
7. Language variants: search in the relevant local languages as well as English.

Use broad discovery first, then precise verification queries. Record queries that materially affected the findings.

## Source hierarchy

Prefer:

1. Official records, filings, court documents, legislation, standards, source repositories, agency publications, and primary datasets.
2. Direct statements, original interviews, first-party documentation, and contemporaneous archived pages.
3. Reputable independent reporting and academic research.
4. Specialist databases with transparent methodology.
5. Forums, social posts, aggregators, and anonymous claims only as leads requiring corroboration.

A search result snippet is not a source. Open and inspect the underlying page. For PDFs, inspect relevant pages, tables, figures, metadata, and publication context.

## Provenance record

For every load-bearing item, record:

- source title and publisher;
- publication and access dates;
- stable URL or record identifier;
- author/issuing body;
- exact passage, field, table, image, or dataset row supporting the claim;
- whether the source is original, mirrored, archived, translated, or secondary;
- preservation method when evidentiary retention is required;
- limitations or conflicts.

Do not alter source files. Hash downloaded evidence when chain-of-custody matters.

## Identity disambiguation

Use multiple matching attributes:

- full legal name and aliases;
- date or year of birth when lawful and relevant;
- organization, role, geography, domain, account handle;
- registration/license number;
- timeline consistency;
- known associates or projects.

Assign identity confidence separately from claim confidence. “Likely same person” must remain an inference unless identifiers establish the match.

## Chronology and temporal validity

Normalize dates and timezones. Distinguish:

- event date;
- publication date;
- update date;
- access date;
- effective date;
- filing date.

Do not use a recent upload date to imply recent content. Resolve contradictory timelines with primary records and archived snapshots.

## Media verification

For images and video:

- identify the original upload when possible;
- inspect context, caption, timestamp, frame sequence, and edits;
- compare landmarks, weather, shadows, signage, language, clothing, and known events;
- check whether media predates the claimed event;
- search for prior appearances and derivative copies;
- avoid asserting identity from facial resemblance alone.

State when geolocation, chronology, or authenticity remains uncertain.

## Corroboration and conflicts

For significant claims, seek at least two independent sources unless one authoritative primary record is dispositive. Independence means the sources do not merely repeat the same wire report, press release, or anonymous claim.

When sources conflict:

1. identify the precise disagreement;
2. compare authority, proximity, methodology, and date;
3. look for corrections or updated records;
4. present both positions fairly;
5. state the most defensible conclusion and confidence.

## Confidence scale

- High: authoritative primary evidence or multiple independent strong sources with no material conflict.
- Medium: credible evidence with one unresolved limitation.
- Low: indirect, incomplete, old, or weakly corroborated evidence.
- Unknown: insufficient evidence.

Do not use numerical confidence unless a defined scoring method is provided.

## Deep-search completion test

Before stopping, ask:

- Were official records searched?
- Were aliases, languages, and date variants covered?
- Were archived or historical versions checked?
- Were claims traced to original sources?
- Were negative findings searched rather than assumed?
- Were conflicts and missing records disclosed?
- Could a different entity with the same name explain the evidence?

## Reporting format

Deliver:

1. Research question and scope.
2. Executive findings.
3. Verified facts with source attribution.
4. Chronology or comparison table when useful.
5. Conflicts, gaps, and excluded material.
6. Confidence per major conclusion.
7. Source list ordered by authority.
8. Reproducible search notes when requested.

Never imply surveillance or privileged access. Clearly distinguish public-source research from private or connected-account data.

## Method reference

For professional evidentiary practice, follow the principles in the UN OHCHR and UC Berkeley Human Rights Center’s Berkeley Protocol on Digital Open Source Investigations: preparation, security, collection, preservation, verification, analysis, and transparent reporting.
