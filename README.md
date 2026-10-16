# Iqra

Private Quran-study accountability app for a small circle. Native iOS and
Android (Expo / React Native), sharing the Supabase backend with the
original web PWA, which is frozen and will be retired.

- Plan and current state: [docs/HANDOFF.md](docs/HANDOFF.md)
- Product rules that override the code: [docs/DECISIONS.md](docs/DECISIONS.md)
- Screen Time feature and Apple entitlement: [docs/SCREEN-TIME.md](docs/SCREEN-TIME.md)
- Push notification design: [docs/PUSH.md](docs/PUSH.md)
- Agent instructions: [CLAUDE.md](CLAUDE.md)

## Run

```bash
cp .env.example .env        # public keys only
npm install
npx expo start              # Expo Go works until native modules are added
npx tsc --noEmit && npx expo lint
```

Builds go through EAS (`npx eas-cli@latest build ...`). See HANDOFF.
