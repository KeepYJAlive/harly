# Interview scheduling

Harly is the source of truth for the master schedule at `/dashboard/calendars`.
Only confirmed interviews synchronize to the workspace Google Calendar. Outlook
continues to supply Teams online meetings through the existing workspace integration;
this feature does not add individual calendar connections.

## Coordination

- `interview_scheduling_requests` holds interview details and coordination status.
  It references the application; candidate/job/department come from that application.
- `interview_scheduling_slots` stores UTC instants plus the proposer's IANA timezone.
  Candidate proposals enter `pending_review` and require an authorized recruiter.
- `interview_request_participants` and `interview_participants` hold workspace users
  with lead, interviewer, or observer roles. `interviews.interviewerId` remains the
  backwards-compatible lead. Historical interviews require no backfill.
- Confirmation locks the request, then participant advisory locks in sorted order.
  It creates or updates the normal interview, records sync intents in the same
  transaction, and invokes existing meeting/calendar/email infrastructure after commit.
  A partial unique index allows only one accepted slot per request.
- Rescheduling coordination keeps the current interview and provider reservation until
  a replacement is confirmed. Cancelling coordination alone preserves that reservation.
- Cancellation detaches the active meeting link and records durable provider cleanup.
  Jitsi cancellation detaches a room; it cannot invalidate the remote URL. Provider
  failures stay retryable in `interview_syncs`.

The portal uses the existing candidate session and checks application ownership for
both reads and writes. Recruiter actions use application-scoped interview permissions.
Tentative slots are displayed separately from confirmed calendar entries.

Candidate timezone is taken from `candidates.timezone`. Application submission fills
an unset timezone from the browser, and candidates can correct it when responding to
coordination. Ambiguous/nonexistent DST wall times are rejected; an explicit-offset
ISO timestamp disambiguates them. Unknown external availability is not marked available.

## Validation

Use the normal `pnpm db:generate`, `pnpm db:verify-migrations`, `pnpm db:migrate`,
and `pnpm --filter @harly/db exec drizzle-kit check` workflow. Never hand-write migration SQL.

Run unit tests with `pnpm --filter web test src/features/interviews src/lib/interviews`.
For transaction, tenant, participant-conflict, cancellation, and confirmation-race tests,
apply migrations to an isolated database, then run:

```sh
HARLY_SCHEDULING_INTEGRATION=1 DATABASE_URL='<isolated database URL>' \
  pnpm --filter web test src/features/interviews/scheduling.integration.test.ts
```

Integration tests create and remove their own workspace fixtures. External meeting,
calendar, email, and domain-event deliveries are mocked; no live invitations are sent.
