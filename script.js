// ===== 1. Settings =====
// Open-Meteo needs no API key for non-commercial use, so nothing secret lives in this file.
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

// ===== 2. Grab page elements by their ids =====
const form = document.getElementById("search-form");
const input = document.getElementById("city-input");
const locateBtn = document.getElementById("locate-btn");
const unitBtn = document.getElementById("unit-toggle");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("weather-result");
const recentEl = document.getElementById("recent");

// ===== 3. App state =====
let unit = loadValue("airvythe-unit", "C");     // "C" or "F"
let lastPlace = null;                            // {name, latitude, longitude}

// ===== 4. Weather code -> text + emoji (WMO codes used by Open-Meteo) =====
function describe(code, isDay = 1) {
  if (code === 0) return isDay ? ["Clear sky", "☀️"] : ["Clear sky", "🌙"];
  if (code <= 2) return ["Partly cloudy", "⛅"];
  if (code === 3) return ["Overcast", "☁️"];
  if (code === 45 || code === 48) return ["Fog", "🌫️"];
  if (code >= 51 && code <= 57) return ["Drizzle", "🌦️"];
  if (code >= 61 && code <= 67) return ["Rain", "🌧️"];
  if (code >= 71 && code <= 77) return ["Snow", "❄️"];
  if (code >= 80 && code <= 82) return ["Rain showers", "🌧️"];
  if (code === 85 || code === 86) return ["Snow showers", "🌨️"];
  if (code >= 95) return ["Thunderstorm", "⛈️"];
  return ["Unknown", "❔"];
}

// ===== 5. Small helpers =====
function loadValue(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveValue(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = "status " + type;
}

// ===== 6. Talking to the API =====
// Step A: city name -> latitude/longitude
async function findCity(name) {
  const url = `${GEO_URL}?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("The location service is unavailable. Try again later.");
  const data = await response.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`Couldn't find "${name}". Check the spelling and try again.`);
  }
  const r = data.results[0];
  return { name: [r.name, r.admin1, r.country].filter(Boolean).join(", "), latitude: r.latitude, longitude: r.longitude };
}

// Step B: latitude/longitude -> weather
async function getWeather(place) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    hourly: "precipitation_probability",
    timezone: "auto",
    forecast_days: 7,
    temperature_unit: unit === "C" ? "celsius" : "fahrenheit",
    wind_speed_unit: unit === "C" ? "kmh" : "mph",
  });
  const response = await fetch(`${WEATHER_URL}?${params}`);
  if (!response.ok) throw new Error("The weather service returned an error. Try again later.");
  return response.json();
}

// ===== 7. Putting data on the page =====
function render(place, data) {
  const c = data.current;
  const [text, emoji] = describe(c.weather_code, c.is_day);
  const speedUnit = unit === "C" ? "km/h" : "mph";

  document.getElementById("place").textContent = place.name;
  document.getElementById("date").textContent = new Date(c.time).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  document.getElementById("condition").textContent = text;
  document.getElementById("icon").textContent = emoji;
  document.getElementById("temp").textContent = `${Math.round(c.temperature_2m)}°`;
  document.getElementById("feels").textContent = `${Math.round(c.apparent_temperature)}°`;
  document.getElementById("humidity").textContent = `${c.relative_humidity_2m}%`;
  document.getElementById("wind").textContent = `${Math.round(c.wind_speed_10m)} ${speedUnit}`;
  
  const hourIndex = data.hourly.time.findIndex(
    time => time >= c.time
  );

  const rainChance = hourIndex >= 0
    ? data.hourly.precipitation_probability[hourIndex]
    : null;

  document.getElementById("rain-chance").textContent =
    rainChance != null ? `${rainChance}%` : "Unavailable";


  const forecastEl = document.getElementById("forecast");
  forecastEl.replaceChildren();
  data.daily.time.forEach((day, i) => {
    const [label, icon] = describe(data.daily.weather_code[i]);
    const card = document.createElement("div");
    card.className = "day";
    card.title = label;
    const parts = [
      ["name", i === 0 ? "Today" : new Date(day + "T00:00").toLocaleDateString(undefined, { weekday: "short" })],
      ["emoji", icon],
      ["hi", `${Math.round(data.daily.temperature_2m_max[i])}°`],
      ["lo", `${Math.round(data.daily.temperature_2m_min[i])}°`],
    ];
    parts.forEach(([cls, value]) => {
      const el = document.createElement("span");
      el.className = cls;
      el.textContent = value;
      card.appendChild(el);
    });
    forecastEl.appendChild(card);
  });

  resultEl.hidden = false;
}

// ===== 8. Main flow with loading + error handling =====
async function showWeatherFor(place) {
  setStatus("Loading weather...", "loading");
  resultEl.hidden = true;
  try {
    const data = await getWeather(place);
    lastPlace = place;
    render(place, data);
    setStatus("");
  } catch (error) {
    // fetch() throws a TypeError when the network is down
    const offline = error instanceof TypeError;
    setStatus(offline ? "Network problem. Check your internet connection." : error.message, "error");
  }
}

async function searchCity(name) {
  setStatus("Searching...", "loading");
  try {
    const place = await findCity(name);
    addRecent(place.name.split(",")[0]);
    await showWeatherFor(place);
  } catch (error) {
    resultEl.hidden = true;
    const offline = error instanceof TypeError;
    setStatus(offline ? "Network problem. Check your internet connection." : error.message, "error");
  }
}

// ===== 9. Recent searches =====
function addRecent(name) {
  const list = loadValue("airvythe-recent", []).filter(n => n.toLowerCase() !== name.toLowerCase());
  list.unshift(name);
  saveValue("airvythe-recent", list.slice(0, 5));
  renderRecent();
}
function renderRecent() {
  recentEl.replaceChildren();
  loadValue("airvythe-recent", []).forEach(name => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = name;
    b.addEventListener("click", () => { input.value = name; searchCity(name); });
    recentEl.appendChild(b);
  });
}

// ===== 10. Events =====
form.addEventListener("submit", (event) => {
  event.preventDefault();               // stop the page reloading
  const name = input.value.trim();
  if (name) searchCity(name);
});

unitBtn.addEventListener("click", () => {
  unit = unit === "C" ? "F" : "C";
  saveValue("airvythe-unit", unit);
  unitBtn.textContent = `°${unit}`;
  if (lastPlace) showWeatherFor(lastPlace);
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Your browser doesn't support location.", "error");
  setStatus("Getting your location...", "loading");
  navigator.geolocation.getCurrentPosition(
    (pos) => showWeatherFor({ name: "Your location", latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
    () => setStatus("Location permission was denied. Search by city instead.", "error")
  );
});

// ===== 11. Start-up =====
unitBtn.textContent = `°${unit}`;
renderRecent();
