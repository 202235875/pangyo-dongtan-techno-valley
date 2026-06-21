const fs = require("fs");

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: node 03_analysis/scripts/convert_epsg5179_to_wgs84.js input.geojson output.geojson");
  process.exit(1);
}

// EPSG:5179 / Korea 2000 Unified CS
const a = 6378137.0;
const invF = 298.257222101;
const f = 1 / invF;
const e2 = 2 * f - f * f;
const ep2 = e2 / (1 - e2);
const lat0 = degToRad(38.0);
const lon0 = degToRad(127.5);
const k0 = 0.9996;
const x0 = 1000000.0;
const y0 = 2000000.0;

function degToRad(v) {
  return (v * Math.PI) / 180;
}

function radToDeg(v) {
  return (v * 180) / Math.PI;
}

function meridionalArc(phi) {
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
    - (35 * e6 / 3072) * Math.sin(6 * phi)
  );
}

const m0 = meridionalArc(lat0);
const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

function epsg5179ToWgs84(x, y) {
  const m = m0 + (y - y0) / k0;
  const mu = m / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const j1 = 3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32;
  const j2 = 21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32;
  const j3 = 151 * Math.pow(e1, 3) / 96;
  const j4 = 1097 * Math.pow(e1, 4) / 512;
  const fp = mu + j1 * Math.sin(2 * mu) + j2 * Math.sin(4 * mu) + j3 * Math.sin(6 * mu) + j4 * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const c1 = ep2 * cosFp * cosFp;
  const t1 = tanFp * tanFp;
  const n1 = a / Math.sqrt(1 - e2 * sinFp * sinFp);
  const r1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const d = (x - x0) / (n1 * k0);

  const lat = fp - (n1 * tanFp / r1) * (
    d * d / 2
    - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * ep2) * Math.pow(d, 4) / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * ep2 - 3 * c1 * c1) * Math.pow(d, 6) / 720
  );
  const lon = lon0 + (
    d
    - (1 + 2 * t1 + c1) * Math.pow(d, 3) / 6
    + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * ep2 + 24 * t1 * t1) * Math.pow(d, 5) / 120
  ) / cosFp;

  return [radToDeg(lon), radToDeg(lat)];
}

function transformCoords(coords) {
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    return epsg5179ToWgs84(coords[0], coords[1]);
  }
  return coords.map(transformCoords);
}

const geojson = JSON.parse(fs.readFileSync(inputPath, "utf8"));
for (const feature of geojson.features || []) {
  if (feature.geometry && feature.geometry.coordinates) {
    feature.geometry.coordinates = transformCoords(feature.geometry.coordinates);
  }
}
geojson.crs = {
  type: "name",
  properties: { name: "EPSG:4326" }
};

fs.writeFileSync(outputPath, JSON.stringify(geojson, null, 2), "utf8");
