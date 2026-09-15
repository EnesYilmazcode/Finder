#!/usr/bin/env node
// Snapshot the public OSU GIS building layer for client-side walking estimates.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SOURCE = "https://gissvc.osu.edu/arcgis/rest/services/Apps/Campusmap_Buildings_POI/MapServer/1";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "buildings.json");
const TEMP = `${OUT}.tmp`;

export function rowsFrom(features) {
  const rows = [];
  const seen = new Set();
  for (const feature of features ?? []) {
    const value = feature?.attributes ?? {};
    const abbr = String(value.SchedulingAbbreviation ?? "").trim();
    const name = String(value.BLDG_NAME ?? "").trim();
    const latitude = Number(value.Latitude);
    const longitude = Number(value.Longitude);
    // The layer contains a handful of placeholder (0, 0) and out-of-state
    // records. Finder serves Ohio campuses, so neither is a usable walk origin.
    if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < 38 || latitude > 43 || longitude < -85 || longitude > -80) continue;
    const key = `${abbr}|${name}|${latitude}|${longitude}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push([abbr, name, latitude, longitude]);
  }
  return rows.sort((a, b) => a[1].localeCompare(b[1]));
}

export async function fetchBuildings(fetcher = fetch) {
  const query = new URL(`${SOURCE}/query`);
  query.search = new URLSearchParams({
    where: "1=1",
    outFields: "BLDG_NAME,SchedulingAbbreviation,Latitude,Longitude",
    returnGeometry: "false",
    resultRecordCount: "2000",
    f: "json",
  });
  const response = await fetcher(query, {
    headers: { accept: "application/json", "user-agent": "Finder-buildings/1.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OSU GIS returned ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(body.error.message ?? "OSU GIS error");
  return rowsFrom(body.features);
}

export async function main() {
  const buildings = await fetchBuildings();
  if (buildings.length < 100) throw new Error(`refusing to write only ${buildings.length} buildings`);
  const snapshot = {
    source: SOURCE,
    updated: new Date().toISOString(),
    fields: ["scheduling abbreviation", "building name", "latitude", "longitude"],
    buildings,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(TEMP, `${JSON.stringify(snapshot, null, 0)}\n`);
  await rename(TEMP, OUT);
  console.log(`Wrote ${buildings.length} buildings.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
