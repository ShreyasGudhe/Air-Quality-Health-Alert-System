import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Line, Bar } from "react-chartjs-2";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import "chart.js/auto";
import "./App.css";
import { db } from "./firebase";

function App() {
  const [city, setCity] = useState("");
  const [aqi, setAqi] = useState(null);
  const [advice, setAdvice] = useState("");
  const [prevention, setPrevention] = useState("");
  const [chartData, setChartData] = useState(null);
  const [color, setColor] = useState("#2ecc71");
  const [location, setLocation] = useState({ lat: 28.6139, lng: 77.209 });
  const [locationStatus, setLocationStatus] = useState("Idle");
  const [notificationStatus, setNotificationStatus] = useState("off");
  const lastLocationRef = useRef(null);

  const diseases = useMemo(
    () => [
      { name: "Asthma & COPD flare-ups", prevention: "Use N95 outside; keep inhalers ready; limit exertion" },
      { name: "Cardio stress (hypertension)", prevention: "Stay indoors; hydrate; avoid heavy workouts" },
      { name: "Allergic rhinitis / sore throat", prevention: "Mask outdoors; saline gargle; keep windows closed" },
      { name: "Eye irritation", prevention: "Protective glasses; avoid rubbing eyes; use artificial tears" },
      { name: "Headache & fatigue", prevention: "Reduce outdoor time; rest; stay hydrated" },
    ],
    []
  );

  const { isLoaded: isMapLoaded } = useJsApiLoader({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
  });

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Geolocation not supported");
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocationStatus("Live");
      },
      (err) => {
        setLocationStatus(err.message || "Unable to get location");
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const getPreviousAqi = () => {
    return Array.from({ length: 6 }, () => Math.floor(Math.random() * 200) + 30);
  };

  const healthAdvice = (aqiValue) => {
    if (aqiValue <= 50) return ["Air quality is good. No precautions needed.", "Stay active outdoors.", "#2ecc71"];
    else if (aqiValue <= 100) return ["Moderate air quality. Sensitive groups should take caution.", "Limit prolonged outdoor activity if you have respiratory issues.", "#f1c40f"];
    else if (aqiValue <= 150) return ["Unhealthy for sensitive groups.", "Reduce outdoor activity. Use mask if needed.", "#e67e22"];
    else if (aqiValue <= 200) return ["Unhealthy.", "Avoid outdoor activity. People with health issues should stay indoors.", "#e74c3c"];
    else if (aqiValue <= 300) return ["Very Unhealthy.", "Stay indoors. Wear N95 masks if you go outside.", "#8e44ad"];
    else return ["Hazardous!", "Avoid all outdoor activity. Keep windows closed.", "#34495e"];
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return setNotificationStatus("unsupported");
    if (Notification.permission === "granted") {
      setNotificationStatus("granted");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationStatus(perm);
  };

  const pushNotification = (title, body) => {
    if (notificationStatus !== "granted") return;
    try {
      new Notification(title, { body });
    } catch (err) {
      console.warn("Notification error", err);
    }
  };

  const fetchAqi = async ({ source = "manual" } = {}) => {
    if (!city && !location) return;
    try {
      const API_TOKEN = "5e229522a40e5a7c1980cd67c4d29ad75822bd92";
      const endpoint = city
        ? `https://api.waqi.info/feed/${city}/?token=${API_TOKEN}`
        : `https://api.waqi.info/feed/geo:${location.lat};${location.lng}/?token=${API_TOKEN}`;

      const res = await axios.get(endpoint);
      if (res.data.status !== "ok") {
        alert("City not found or API error");
        return;
      }
      const aqiValue = Number(res.data.data.aqi ?? 0);
      setAqi(aqiValue);
      const [adviceText, preventionText, colorCode] = healthAdvice(aqiValue);
      setAdvice(adviceText);
      setPrevention(preventionText);
      setColor(colorCode);
      const label = city || "Your location";
      if (source === "manual") {
        alert(`Current AQI in ${label} is ${aqiValue}`);
      }

      if (aqiValue >= 150) {
        pushNotification("AQI Alert", `${label} AQI is ${aqiValue}. ${adviceText}`);
      }

      try {
        await addDoc(collection(db, "aqi_readings"), {
          label,
          city: city || null,
          coords: location,
          aqi: aqiValue,
          advice: adviceText,
          prevention: preventionText,
          source,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("Failed to log to Firestore", err);
      }

      const prevAqi = [...getPreviousAqi(), aqiValue];
      const days = Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - 6 + i);
        return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      });
      setChartData({
        labels: days,
        datasets: [
          {
            label: "AQI",
            data: prevAqi,
            fill: false,
            borderColor: colorCode,
            tension: 0.3,
            pointBackgroundColor: colorCode,
          },
        ],
      });
    } catch (err) {
      alert("Error fetching AQI");
      console.error(err);
    }
  };

  useEffect(() => {
    if (locationStatus !== "Live") return;
    const prev = lastLocationRef.current;
    if (prev) {
      const deltaLat = Math.abs(prev.lat - location.lat);
      const deltaLng = Math.abs(prev.lng - location.lng);
      if (deltaLat < 0.0005 && deltaLng < 0.0005) return; // ~50m threshold
    }
    lastLocationRef.current = location;
    fetchAqi({ source: "auto" });
  }, [location.lat, location.lng, locationStatus]);

  const healthStatus = useMemo(() => {
    if (aqi === null) return { label: "Pending", detail: "Fetch AQI to see status", color: "#475569" };
    if (aqi <= 50) return { label: "Healthy", detail: "Air is clean — stay active", color: "#16a34a" };
    if (aqi <= 100) return { label: "Moderate", detail: "Sensitive groups take light caution", color: "#f59e0b" };
    if (aqi <= 150) return { label: "Caution", detail: "Sensitive groups reduce outdoor time", color: "#ea580c" };
    if (aqi <= 200) return { label: "Unhealthy", detail: "Avoid outdoor exertion; use N95", color: "#dc2626" };
    if (aqi <= 300) return { label: "Very Unhealthy", detail: "Stay indoors; mechanical ventilation", color: "#7c3aed" };
    return { label: "Hazardous", detail: "Shelter indoors; seal windows; use N95", color: "#334155" };
  }, [aqi]);

  const riskChart = useMemo(() => {
    if (aqi === null || aqi <= 150) return null;
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const base = aqi || 0;
    return {
      labels: ["Respiratory", "Cardio", "Eyes", "Fatigue"],
      datasets: [
        {
          label: "Risk level",
          data: [clamp(base), clamp(base - 20), clamp(base - 30), clamp(base - 40)].map((v) => Math.round((v / 300) * 100)),
          backgroundColor: ["#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"],
          borderRadius: 8,
        },
      ],
    };
  }, [aqi]);

  return (
    <div className="page">
      <h1 className="title">🌬️ Live AQI Dashboard</h1>

      <div className="controls">
        <input
          type="text"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Enter city name"
          className="input"
        />
        <button onClick={fetchAqi} className="button">
          Check AQI
        </button>
        <button onClick={requestNotificationPermission} className="button ghost">
          {notificationStatus === "granted" ? "Notifications On" : "Enable Alerts"}
        </button>
      </div>

      <div className="info-row">
        <div className="card small">
          <div className="label">Location</div>
          <div className="value">{location.lat.toFixed(4)}, {location.lng.toFixed(4)}</div>
          <div className="subtle">Status: {locationStatus}</div>
        </div>
        <div className="card small">
          <div className="label">Health Tracker</div>
          <div className="value row">
            <span className="pill" style={{ background: healthStatus.color + "1a", color: healthStatus.color }}>
              {healthStatus.label}
            </span>
            <span>{healthStatus.detail}</span>
          </div>
          <div className="subtle">Notifications: {notificationStatus}</div>
        </div>
      </div>

      <div className="map-card">
        {isMapLoaded && (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "") ? (
          <GoogleMap
            center={location}
            zoom={12}
            mapContainerClassName="map"
            options={{ streetViewControl: false, mapTypeControl: false }}
          >
            <Marker position={location} />
          </GoogleMap>
        ) : (
          <div className="map-placeholder">
            Add VITE_GOOGLE_MAPS_API_KEY in a .env file to see Google Maps.
          </div>
        )}
      </div>

      {aqi !== null && (
        <>
          <div className="card" style={{ borderTop: `8px solid ${color}` }}>
            <div className="aqi" style={{ color }}>
              {aqi}
            </div>
            <div className="advice">{advice}</div>
            <div className="prevention">{prevention}</div>
          </div>

          <div className="chart-card">
            {chartData && <Line data={chartData} options={{ responsive: true, plugins: { legend: { display: false } } }} />}
          </div>

          {riskChart && (
            <>
              <div className="chart-card">
                <div className="card-header">
                  <div className="label">Health risk when AQI is high</div>
                  <div className="subtle">Auto-adjusts based on current AQI</div>
                </div>
                <Bar
                  data={riskChart}
                  options={{
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                      y: { beginAtZero: true, max: 100, ticks: { callback: (v) => `${v}%` } },
                    },
                  }}
                />
              </div>

              <div className="card list-card">
                <div className="label">Diseases & prevention</div>
                <div className="disease-list">
                  {diseases.map((item) => (
                    <div key={item.name} className="disease-item">
                      <div className="disease-name">{item.name}</div>
                      <div className="disease-prevention">{item.prevention}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;
