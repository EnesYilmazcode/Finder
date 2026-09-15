import test from "node:test";
import assert from "node:assert/strict";

import { buildingFor, estimateWalk, haversineMetres, setBuildingsForTest } from "../js/buildings.js";
import { rowsFrom } from "../scripts/fetch-buildings.mjs";

test("the GIS snapshot keeps named buildings with usable coordinates", () => {
  assert.deepEqual(rowsFrom([
    { attributes: { SchedulingAbbreviation: "DL", BLDG_NAME: "Dreese Laboratories", Latitude: 40, Longitude: -83 } },
    { attributes: { BLDG_NAME: "", Latitude: 40, Longitude: -83 } },
    { attributes: { BLDG_NAME: "Placeholder", Latitude: 0, Longitude: 0 } },
  ]), [["DL", "Dreese Laboratories", 40, -83]]);
});

test("rooms match their building and produce a conservative walk estimate", () => {
  setBuildingsForTest([
    ["DL", "Dreese Laboratories", 40, -83],
    ["PA", "Page Hall", 40.002, -83],
  ]);
  const dreese = { buildingDescription: "Dreese Laboratories 264", buildingDescriptionShort: "DL 264" };
  const page = { buildingDescription: "Page Hall 10" };
  assert.equal(buildingFor(dreese).abbr, "DL");
  assert.ok(haversineMetres(buildingFor(dreese), buildingFor(page)) > 200);
  assert.ok(estimateWalk(dreese, page) >= 5);
  assert.equal(estimateWalk(dreese, { buildingDescription: "Dreese Laboratories 113" }), null);
});
