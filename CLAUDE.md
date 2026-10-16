@AGENTS.md

# Iqra (native) - read this first

Iqra is a private Quran-study accountability app for one small circle
(about five people). This repo is the **Expo / React Native** rewrite of the
web PWA that lives in `~/development/quran-tracker` (Next 16, deployed at
iqra.fly.dev). The web app is **frozen**: bug fixes only, no new features.
This repo is the source of truth from 2026-10-16 onward.

**Start with [docs/HANDOFF.md](docs/HANDOFF.md).** It has the phase plan,
what is done, what is next, and the design of every piece that changes
between web and native (auth, data loading, push, Screen Time).

## Non-negotiables

- **This repo owns the database.** `supabase/` (schema, RLS, cron jobs,
  edge function) moved here from the web repo. Both apps read the same
  Supabase project, so every schema change must keep the web PWA working
  until it is retired. Never rename or drop a column the web app reads.
- **Product decisions in [docs/DECISIONS.md](docs/DECISIONS.md) override
  anything you would infer from the code.** Quarter = 5 pages. Backdating
  closes at 3 AM. Hifz position lives in `from_ref`. No "showing off" pushes.
  Read it before touching logging, reminders, stats, or notifications.
- **`src/lib/` is shared, pure logic copied verbatim from the web app.**
  It is DOM-free and must stay that way (no `react-native` imports either).
  If you fix a bug in one of these files, note it in HANDOFF so the web
  repo can get the same fix.
- **`reference/web-pwa/` is read-only.** It is the web UI for porting
  screens 1:1. Never import from it; it is excluded from tsconfig.
- **Design = "Paper & Pine"**, tokens in `src/constants/theme.ts`. Match the
  web app's look: warm paper neutrals, one emerald accent, iOS type ramp,
  hairline borders, soft depth. Entry types use plain-language meanings
  (Sabak / Sabak Para / Dhor explained, never bare jargon).
- **No em dashes** anywhere in user-facing copy or push text (owner rule,
  enforced server-side too). Use a hyphen or restructure the sentence.
- **Migrations cannot be pushed from this machine.** The Supabase CLI here is
  logged into a different account. Write the migration file, then tell the
  owner to paste it into the Supabase SQL editor. Say so explicitly.

## Commands

```bash
npx expo start              # dev server (dev build or Expo Go for JS-only work)
npx tsc --noEmit            # typecheck - run before declaring anything done
npx expo lint               # lint - same
npx expo-doctor             # dependency / config sanity
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile preview --platform android   # APK
```

## Git

Commit like a senior engineer leaving a reviewable trail, not one dump at
the end. Owner rule, restated 2026-10-16:

- **One concern per commit.** Split by layer or feature (deps, data layer,
  providers, UI kit, routes, docs), never "wip" or "phase 0". A reviewer
  should be able to revert any single commit cleanly.
- **Conventional prefix + scope:** `feat(auth): ...`, `fix(data): ...`,
  `chore(deps): ...`, `docs(handoff): ...`, `refactor(ui): ...`.
- **Body says why, not what.** Note the decision behind the change
  (which doc rule it follows, what alternative was rejected) so the log
  doubles as a decision record alongside `docs/DECISIONS.md`.
- Commit at natural checkpoints as you go: after each piece passes
  `npx tsc --noEmit` and `npx expo lint`. Do not push unless asked.
