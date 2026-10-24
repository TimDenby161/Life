# Life

A private, mobile-first household app for two: shared and personal tasks with full completion history, manually tracked finances, the shared Google Calendar, a message and activity feed, health tracking with per-category privacy, and household statistics.

- **Stack:** React 19, TypeScript, Vite, Tailwind CSS 4, Radix UI, TanStack Query, Recharts; Supabase (Auth, Postgres + RLS, Realtime, Edge Functions); GitHub Pages; installable PWA.
- **Security:** invite-only accounts; all authorisation in Postgres Row Level Security; no secrets in the browser.

## Quick start (local)

```bash
npm install
supabase start && supabase db reset && npm run db:demo
cp .env.example .env.local   # fill from `supabase status`
npm run dev                  # sign in as tim@life.local / life-local-dev
```

## Docs

- [docs/SETUP.md](docs/SETUP.md): Supabase, GitHub Pages, Google Calendar, feed sources, secrets
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it fits together
- [docs/DATABASE.md](docs/DATABASE.md): schema, RLS, RPCs
- [docs/DECISIONS.md](docs/DECISIONS.md): trade-offs and why
- [docs/STATUS.md](docs/STATUS.md): what's done and what's next

## Checks

```bash
npm run typecheck && npm test   # TypeScript + Vitest (logic, components, security guards)
npm run test:db                 # pgTAP: RLS, history, recurrence, transfers, health privacy
npm run build                   # production bundle (+ 404.html for Pages routing)
```
