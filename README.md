# Air-Quality-Health-Alert-System

The Air Quality & Health Alert System is a smart web-based application designed to monitor air quality in real time, predict AQI levels, and provide health-related alerts and preventive recommendations to users. It fetches live Air Quality Index data for a city, shows health advice, and plots recent AQI values using Chart.js.

## Prerequisites
- Node.js (LTS recommended) with npm on your PATH. Download from https://nodejs.org/

## Setup
```powershell
Set-Location "c:\Users\User\OneDrive\Desktop\starting of python\matpoltlib\react_forntend\fornt_end"
npm install
```

Create a `.env` file (same folder as `package.json`) with your keys:
```
VITE_GOOGLE_MAPS_API_KEY=your_maps_key
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

## Run Dev Server
```powershell
npm run dev
```
Open the printed local URL (usually http://localhost:5173/).

## Build for Production
```powershell
npm run build
```

## Deploy to Vercel
1. Push this folder to a Git provider (GitHub/GitLab/Bitbucket) if you have not already.
2. In Vercel, click **Add New → Project**, import the repo, and keep the defaults (framework auto-detects Vite and uses the included `vercel.json`).
3. In **Project Settings → Environment Variables**, add every key from the `.env` section above (names must keep the `VITE_` prefix). Use the same values that work locally.
4. Trigger the first deploy. Vercel runs `npm install` and `npm run build`, then serves the static `dist` output globally. Subsequent git pushes redeploy automatically.
5. (Optional) Use **Settings → Domains** to assign a custom hostname once you are happy with the MVP link.

## Notes
- Uses the WAQI public API; the token is defined in `src/App.jsx` as `API_TOKEN`.
- Dependencies: React 18, Vite, axios, chart.js, react-chartjs-2.
