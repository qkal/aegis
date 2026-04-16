# ADR-0009: Zero Telemetry, Local-First by Default

## Status

Accepted

## Date

2025-01-15

## Context

The reference project makes a network call to the npm registry on every server start to check for updates. This is a privacy concern (reveals usage patterns), an availability risk (server start blocked by network timeout), and inconsistent with a "local-first" claim.

Aegis intercepts every command an AI agent runs on the user's machine. The trust requirements for this tool are extreme. Any network call undermines that trust.

## Decision

**Zero telemetry. Zero network calls in the default configuration.**

- No anonymous usage stats
- No crash reporting
- No feature flags fetched from a server
- No "check for updates" call unless the user explicitly runs `aegis upgrade --check`
- No cloud sync, no account required
- Users can opt into update notifications via `aegis config set updates.checkOnStart true`

All data stays on the user's machine:

- Session events: `~/.aegis/<platform>/sessions/`
- Content index: `~/.aegis/<platform>/content/`
- Audit log: `~/.aegis/audit/`
- Configuration: `~/.aegis/config.json`
- Audit HMAC key: `~/.aegis/audit-key`

## Rationale

- **Trust**: A tool that intercepts every AI agent command must be above suspicion. Any phone-home behavior, however benign, creates doubt.
- **Availability**: Aegis must function fully offline. Network dependency in the critical path is unacceptable.
- **Privacy**: Session data contains source code, file paths, commands, and potentially credentials. None of this should leave the machine.
- **Simplicity**: No cloud infrastructure to maintain, no accounts to manage, no OAuth flows, no terms of service.

## Consequences

- No automatic update notifications by default. Users must manually check for updates.
- No aggregate usage data for product decisions. User feedback is the only signal.
- No crash reporting. Bugs are reported via GitHub issues.
- No cloud sync between machines. Each machine has its own session data and audit log.
