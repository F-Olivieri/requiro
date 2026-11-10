# Prototype · Requiro PRD workspace

## Open it

Run `python3 server.py` from `02-prototype/app`, then open
`http://127.0.0.1:8765`. The README also describes private personal access through
GitHub Codespaces.

## What it demonstrates

A document library, staged PRD editor, guided-chat handoff, explicit proposal
review, stable requirement IDs, saved revisions, review and approval, historical
restore, reversible archive, and current-document Markdown/JSON export/import.

Chat responses come from the human's chosen assistant chat. The app prepares a
context packet and accepts a structured reply; it has no model connection.

## Current limits

The app runs on your computer or in a private Codespace. Browser sessions using
the same running app share requirement comments. Access for other team members
is not configured. Saved data stays in that workspace; exported current-document
files do not include every historical revision.
Only synthetic or approved public nonconfidential course material is permitted.
Confidentiality classification depends on the human; prompt rules do not prove
that information is safe. Time saved, adoption and PRD quality remain unmeasured.

## Debrief

Record user observations after trying a fictional PRD. A successful technical
test does not answer whether the workflow improves product decisions.
