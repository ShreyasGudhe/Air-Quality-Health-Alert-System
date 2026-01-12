import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import "chart.js/auto";
import "./App.css";
import { db } from "./firebase";

const FALLBACK_IAQI_KEYS = ["pm25", "pm10", "o3", "no2", "so2", "co"];
const CITY_RANKING_CANDIDATES = ["Delhi", "Mumbai", "Bengaluru", "Chennai", "Kolkata", "Hyderabad"];
const RISK_MODEL = [
  { label: "Respiratory distress", base: 0.25, slope: 0.0035 },
  { label: "Cardiovascular strain", base: 0.2, slope: 0.0028 },
  { label: "Eye & skin irritation", base: 0.15, slope: 0.002 },
  { label: "Neurological fatigue", base: 0.1, slope: 0.0016 },
];
const WAQI_API_TOKEN = import.meta.env.VITE_WAQI_TOKEN || "5e229522a40e5a7c1980cd67c4d29ad75822bd92";
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

const parseStationCoordinates = (value) => {
  if (!value) return null;
  const toNumber = (input) => {
    const num = Number(input);
    return Number.isFinite(num) ? num : null;
  };
  if (Array.isArray(value) && value.length >= 2) {
    const lat = toNumber(value[0]);
    const lng = toNumber(value[1]);
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }
  if (typeof value === "string") {
    const parts = value.split(/[, ]+/).filter(Boolean);
    if (parts.length >= 2) {
      const lat = toNumber(parts[0]);
      const lng = toNumber(parts[1]);
      if (lat !== null && lng !== null) {
        return { lat, lng };
      }
    }
  }
  if (typeof value === "object" && value !== null) {
    const lat = toNumber(value.lat);
    const lng = toNumber(value.lng ?? value.lon);
    if (lat !== null && lng !== null) {
      return { lat, lng };
    }
  }
  return null;
};

const deriveAqiValue = (stationData) => {
  const raw = stationData?.aqi;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  for (const key of FALLBACK_IAQI_KEYS) {
    const candidate = stationData?.iaqi?.[key]?.v;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return Math.round(candidate);
    }
  }
  return null;
};

const getPreviousAqi = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 200) + 30);

const healthAdvice = (aqiValue) => {
  if (aqiValue <= 50) return ["Air quality is good. No precautions needed.", "Stay active outdoors.", "#2ecc71"];
  if (aqiValue <= 100)
    return [
      "Moderate air quality. Sensitive groups should take caution.",
      "Limit prolonged outdoor activity if you have respiratory issues.",
      "#f1c40f",
    ];
  if (aqiValue <= 150) return ["Unhealthy for sensitive groups.", "Reduce outdoor activity. Use mask if needed.", "#e67e22"];
  if (aqiValue <= 200) return ["Unhealthy.", "Avoid outdoor activity. People with health issues should stay indoors.", "#e74c3c"];
  if (aqiValue <= 300) return ["Very Unhealthy.", "Stay indoors. Wear N95 masks if you go outside.", "#8e44ad"];
  return ["Hazardous!", "Avoid all outdoor activity. Keep windows closed.", "#34495e"];
};

const POLLUTANT_COLORS = ["#38bdf8", "#fb7185", "#f97316", "#a855f7", "#22d3ee", "#facc15"];

const buildPollutantChart = (iaqi) => {
  if (!iaqi) return null;
  const keys = ["pm25", "pm10", "no2", "o3", "so2", "co"];
  const entries = keys
    .map((key, index) => {
      const value = Number(iaqi?.[key]?.v ?? NaN);
      return Number.isFinite(value) ? { label: key.toUpperCase(), value, color: POLLUTANT_COLORS[index % POLLUTANT_COLORS.length] } : null;
    })
    .filter(Boolean);
  if (!entries.length) return null;
  return {
    labels: entries.map((entry) => entry.label),
    datasets: [
      {
        data: entries.map((entry) => entry.value),
        backgroundColor: entries.map((entry) => entry.color),
        borderWidth: 0,
      },
    ],
  };
};

function App() {
  const [city, setCity] = useState("");
  const [aqi, setAqi] = useState(null);
  const [advice, setAdvice] = useState("");
  const [prevention, setPrevention] = useState("");
  const [chartData, setChartData] = useState(null);
  const [color, setColor] = useState("#2ecc71");
  const defaultLocation = useMemo(() => ({ lat: 28.6139, lng: 77.209 }), []);
  const [location, setLocation] = useState(null);
  const [locationStatus, setLocationStatus] = useState("Idle");
  const [locationLabel, setLocationLabel] = useState("Awaiting live location…");
  const [notificationStatus, setNotificationStatus] = useState("off");
  const [history, setHistory] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("Awaiting data");
  const [cityRankings, setCityRankings] = useState({ loading: false, data: [], error: null });
  const lastLocationRef = useRef(null);
  const locationRef = useRef(null);
  const lastAlertRef = useRef({ timestamp: 0, signature: null });
  const [pollutantChart, setPollutantChart] = useState(null);
  const [alertThreshold, setAlertThreshold] = useState(150);
  const [alertLog, setAlertLog] = useState([]);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshMinutes, setAutoRefreshMinutes] = useState(10);
  const [nextAutoRefresh, setNextAutoRefresh] = useState(null);
  const ipFallbackTriggeredRef = useRef(false);
  const lastResolvedPlacenameRef = useRef(null);

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
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    // Browsers block geolocation on insecure origins; force HTTPS outside localhost.
    if (typeof window === "undefined") return;
    if (window.location.hostname === "localhost") return;
    if (window.location.protocol === "http:") {
      const secureUrl = window.location.href.replace(/^http:/, "https:");
      window.location.replace(secureUrl);
    }
  }, []);

  

  const fetchCityRankings = useCallback(async () => {
    if (!CITY_RANKING_CANDIDATES.length) return;
    setCityRankings((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const ranked = await Promise.all(
        CITY_RANKING_CANDIDATES.map(async (cityName) => {
          try {
            const endpoint = `https://api.waqi.info/feed/${encodeURIComponent(cityName)}/?token=${WAQI_API_TOKEN}`;
            const res = await axios.get(endpoint);
            if (res.data.status !== "ok") {
              throw new Error("City unavailable");
            }
            const value = deriveAqiValue(res.data.data);
            const label = res.data.data?.city?.name || cityName;
            return { label, city: cityName, aqi: value };
          } catch (err) {
            console.warn(`Ranking fetch failed for ${cityName}`, err);
            return { label: cityName, city: cityName, aqi: null };
          }
        })
      );

      const valid = ranked.filter((entry) => entry.aqi !== null).sort((a, b) => a.aqi - b.aqi);
      setCityRankings({
        loading: false,
        data: valid,
        error: valid.length ? null : "No AQI data available for tracked cities.",
      });
    } catch (err) {
      console.error("City ranking error", err);
      setCityRankings({ loading: false, data: [], error: "Failed to load city rankings." });
    }
  }, []);

  useEffect(() => {
    fetchCityRankings();
  }, [fetchCityRankings]);

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) return setNotificationStatus("unsupported");
    if (Notification.permission === "granted") {
      setNotificationStatus("granted");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotificationStatus(perm);
  };

  useEffect(() => {
    requestNotificationPermission();
  }, []);

  const pushNotification = (title, body, signature = `${title}-${body}`) => {
    if (notificationStatus !== "granted") return false;
    const now = Date.now();
    const { timestamp, signature: prevSignature } = lastAlertRef.current;
    const cooledDown = now - timestamp > ALERT_COOLDOWN_MS;
    if (!cooledDown && prevSignature === signature) {
      return false;
    }
    try {
      new Notification(title, { body });
      lastAlertRef.current = { timestamp: now, signature };
      return true;
    } catch (err) {
      console.warn("Notification error", err);
      return false;
    }
  };

  const fetchAqi = useCallback(
    async ({ source = "manual", forceLocation = false, geoOverride = null } = {}) => {
    try {
      const shouldUseGeo = forceLocation || !city;
      const geoTarget = geoOverride || locationRef.current;
      if (shouldUseGeo && !geoTarget) {
        if (source === "manual") {
          alert("Allow location access or enter a city to fetch AQI.");
        }
        return;
      }
      if (!shouldUseGeo && !city) {
        alert("Enter a city name to fetch AQI data.");
        return;
      }
      const endpoint = shouldUseGeo
        ? `https://api.waqi.info/feed/geo:${geoTarget.lat};${geoTarget.lng}/?token=${WAQI_API_TOKEN}`
        : `https://api.waqi.info/feed/${encodeURIComponent(city)}/?token=${WAQI_API_TOKEN}`;

      const res = await axios.get(endpoint);
      if (res.data.status !== "ok") {
        alert("City not found or API error");
        return;
      }

      const aqiValue = deriveAqiValue(res.data.data);
      if (aqiValue === null) {
        alert("AQI readings are unavailable for this location right now.");
        return;
      }
      setAqi(aqiValue);
      const stationMeta = res.data.data?.city;
      const observedAt = res.data.data?.time?.s || new Date().toLocaleString();
      setLastUpdated(observedAt);
      const stationCoords = parseStationCoordinates(stationMeta?.geo || stationMeta?.location);
      const derivedLabel = !shouldUseGeo && city?.trim()
        ? city.trim()
        :
          stationMeta?.name ||
          (geoTarget ? `Lat ${geoTarget.lat.toFixed(2)}, Lng ${geoTarget.lng.toFixed(2)}` : "Your location");
      const [adviceText, preventionText, colorCode] = healthAdvice(aqiValue);
      setAdvice(adviceText);
      setPrevention(preventionText);
      setColor(colorCode);
      const label = derivedLabel;
      setLocationLabel(label);
      if (!shouldUseGeo) {
        if (stationCoords) {
          setLocation(stationCoords);
        }
        setLocationStatus("City lookup");
      }
      if (source === "manual") {
        alert(`Current AQI in ${label} is ${aqiValue}`);
      }

      if (aqiValue >= alertThreshold) {
        const signature = `${label}-${Math.round(aqiValue / 5)}`;
        const notified = pushNotification(
          "AQI Alert",
          `${label} AQI is ${aqiValue}. ${adviceText}`,
          signature
        );
        if (notified) {
          setAlertLog((prev) => {
            const entry = {
              id: `${Date.now()}-${label}`,
              label,
              aqi: aqiValue,
              observedAt,
              threshold: alertThreshold,
            };
            return [entry, ...prev].slice(0, 5);
          });
        }
      }

      try {
        await addDoc(collection(db, "aqi_readings"), {
          label,
          city: city || null,
          coords: geoTarget,
          aqi: aqiValue,
          advice: adviceText,
          prevention: preventionText,
          source,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn("Failed to log to Firestore", err);
      }

      setHistory((prev) => {
        const nextEntry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          label,
          aqi: aqiValue,
          observedAt,
        };
        return [nextEntry, ...prev].slice(0, 6);
      });

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
      setPollutantChart(buildPollutantChart(res.data.data?.iaqi));
    } catch (err) {
      alert("Error fetching AQI");
      console.error(err);
    }
  }, [alertThreshold, city, locationRef, notificationStatus]);

  const resolveApproximateLocation = useCallback(async ({ force = false } = {}) => {
    if (ipFallbackTriggeredRef.current && !force) return;
    ipFallbackTriggeredRef.current = true;
    try {
      setLocationStatus("Resolving network location…");
      const response = await fetch("https://ipapi.co/json/");
      if (!response.ok) throw new Error("IP geolocation failed");
      const data = await response.json();
      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Missing coordinates");
      const coords = { lat, lng };
      const labelParts = [data.city, data.region, data.country_name].filter(Boolean);
      setLocation(coords);
      setLocationStatus("Approximate via network");
      setLocationLabel(labelParts.join(", ") || `${lat.toFixed(2)}, ${lng.toFixed(2)}`);
      fetchAqi({ source: "auto", forceLocation: true, geoOverride: coords });
    } catch (err) {
      console.warn("Approximate location fallback failed", err);
      setLocationStatus("Enter a city to start");
      setLocationLabel(`Fallback • ${defaultLocation.lat.toFixed(2)}, ${defaultLocation.lng.toFixed(2)}`);
      ipFallbackTriggeredRef.current = false;
    }
  }, [defaultLocation.lat, defaultLocation.lng, fetchAqi]);

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

  const mlRiskPredictions = useMemo(() => {
    if (aqi === null) return [];
    return RISK_MODEL.map((model) => {
      const probability = Math.max(0.05, Math.min(0.98, model.base + model.slope * aqi));
      return { label: model.label, probability: Math.round(probability * 100) };
    });
  }, [aqi]);

  const riskColorFor = (probability) => {
    if (probability >= 75) return "#dc2626";
    if (probability >= 55) return "#f97316";
    if (probability >= 35) return "#facc15";
    return "#22c55e";
  };

  const readinessChecklist = useMemo(() => {
    const severity = aqi ?? 0;
    const tiers = {
      respirator: severity >= 150 ? "urgent" : severity >= 90 ? "recommended" : "optional",
      purifier: severity >= 120 ? "recommended" : "optional",
      hydration: severity >= 80 ? "recommended" : "optional",
      alerts: notificationStatus === "granted" ? "done" : "urgent",
      commute: severity >= 110 ? "urgent" : "optional",
    };
    return [
      {
        label: "Wear N95/FFP2 outdoors",
        hint: tiers.respirator === "urgent" ? "Required for AQI spikes" : "Keep mask handy",
        status: tiers.respirator,
      },
      {
        label: "Run air purifier or ventilation",
        hint: tiers.purifier === "recommended" ? "Cycle HEPA every 2h" : "Ventilate when AQI < 100",
        status: tiers.purifier,
      },
      {
        label: "Stay hydrated + limit exertion",
        hint: tiers.hydration === "recommended" ? "Sip water every hour" : "Monitor energy levels",
        status: tiers.hydration,
      },
      {
        label: "Enable spike notifications",
        hint: notificationStatus === "granted" ? "Live alerts active" : "Grant permission for browser alerts",
        status: tiers.alerts,
      },
      {
        label: "Plan commute flexibly",
        hint: tiers.commute === "urgent" ? "Avoid peak traffic outdoors" : "Track AQI before leaving",
        status: tiers.commute,
      },
    ];
  }, [aqi, notificationStatus]);

  const locationText =
    locationLabel ||
    (location ? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}` : `${defaultLocation.lat.toFixed(2)}, ${defaultLocation.lng.toFixed(2)}`);
  const latestManualReading = history[0];
  const mapCenter = location || defaultLocation;
  const isLive = locationStatus === "Live";
  const isCityLookup = locationStatus === "City lookup";
  const aqiPercent = useMemo(() => {
    if (aqi === null) return 6;
    return Math.min(400, Math.max(0, aqi)) / 4;
  }, [aqi]);
  const updatedLabel = lastUpdated || latestManualReading?.observedAt || "Awaiting data";
  const locationModeLabel = isLive ? "GPS tracking" : isCityLookup ? "City lookup" : city ? "City lookup" : "Setup required";
  const locationModeHint = isLive || isCityLookup ? locationText : city || "Add a city name to start";
  const cleanestCity = cityRankings.data?.[0];
  const mostPollutedCity = cityRankings.data?.[cityRankings.data.length - 1];
  const aqiDelta = useMemo(() => {
    if (aqi === null || !latestManualReading) return null;
    return aqi - latestManualReading.aqi;
  }, [aqi, latestManualReading]);

  const handleGeoSuccess = useCallback((pos) => {
    const coords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    setLocation(coords);
    setLocationStatus("Live");
  }, []);

  const handleGeoError = useCallback(
    (err) => {
      let message = err?.message || "Unable to get location";
      if (!window.isSecureContext) {
        message = "Use HTTPS or localhost for live location";
      } else if (err?.code === 1) {
        message = "Permission denied — allow location access";
      } else if (err?.code === 2) {
        message = "Position unavailable";
      } else if (err?.code === 3) {
        message = "Location timed out";
      }
      setLocationStatus(message);
      setLocationLabel(`Fallback • ${defaultLocation.lat.toFixed(2)}, ${defaultLocation.lng.toFixed(2)}`);
      resolveApproximateLocation({ force: true });
    },
    [defaultLocation.lat, defaultLocation.lng, resolveApproximateLocation]
  );

  const handleFetchClick = () => {
    if (city.trim()) {
      fetchAqi({ source: "manual" });
      return;
    }
    if (location) {
      fetchAqi({ source: "manual", forceLocation: true });
      return;
    }
    resolveApproximateLocation({ force: true });
    alert("Fetching your approximate location. Please allow permissions or enter a city manually.");
  };

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      setLocationStatus("Geolocation not supported");
      setLocationLabel(`Fallback • ${defaultLocation.lat.toFixed(2)}, ${defaultLocation.lng.toFixed(2)}`);
      resolveApproximateLocation({ force: true });
      return;
    }

    setLocationStatus("Locating…");
    const watchId = navigator.geolocation.watchPosition(handleGeoSuccess, handleGeoError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 10000,
    });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [defaultLocation.lat, defaultLocation.lng, handleGeoError, handleGeoSuccess, resolveApproximateLocation]);

  useEffect(() => {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(handleGeoSuccess, handleGeoError, {
      enableHighAccuracy: true,
      timeout: 8000,
    });
  }, [handleGeoError, handleGeoSuccess]);

  useEffect(() => {
    if (location) return;
    const timer = setTimeout(() => {
      resolveApproximateLocation();
    }, 6000);
    return () => clearTimeout(timer);
  }, [location, resolveApproximateLocation]);

  useEffect(() => {
    if (locationStatus !== "Live" || !location) return;
    const prev = lastLocationRef.current;
    if (prev) {
      const deltaLat = Math.abs(prev.lat - location.lat);
      const deltaLng = Math.abs(prev.lng - location.lng);
      if (deltaLat < 0.0005 && deltaLng < 0.0005) return; // ~50m threshold
    }
    lastLocationRef.current = location;
    fetchAqi({ source: "auto", forceLocation: true });
  }, [fetchAqi, location?.lat, location?.lng, locationStatus]);

  useEffect(() => {
    let cancelled = false;
    if (!location) {
      lastResolvedPlacenameRef.current = null;
      setLocationLabel("Awaiting live location…");
      return () => {
        cancelled = true;
      };
    }

    const previous = lastResolvedPlacenameRef.current;
    if (previous) {
      const deltaLat = Math.abs(previous.lat - location.lat);
      const deltaLng = Math.abs(previous.lng - location.lng);
      if (deltaLat < 0.001 && deltaLng < 0.001) {
        setLocationLabel(previous.label);
        return () => {
          cancelled = true;
        };
      }
    }

    const fetchPlacename = async () => {
      if (!isMapLoaded || !window.google) {
        console.warn("Google Maps API not loaded, skipping reverse geocode");
        if (!cancelled) {
          const fallbackLabel = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
          lastResolvedPlacenameRef.current = { lat: location.lat, lng: location.lng, label: fallbackLabel };
          setLocationLabel(fallbackLabel);
        }
        return;
      }
      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode(
        { location: { lat: location.lat, lng: location.lng } },
        (results, status) => {
          if (status === window.google.maps.GeocoderStatus.OK && results[0]) {
            const namedLocation = results[0].formatted_address || `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
            if (!cancelled) {
              const nextLabel = namedLocation;
              lastResolvedPlacenameRef.current = { lat: location.lat, lng: location.lng, label: nextLabel };
              setLocationLabel(nextLabel);
            }
          } else {
            console.warn("Reverse geocode failed", status);
            if (!cancelled) {
              const fallbackLabel = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
              lastResolvedPlacenameRef.current = { lat: location.lat, lng: location.lng, label: fallbackLabel };
              setLocationLabel(fallbackLabel);
            }
          }
        }
      );
    };

    fetchPlacename();

    return () => {
      cancelled = true;
    };
  }, [location?.lat, location?.lng, isMapLoaded]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      setNextAutoRefresh(null);
      return;
    }
    const intervalMinutes = Math.max(1, autoRefreshMinutes);
    const intervalMs = intervalMinutes * 60_000;
    const updateNextRun = () => {
      const nextTime = new Date(Date.now() + intervalMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setNextAutoRefresh(nextTime);
    };
    const triggerRefresh = () => {
      if (locationRef.current) {
        fetchAqi({ source: "auto", forceLocation: true });
        return;
      }
      if (city.trim()) {
        fetchAqi({ source: "auto" });
        return;
      }
      resolveApproximateLocation();
    };
    triggerRefresh();
    updateNextRun();
    const timer = setInterval(() => {
      triggerRefresh();
      updateNextRun();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoRefreshEnabled, autoRefreshMinutes, city, fetchAqi, resolveApproximateLocation]);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    if (locationRef.current) {
      fetchAqi({ source: "auto", forceLocation: true });
      return;
    }
    if (city.trim()) {
      fetchAqi({ source: "auto" });
      return;
    }
    resolveApproximateLocation();
  }, [autoRefreshEnabled, city, fetchAqi, resolveApproximateLocation]);

  return (
    <div className="page">
      <nav className="nav">
        <div className="brand">
          <span className="brand-dot" />
          Atmosense
        </div>
        <div className="nav-badge">
          <span className={`status-dot ${isLive ? "live" : ""}`} />
          {isLive ? "Live feed active" : "Awaiting location lock"}
        </div>
      </nav>
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Air wellness intelligence</p>
          <h1 className="title">
            <span className="title-icon" aria-hidden="true">🌬️</span>
            <span className="title-text">Live AQI Dashboard</span>
          </h1>
          <p className="lead">
            {aqi !== null && advice
              ? `${advice} Keep tabs on ${locationLabel || "your area"} in real time.`
              : `Stay ahead of pollution spikes for ${locationLabel || "your location"} with live guidance.`}
          </p>
          <div className="controls hero-controls">
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Enter a city or locality"
              className="input"
            />
            <button onClick={handleFetchClick} className="button">
              Check AQI
            </button>
          </div>
          <div className="hero-meta">
            <div className="hero-badge">
              <span>Current location</span>
              <strong>{locationText}</strong>
            </div>
            <div className="hero-badge">
              <span>Location status</span>
              <strong>{locationStatus}</strong>
            </div>
            <div className="hero-badge">
              <span>Notifications</span>
              <strong>{notificationStatus}</strong>
            </div>
          </div>
        </div>
        <div className="hero-spotlight">
          <div className="hero-spotlight-label">Realtime AQI</div>
          <div
            className="hero-spotlight-value"
            style={{ color: aqi !== null ? healthStatus.color : "#94a3b8" }}
          >
            {aqi !== null ? aqi : "--"}
          </div>
          <div className="hero-spotlight-foot">{advice || "Run a check to personalize guidance."}</div>
          <div className="hero-spotlight-subtle">
            {prevention || "Enable live readings to receive proactive prevention tips."}
          </div>
        </div>
      </header>

      <section className="signal-row">
        <div className="signal-card primary">
          <div className="signal-chip">Guardian status</div>
          <div className="signal-value" style={{ color: healthStatus.color }}>{healthStatus.label}</div>
          <p className="signal-meta">{healthStatus.detail}</p>
          <div className="signal-meter" aria-hidden="true">
            <div className="signal-meter-fill" style={{ width: `${aqiPercent}%`, background: healthStatus.color }} />
          </div>
        </div>
        <div className="signal-card">
          <div className="signal-chip">Last sync</div>
          <div className="signal-value subtle-value">{updatedLabel}</div>
          <p className="signal-meta">Alerts: {notificationStatus === "granted" ? "Enabled" : "Pending permission"}</p>
          <div className="signal-foot">
            {aqiDelta !== null ? `Δ vs last manual: ${aqiDelta > 0 ? "+" : ""}${aqiDelta} AQI` : "Run a manual check to compare"}
          </div>
          <div className="signal-foot subtle-foot">Mode: {isLive ? "Auto-refresh" : "Manual"}</div>
        </div>
        <div className="signal-card">
          <div className="signal-chip">Airwatch scope</div>
          <div className="signal-value subtle-value">{locationModeLabel}</div>
          <p className="signal-meta">{locationModeHint}</p>
          <div className="signal-foot">
            {cleanestCity && mostPollutedCity ? (
              <>
                {cleanestCity.label}: {cleanestCity.aqi} AQI •
                <span className="signal-foot-strong"> {mostPollutedCity.label}: {mostPollutedCity.aqi} AQI</span>
              </>
            ) : (
              "Ranking data syncing…"
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="section-label">Live snapshot</p>
            <h2 className="section-title">Environment overview</h2>
          </div>
          <p className="section-subtitle">Coordinates refresh automatically every time you move ~50m.</p>
        </div>
        <div className="insight-grid">
          <div className="card small">
            <div className="label">Location</div>
            <div className="value">{locationText}</div>
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
          <div className="card small accent">
            <div className="label">Latest reading</div>
            <div className="value">{aqi !== null ? aqi : latestManualReading?.aqi || "--"}</div>
            <div className="subtle">
              {latestManualReading
                ? `Manual check • ${latestManualReading.label}`
                : aqi !== null
                ? "Live auto refresh"
                : "Use Check AQI to capture a measurement"}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="section-label">Situation room</p>
            <h2 className="section-title">Air quality intelligence</h2>
          </div>
          <p className="section-subtitle">Manual spot checks, ML heuristics, rankings, and maps stay visually aligned.</p>
        </div>
        <div className="dashboard-grid">
          <div className="stack">
            <div className="card history-card">
            <div className="label">Recent AQI readings</div>
            <div className="history-list">
              {history.length === 0 ? (
                <div className="empty-state">No manual checks yet. Use “Check AQI” to capture one.</div>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="history-item">
                    <div className="history-meta">
                      <div className="history-city">{entry.label}</div>
                      <div className="history-time">Observed at {entry.observedAt}</div>
                    </div>
                    <div className="history-aqi" aria-label="Recorded AQI">{entry.aqi}</div>
                  </div>
                ))
              )}
            </div>
          </div>

            {mlRiskPredictions.length > 0 && (
              <div className="card risk-card">
                <div className="card-header">
                  <div className="label">ML-based health risk prediction</div>
                  <div className="subtle">Heuristic model scaled to current AQI</div>
                </div>
                <div className="risk-list">
                  {mlRiskPredictions.map((risk) => (
                    <div key={risk.label} className="risk-item">
                      <div className="risk-info">
                        <div className="risk-name">{risk.label}</div>
                        <div className="risk-bar" aria-hidden="true">
                          <div
                            className="risk-bar-fill"
                            style={{ width: `${risk.probability}%`, background: riskColorFor(risk.probability) }}
                          />
                        </div>
                      </div>
                      <div className="risk-score">{risk.probability}%</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="stack">
          <div className="card ranking-card">
            <div className="card-header">
              <div className="label">City-wise AQI ranking</div>
              <button className="button tiny" onClick={fetchCityRankings} disabled={cityRankings.loading}>
                {cityRankings.loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div className="ranking-hint">Lower AQI indicates cleaner air • Powered by WAQI live feed</div>
            {cityRankings.error && <div className="error-text">{cityRankings.error}</div>}
            {!cityRankings.error && cityRankings.data.length === 0 && !cityRankings.loading && (
              <div className="subtle">No ranking data yet. Try refreshing.</div>
            )}
            <div className="ranking-list">
              {cityRankings.loading && <div className="subtle">Loading tracked cities…</div>}
              {!cityRankings.loading &&
                cityRankings.data.map((entry, index) => (
                  <div key={entry.label} className="ranking-item">
                    <div className="ranking-rank">#{index + 1}</div>
                    <div className="ranking-meta">
                      <div className="ranking-city">{entry.label}</div>
                    </div>
                    <div className="ranking-aqi">{entry.aqi}</div>
                  </div>
                ))}
            </div>
          </div>

            <div className="map-card">
              {isMapLoaded && (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "") ? (
                <GoogleMap
                  center={mapCenter}
                  zoom={12}
                  mapContainerClassName="map"
                  options={{ streetViewControl: false, mapTypeControl: false }}
                >
                  {location && <Marker position={location} />}
                </GoogleMap>
              ) : (
                <div className="map-placeholder">
                  Add VITE_GOOGLE_MAPS_API_KEY in a .env file to see Google Maps.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <p className="section-label">Automation & alerts</p>
            <h2 className="section-title">Proactive monitoring</h2>
          </div>
          <p className="section-subtitle">Tune refresh cadence, custom alerts, and review recent spikes without touching the map.</p>
        </div>
        <div className="automation-grid">
          <div className="card automation-card">
            <div className="card-header">
              <div className="label">Auto refresh</div>
              <span className={`status-chip ${autoRefreshEnabled ? "active" : ""}`}>
                {autoRefreshEnabled ? "Running" : "Manual"}
              </span>
            </div>
            <p className="subtle">Automatically capture AQI snapshots from your live location even when you forget.</p>
            <button
              className={`toggle ${autoRefreshEnabled ? "active" : ""}`}
              onClick={() => setAutoRefreshEnabled((prev) => !prev)}
            >
              {autoRefreshEnabled ? "Disable auto-refresh" : "Enable auto-refresh"}
            </button>
            <label className="automation-label" htmlFor="cadence-select">Refresh cadence</label>
            <select
              id="cadence-select"
              className="automation-select"
              value={autoRefreshMinutes}
              onChange={(e) => setAutoRefreshMinutes(Number(e.target.value))}
            >
              {[5, 10, 15, 30, 60].map((minutes) => (
                <option key={minutes} value={minutes}>
                  Every {minutes} min
                </option>
              ))}
            </select>
            <div className="subtle">Next auto refresh: {nextAutoRefresh || "Manual only"}</div>
          </div>

          <div className="card automation-card">
            <div className="card-header">
              <div className="label">Alert threshold</div>
              <span className="alert-pill">{alertThreshold} AQI</span>
            </div>
            <p className="subtle">We notify you the moment AQI exceeds your personal limit. Lower it for sensitive groups.</p>
            <input
              type="range"
              min="50"
              max="400"
              step="10"
              value={alertThreshold}
              className="threshold-slider"
              onChange={(e) => setAlertThreshold(Number(e.target.value))}
            />
            <div className="threshold-scale">
              <span>50</span>
              <span>200</span>
              <span>400</span>
            </div>
            <p className="subtle">Alert fires at ≥ {alertThreshold} AQI.</p>
          </div>

          <div className="card automation-card alert-log-card">
            <div className="card-header">
              <div className="label">Recent alerts</div>
              <div className="subtle">{alertLog.length ? `Last spike • ${alertLog[0].observedAt}` : "No alerts yet"}</div>
            </div>
            <div className="alert-log">
              {alertLog.length === 0 ? (
                <div className="empty-state">Threshold alerts will appear here.</div>
              ) : (
                alertLog.map((entry) => (
                  <div key={entry.id} className="alert-log-entry">
                    <div>
                      <div className="alert-log-title">{entry.label}</div>
                      <div className="alert-log-meta">Observed at {entry.observedAt}</div>
                    </div>
                    <div className="alert-log-value">{entry.aqi}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {aqi !== null && (
        <section className="section">
          <div className="section-heading">
            <div>
              <p className="section-label">Health forecasting</p>
              <h2 className="section-title">Deep analytics</h2>
            </div>
            <p className="section-subtitle">Trend lines, risk bars, and disease guidance mirror the latest AQI.</p>
          </div>
          <div className="analytics-grid">
          <div className="card featured" style={{ borderTop: `8px solid ${color}` }}>
            <div className="aqi" style={{ color }}>
              {aqi}
            </div>
            <div className="advice">{advice}</div>
            <div className="prevention">{prevention}</div>
          </div>

          <div className="chart-card wide">
            {chartData && <Line data={chartData} options={{ responsive: true, plugins: { legend: { display: false } } }} />}
          </div>

          {pollutantChart && (
            <div className="chart-card donut-card">
              <div className="card-header">
                <div className="label">Pollutant composition</div>
                <div className="subtle">Derived from latest IAQI feed</div>
              </div>
              <Doughnut
                data={pollutantChart}
                options={{
                  plugins: {
                    legend: {
                      position: "bottom",
                      labels: { color: "#e2e8f0" },
                    },
                  },
                  cutout: "60%",
                }}
              />
            </div>
          )}

          {riskChart && (
            <div className="paired-column">
              <div className="chart-card risk-visual">
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

              <div className="card list-card prevention-card">
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
            </div>
          )}
          <div className="card action-card">
            <div className="card-header">
              <div className="label">Readiness checklist</div>
              <div className="subtle">Adaptive guidance for your current AQI</div>
            </div>
            <div className="checklist">
              {readinessChecklist.map((item) => (
                <div key={item.label} className={`checklist-item ${item.status}`}>
                  <span className="check-icon" aria-hidden="true" />
                  <div>
                    <div className="checklist-label">{item.label}</div>
                    <div className="checklist-hint">{item.hint}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          </div>
        </section>
      )}
    </div>
  );
}

export default App;