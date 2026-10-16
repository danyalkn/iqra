# Iqra — setup & deploy checklist

This is the running checklist. Items get checked off as we build each piece.

## 1. Create the Supabase project (do this now)

1. Go to <https://supabase.com> → sign in → **New project**.
2. Pick the **organization**, name it `iqra` (or anything), set a strong
   **database password** (save it in your password manager), and choose the
   **region closest to you/your group** (e.g. `eu-west` or `us-east`). Free
   tier is plenty for ~5 users.
3. Wait for it to provision (~1–2 min).

### Get the client keys

4. In the project: **Project Settings → API**.
5. Copy these into `.env.local` (this file is gitignored):
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`
     (⚠️ secret — server/Edge Functions only, never shipped to the browser)

> If the dashboard shows the newer **publishable** / **secret** API keys
> instead of anon/service_role, use publishable → `ANON_KEY` and secret →
> `SERVICE_ROLE_KEY`. Tell me which you see and I'll match the code.

### Configure auth — email + password, NO email service

We use email + password and rely on group membership (RLS) as the real gate, so
an unverified email is harmless. This means **no SMTP / email provider is
needed at all**.

6. **Authentication → Providers → Email**: ensure **Email** is enabled and turn
   **Confirm email OFF**. (With it off, sign-up creates a session immediately —
   no confirmation email is sent.)
7. That's it — there is no email template or SMTP to configure.
8. **Password resets:** with no email service, a forgotten password is reset by
   you, the owner: **Authentication → Users → (pick user) → Reset/Update
   password** in the Supabase dashboard.
9. (Optional, recommended later) **Authentication → URL Configuration**: set the
   Site URL to your Vercel domain once deployed.

## 2. Env vars

- Local: fill `.env.local` (shape mirrors `.env.example`).
- Vercel: add the same vars in **Project → Settings → Environment Variables**
  when we deploy (step 9).

## 3. Database migrations

Run both files in the Supabase **SQL Editor** (or via the CLI), in order:

1. `…_schema.sql` — tables, indexes, generated columns, realtime.
2. `…_rls.sql` — Row Level Security + table grants.
3. `…_reminders.sql` — multiple reminders (time + days of week).
4. `…_message_mentions.sql` — `mentions` column on chat messages.
5. `…_push.sql` — pg_cron reminder sweep + @mention trigger (run AFTER the
   push prerequisites in §4 below — needs the Edge Function + Vault secrets).
6. `…_nudge_push.sql` — push when someone nudges you (run after `…_push.sql`).
7. Everything after that, in timestamp order (`supabase db push` once the CLI
   is linked applies whatever is missing). Notably `…_day_reminders.sql` adds
   the one-time reminders set from the Today page plus the `iqra-day-reminders`
   job, which runs every minute.

Then create your group and add members with `supabase/admin_examples.sql`.
Onboarding's profile save needs these applied first.

## 4. Push notifications

Pushes fire for **@mentions and reminders only** (never for others' logging).

### a) Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

Put the **public** key in BOTH `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
`VAPID_PUBLIC_KEY` (`.env.local` + Vercel), the **private** key in
`VAPID_PRIVATE_KEY`, and a contact like `mailto:you@example.com` in
`VAPID_SUBJECT`.

### b) Deploy the Edge Function + its secrets

```bash
supabase functions deploy send-push
supabase secrets set \
  VAPID_PUBLIC_KEY=<public> \
  VAPID_PRIVATE_KEY=<private> \
  VAPID_SUBJECT=mailto:you@example.com
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically.)

### c) Enable extensions + Vault secrets, then run the push migration

In the SQL Editor:

```sql
-- extensions (or enable via Dashboard → Database → Extensions)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- secrets the cron/trigger use to call the function
select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<SERVICE_ROLE_KEY>', 'service_role_key');
```

Then run `supabase/migrations/20260606120500_push.sql` (creates `send_push`,
the reminder cron every 15 min, and the @mention trigger).

### d) Test on real devices (can't be tested in CI/simulator)

- **iPhone (iOS 16.4+):** push works **only after** Add to Home Screen. Open
  the installed app → Settings → toggle Push on → tap Allow.
- **Android/desktop Chrome:** Settings → toggle Push on → Allow.
- Verify: send a chat message that `@mentions` another installed user; set a
  reminder for the next 15-min slot and confirm it arrives.
- One-time reminders: on Today, tap the + (hifz: "Remind me") or the
  "Remind me later today" row, pick "In 30 min" or an exact time, and confirm
  the push arrives within a minute of that time.

## 5. Deploy (Vercel)

1. Push the repo to GitHub, import into Vercel.
2. Add env vars (Project → Settings → Environment Variables): all
   `NEXT_PUBLIC_*` + `SUPABASE_SERVICE_ROLE_KEY` + `VAPID_*`.
3. Supabase → Authentication → URL Configuration → set Site URL to the Vercel
   domain.
4. Confirm the Edge Function is deployed and the push migration + Vault secrets
   are in place (§4).
