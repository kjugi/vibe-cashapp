# Cashbook

Offline PWA ledger. Data lives in SQLite in the browser (OPFS). Export from Settings to keep a real backup.

Weekly (or monthly) reminders appear on the home screen when a backup is due. On Chrome or Edge you can pick a folder once; a dated `.sqlite` copy is written when you open the app. iPhone Safari cannot save files in the background — share the export to Files or iCloud Drive.

## Vercel server (per-person cloud copy + weekly push)

The static PWA and a small `/api` server deploy together on Vercel. **Sign in with Google** so each person (you and a friend) has a separate backup slot. Settings → **Upload now** sends that person’s SQLite file. A daily cron sends a **weekly** web-push when *that* cloud copy is **older than 5 days**. Opening the app does not upload.

1. Create a Vercel project from this repo (Vite) and a **private** Blob store, then connect the store to the project.
2. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth **Web application** client.
   - Authorized JavaScript origins: `http://localhost:5173`, your Vercel origin, and `https://kjugi.github.io` if you still use Pages.
   - Authorized redirect URIs: the same origins with a trailing slash (`http://localhost:5173/`, `https://your-app.vercel.app/`, `https://kjugi.github.io/vibe-cashapp/`).
3. Generate VAPID keys: `npx web-push generate-vapid-keys`.
4. Set env vars (see `.env.example`): `VITE_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `VAPID_*`, `CRON_SECRET`. Use the same client id for both Google vars.
5. Deploy. On the phone: add to Home Screen → Settings → Sign in with Google (use the icon, not a Safari tab) → Upload now / Enable weekly alerts.

`npm run dev` serves `/api` from Vite (in-memory store if Blob is not linked).

If the PWA stays on GitHub Pages, set `VITE_API_URL` to the Vercel origin and `ALLOWED_ORIGINS` to `https://kjugi.github.io`.

```bash
npm install
npm run dev
```

On iPhone: open the HTTPS URL → Share → Add to Home Screen. Export often; Safari can still wipe site data.
