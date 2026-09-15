// Compact coordinates generated from Ohio State's public campus map service.
// Loaded only when a Columbus schedule is opened.

let rows = [];
let loading = null;
const index = new Map();

function normalized(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/\bLABS?\b/g, "LABORATORY")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function withoutRoom(value) {
  return normalized(value).replace(/\s+[A-Z]?\d+[A-Z]?(?:\s*-\s*[A-Z]?\d+[A-Z]?)?$/, "");
}

function rebuild() {
  index.clear();
  for (const [abbr, name, latitude, longitude] of rows) {
    const location = { abbr, name, latitude, longitude };
    for (const key of [normalized(abbr), normalized(name)]) if (key) index.set(key, location);
  }
}

export async function loadBuildings(url = "data/buildings.json") {
  if (rows.length) return rows;
  loading ??= fetch(url).then(async (response) => {
    if (!response.ok) throw new Error(`buildings ${response.status}`);
    const body = await response.json();
    if (!Array.isArray(body?.buildings)) throw new Error("buildings snapshot has no rows");
    rows = body.buildings;
    rebuild();
    return rows;
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function buildingFor(meeting) {
  const values = [
    meeting?.buildingDescription,
    meeting?.facilityDescription,
    meeting?.buildingDescriptionShort,
    meeting?.facilityDescriptionShort,
  ];
  for (const value of values) {
    for (const key of [normalized(value), withoutRoom(value)]) {
      const found = index.get(key);
      if (found) return found;
    }
  }
  return null;
}

export function haversineMetres(a, b) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const dLat = lat2 - lat1;
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function estimateWalk(meetingA, meetingB) {
  const a = buildingFor(meetingA);
  const b = buildingFor(meetingB);
  if (!a || !b || a === b || a.name === b.name) return null;
  // Straight-line distance needs room for paths and doors. Eighty metres per
  // minute is a practical walking pace; two more minutes cover entering/exiting.
  return Math.max(3, Math.ceil((haversineMetres(a, b) * 1.25) / 80 + 2));
}

export function setBuildingsForTest(next) {
  rows = next;
  loading = null;
  rebuild();
}
