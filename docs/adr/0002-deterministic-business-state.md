# ADR 0002: Deterministic business state with advisory AI

- Status: Accepted
- Date: 2026-07-26

## Context

StudioCue uses AI for extraction, drafting, schedule generation, and risk explanation. Legal, financial, permission, and event-readiness states require reliable evidence and auditability.

## Decision

AI output is parsed through task-specific Zod schemas and stored only as a draft, extraction, suggestion, or explanation. Deterministic provider evidence and human-authorized rules control signatures, payments, COI approval, permissions, project transitions, and readiness.

## Consequences

AI can accelerate work without becoming a source of business truth. Product flows must expose assumptions, source links, review steps, and a confirmation before any AI-suggested action is executed.
