# Copilot Instructions

## Project Snapshot
- Single-page React app bootstrapped by Vite; entry at [src/main.jsx](src/main.jsx) mounts [src/App.jsx](src/App.jsx) into [index.html](index.html).
- UI, data fetching, charts, mapping, and notifications all live inside [src/App.jsx](src/App.jsx).
- Styling is centralized in [src/App.css](src/App.css) and applied globally; no CSS modules or Tailwind.
- Firebase setup is encapsulated in [src/firebase.js](src/firebase.js) exporting a Firestore db instance.

## Key Workflows
- Use npm install once (PowerShell template in [README.md](README.md)); run npm run dev for Vite dev server, npm run build for production output.
- Create .env alongside package.json with required VITE_* keys before enabling maps or swapping Firebase credentials.
- Vite expects environment keys prefixed with VITE_; restart dev server after edits to .env.
- No automated tests or lint configured; manual browser verification is the norm.

## Framework Patterns
- Geolocation watch starts on mount; location state updates trigger automatic AQI refresh after ~50 m movement (see watch logic in [src/App.jsx](src/App.jsx)).
- AQI retrieval uses axios against WAQI; API token is in-component; consider env substitution when rotating tokens.
- Chart data is regenerated per fetch using random historical samples plus the latest AQI to keep charts populated.
- Risk bar chart renders only when AQI exceeds 150; keep derived data in memoized helpers to avoid rerenders.
- Browser notifications stay gated behind notificationStatus; request permissions through requestNotificationPermission before firing.

## External Services
- Google Maps loads via useJsApiLoader; it silently falls back to a placeholder if VITE_GOOGLE_MAPS_API_KEY is missing or invalid.
- Firestore writes occur through addDoc into the aqi_readings collection with serverTimestamp metadata.
- WAQI endpoint switches between city-based and geo-based URLs depending on user input; handle failures via status !== "ok".
- Optional Notification API alerts users when AQI >= 150; handle unsupported browsers gracefully.

## Extending Safely
- Preserve the single-source-of-truth nature of App state to keep maps, cards, and charts synchronized.
- Debounce or throttle new location effects only if you also adjust lastLocationRef; current guard prevents chatty API calls.
- Maintain the existing class names when adding UI to benefit from shared App.css styling.
- If introducing additional screens, wire routing through Vite-friendly React Router and keep main mount in [src/main.jsx](src/main.jsx).
- Leaflet dependencies exist but unused; confirm before pruning or reusing to avoid breaking planned features.
