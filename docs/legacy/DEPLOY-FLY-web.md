# Deploying Iqra to Fly.io (Docker)

The repo has a `Dockerfile` (Next.js standalone) and `.dockerignore`. You don't
need Docker installed locally — Fly builds the image on its own builders.

## Key idea: build-time vs runtime env
- **Public** values (`NEXT_PUBLIC_*`) are baked into the browser bundle at
  **build time** → passed as Docker **build args** (safe to commit; they're public).
- **Secret** values (`SUPABASE_SERVICE_ROLE_KEY`) are read by the server at
  **runtime** → set as **Fly secrets** (encrypted, never in the image).
- VAPID *private* keys live only in **Supabase** (the edge function), not here.

---

## 1. Install the Fly CLI + sign in
```bash
# macOS
brew install flyctl       # or: curl -L https://fly.io/install.sh | sh

fly auth signup           # first time (needs a card; tiny apps are ~free)
# or: fly auth login
```

## 2. Launch the app (generates fly.toml)
From the repo root:
```bash
fly launch --no-deploy
```
When prompted:
- **App name:** something unique, e.g. `iqra-danyal` (becomes `iqra-danyal.fly.dev`)
- **Region:** pick the one nearest you/your group
- **Postgres / Redis / Upstash:** **No** to all (we use Supabase)
- It detects the Dockerfile and writes `fly.toml`. Don't deploy yet.

## 3. Add the public build args to `fly.toml`
Open the generated `fly.toml` and add this block (these are your public keys):
```toml
[build.args]
  NEXT_PUBLIC_SUPABASE_URL = "https://uqsdzraczxkinvefrbog.supabase.co"
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_y2MBqMjQbY7omohMCfElIg_Ln8asJOk"
  NEXT_PUBLIC_VAPID_PUBLIC_KEY = "BAs7UUO_JrbIqYeEdqvIi6vzRDJNL2pdlrwh9Qyp3VXGBorNQqKZ34WNfoEO2aGNY8cRmzchPvIfA_TP3oUIiLA"
```
Also confirm the service block has:
```toml
[http_service]
  internal_port = 3000
  force_https = true
```

## 4. Set the runtime secret
```bash
fly secrets set SUPABASE_SERVICE_ROLE_KEY="<paste eyJ… from .env.local>"
```

## 5. (Recommended) give it a little memory
```bash
fly scale memory 512
```

## 6. Deploy 🚀
```bash
fly deploy
```
When it finishes: `fly open` → your app is live at `https://<app>.fly.dev`.

## 7. Point Supabase at the live URL
Supabase → **Authentication → URL Configuration** → set **Site URL** to your
`https://<app>.fly.dev` (or your custom domain below).

## 8. Custom domain (optional, ~$10–15/yr for the domain)
```bash
fly certs add iqra.yourdomain.com
```
Then add the DNS records Fly prints (an A/AAAA or CNAME) at your registrar. Fly
auto-provisions HTTPS. Update Supabase Site URL to the custom domain.

## 9. Test push on a real device
- iPhone (16.4+): open the site → **Share → Add to Home Screen** → open the
  installed app → **Settings → toggle Push on → Allow**.
- Android/desktop Chrome: Settings → toggle Push on → Allow.
- Then trigger one: a reminder at the next 15-min mark, an `@mention`, or a nudge.

## Redeploys later
Just `fly deploy` again (or set up GitHub Actions later for auto-deploy on push).
Build args persist in `fly.toml`; secrets persist on Fly.
