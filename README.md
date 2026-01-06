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

## Notes
- Uses the WAQI public API; the token is defined in `src/App.jsx` as `API_TOKEN`.
- Dependencies: React 18, Vite, axios, chart.js, react-chartjs-2.
