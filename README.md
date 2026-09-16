# Cashbook

Offline PWA ledger. Data lives in SQLite in the browser (OPFS). Export from Settings to keep a real backup.

Weekly (or monthly) reminders appear on the home screen when a backup is due. On Chrome or Edge you can pick a folder once; a dated `.sqlite` copy is written when you open the app. iPhone Safari cannot save files in the background — share the export to Files or iCloud Drive.

## Vercel server (cloud copy + weekly push)

The static PWA and a small `/api` server deploy together on Vercel. Opening the app can upload the SQLite file. A daily cron sends a **weekly** web-push (“time to backup”) when that cloud copy is **older than 5 days**. The phone still has to open the app to send the file — push cannot read OPFS in the background.

1. Create a Vercel project from this repo (Vite) and a **private** Blob store, then connect the store to the project.
2. Generate VAPID keys: `npx web-push generate-vapid-keys`.
3. Set env vars (see `.env.example`): `CASHBOOK_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `CRON_SECRET`.
4. Deploy. On the phone: add to Home Screen → Settings → Connect server → Enable weekly alerts.
5. Local full stack: copy `.env.example` to `.env.local` and `npm run dev` (Vite serves `/api` in memory if Blob is not linked).

If the PWA stays on GitHub Pages, set `VITE_API_URL` to the Vercel origin and `ALLOWED_ORIGINS` to `https://kjugi.github.io`.

```bash
npm install
npm run dev
```

On iPhone: open the HTTPS URL → Share → Add to Home Screen. Export often; Safari can still wipe site data.
