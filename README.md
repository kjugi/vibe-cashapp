# Cashbook

Offline PWA ledger. Data lives in SQLite in the browser (OPFS). Connect Dropbox in Settings to upload on later opens, or export a file.

Weekly (or monthly) reminders appear on the home screen when a backup is due. On Chrome or Edge you can pick a folder once; a dated `.sqlite` copy is written when you open the app. iPhone Safari cannot save files in the background — share the export to Files or iCloud Drive.

```bash
npm install
npm run dev
```

On iPhone: open the HTTPS URL → Share → Add to Home Screen. Export often; Safari can still wipe site data.

Deploy the `dist` folder as a static site (Vercel / GitHub Pages).
