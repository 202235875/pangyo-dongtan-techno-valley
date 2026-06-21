const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = process.cwd();
const RAW = path.join(ROOT, "02_data", "raw");
const PROCESSED = path.join(ROOT, "02_data", "processed");
const ENV_PATH = path.join(ROOT, ".env");
const SERVICE_CUTOFF = "2026-06-18";
const BUFFER_M = 1000;
const MAX_SECONDS = 60 * 60;

const ISOCHRONE_STARTS = {
  pangyo_phase1: { stationName: "판교", linePattern: /신분당|경강/ },
  dongtan_techno_valley: { stationName: "동탄", linePattern: /GTX_A|GTX/ },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readDotEnv(filePath) {
  return Object.fromEntries(
    fs.readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^\s*[^#=]+=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

function toNum(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseTsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split("\t");
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split("\t");
    const row = {};
    header.forEach((key, index) => { row[key] = cols[index] ?? ""; });
    return row;
  });
}

function readZipEntry(zipPath, entryName) {
  const script = `
    Add-Type -AssemblyName System.IO.Compression.FileSystem;
    $z=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path '${zipPath.replace(/'/g, "''")}'));
    $e=$z.GetEntry('${entryName.replace(/'/g, "''")}');
    $r=New-Object System.IO.StreamReader($e.Open(), [System.Text.Encoding]::UTF8);
    Write-Output $r.ReadToEnd();
    $r.Close();
    $z.Dispose();
  `;
  return execFileSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
  });
}

function isSubwayRowInService(row) {
  const begin = String(row.effective_begin || row.begin || "").trim();
  return !begin || begin <= SERVICE_CUTOFF;
}

function loadSubwayNetwork() {
  const zipPath = path.join(RAW, "subway", "subway_network.zip");
  const nodes = parseTsv(readZipEntry(zipPath, "network/nodes.tsv"))
    .filter(isSubwayRowInService)
    .map((row) => ({
      id: Number(row.id),
      line: row.linenm || "",
      station: row.statnm || "",
      x: Number(row.x_5179),
      y: Number(row.y_5179),
      lat: Number(row.lat),
      lng: Number(row.lng),
    }))
    .filter((node) => Number.isFinite(node.id) && Number.isFinite(node.x) && Number.isFinite(node.y));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const graph = new Map(nodes.map((node) => [node.id, []]));
  for (const link of parseTsv(readZipEntry(zipPath, "network/links.tsv")).filter(isSubwayRowInService)) {
    const from = Number(link.fromNode);
    const to = Number(link.toNode);
    const timeFT = Number(link.timeFT);
    const timeTF = Number(link.timeTF);
    if (!nodeById.has(from) || !nodeById.has(to)) continue;
    if (Number.isFinite(timeFT)) graph.get(from).push({ to, seconds: timeFT });
    if (Number.isFinite(timeTF)) graph.get(to).push({ to: from, seconds: timeTF });
  }
  return { nodes, nodeById, graph };
}

function stationNodesForArea(network, areaKey) {
  const config = ISOCHRONE_STARTS[areaKey];
  return network.nodes.filter((node) =>
    node.station === config.stationName && config.linePattern.test(node.line)
  );
}

function reachableSubwayNodes(network, startIds, limitSeconds) {
  const dist = new Map(startIds.map((id) => [id, 0]));
  const queue = startIds.map((id) => ({ id, seconds: 0 }));
  while (queue.length) {
    queue.sort((a, b) => a.seconds - b.seconds);
    const current = queue.shift();
    if (current.seconds !== dist.get(current.id) || current.seconds > limitSeconds) continue;
    for (const edge of network.graph.get(current.id) || []) {
      const nextSeconds = current.seconds + edge.seconds;
      if (nextSeconds > limitSeconds) continue;
      if (nextSeconds < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nextSeconds);
        queue.push({ id: edge.to, seconds: nextSeconds });
      }
    }
  }
  return Array.from(dist.entries()).map(([id, seconds]) => ({ ...network.nodeById.get(id), seconds }));
}

function geometryBbox(geometry) {
  const xs = [];
  const ys = [];
  function walk(coords) {
    if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
      xs.push(coords[0]);
      ys.push(coords[1]);
      return;
    }
    if (Array.isArray(coords)) coords.forEach(walk);
  }
  walk(geometry.coordinates);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

function pointNearBbox(point, bbox, bufferM = BUFFER_M) {
  return (
    point.x >= bbox.minX - bufferM &&
    point.x <= bbox.maxX + bufferM &&
    point.y >= bbox.minY - bufferM &&
    point.y <= bbox.maxY + bufferM
  );
}

// EPSG:5179 / Korea 2000 Unified CS -> WGS84.
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

function degToRad(v) { return (v * Math.PI) / 180; }
function radToDeg(v) { return (v * 180) / Math.PI; }

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
  if (Array.isArray(coords) && typeof coords[0] === "number" && typeof coords[1] === "number") {
    return epsg5179ToWgs84(coords[0], coords[1]);
  }
  return coords.map(transformCoords);
}

async function sgisJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function getToken(env) {
  const url = `https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json?consumer_key=${encodeURIComponent(env.SGIS_CONSUMER_KEY)}&consumer_secret=${encodeURIComponent(env.SGIS_CONSUMER_SECRET)}`;
  const auth = await sgisJson(url);
  if (auth.errCd !== 0) throw new Error(`SGIS authentication failed: ${auth.errMsg}`);
  return auth.result.accessToken;
}

async function fetchAdministrativeAreas(token) {
  const features = [];
  for (const admCd of ["11", "31"]) {
    const url = `https://sgisapi.kostat.go.kr/OpenAPI3/boundary/hadmarea.geojson?accessToken=${token}&year=2020&adm_cd=${admCd}&low_search=1`;
    const data = await sgisJson(url);
    if (data.errCd !== 0) throw new Error(`hadmarea ${admCd} failed: ${data.errMsg}`);
    features.push(...(data.features || []));
  }
  return features.map((feature) => ({
    code: feature.properties.adm_cd,
    name: feature.properties.adm_nm,
    geometry: feature.geometry,
    bbox: geometryBbox(feature.geometry),
  }));
}

async function fetchStatsForArea(token, area) {
  const url = `https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json?accessToken=${token}&year=2020&adm_cd=${area.code}&low_search=2`;
  const data = await sgisJson(url);
  if (data.errCd !== 0) {
    console.warn(`Skipping stats ${area.code} ${area.name}: ${data.errMsg}`);
    return [];
  }
  return (data.result || []).map((row) => ({
    tract: row.adm_cd,
    adm_nm: row.adm_nm,
    population: toNum(row.tot_ppltn),
    workers: toNum(row.employee_cnt),
    businesses: toNum(row.corp_cnt),
  }));
}

async function fetchPointFeaturesForArea(token, area, statByTract) {
  const { minX, minY, maxX, maxY } = area.bbox;
  const url = `https://sgisapi.kostat.go.kr/OpenAPI3/boundary/userarea.geojson?accessToken=${token}&minx=${minX}&miny=${minY}&maxx=${maxX}&maxy=${maxY}&cd=4`;
  const data = await sgisJson(url);
  if (data.errCd !== 0) throw new Error(`userarea ${area.code} failed: ${data.errMsg}`);
  return (data.features || [])
    .filter((feature) => {
      const code = feature.properties?.adm_cd || feature.properties?.TOT_OA_CD;
      return code?.startsWith(area.code) && statByTract.has(code) && feature.properties?.x && feature.properties?.y;
    })
    .map((feature) => {
      const code = feature.properties.adm_cd || feature.properties.TOT_OA_CD;
      const row = statByTract.get(code);
      const point = epsg5179ToWgs84(Number(feature.properties.x), Number(feature.properties.y));
      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: point },
        properties: {
          tract_code: code,
          adm_cd: code,
          adm_nm: row.adm_nm,
          population: row.population,
          workers: row.workers,
          businesses: row.businesses,
        },
      };
    });
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function updateAppData(scope, selectedAreas) {
  const appDataPath = path.join(PROCESSED, "app_data.json");
  const appData = JSON.parse(fs.readFileSync(appDataPath, "utf8"));
  appData.isochrone_sgis = {
    tract_stats: "02_data/processed/sgis/isochrone_tract_stats.json",
    tract_geometries: "02_data/processed/sgis/isochrone_tract_points.geojson",
    scope,
    scope_names: selectedAreas.map((area) => area.name),
    note: "Expanded automatically from SGIS API for administrative areas intersecting 60-minute reachable subway stations. Isochrone statistics use SGIS output-area representative points to keep browser-side calculation tractable.",
  };
  writeJson(appDataPath, appData);
}

async function main() {
  const env = readDotEnv(ENV_PATH);
  const token = await getToken(env);
  const network = loadSubwayNetwork();
  const reachable = new Map();
  for (const areaKey of Object.keys(ISOCHRONE_STARTS)) {
    const starts = stationNodesForArea(network, areaKey);
    for (const node of reachableSubwayNodes(network, starts.map((start) => start.id), MAX_SECONDS)) {
      reachable.set(node.id, node);
    }
  }

  const adminAreas = await fetchAdministrativeAreas(token);
  const reachableNodes = Array.from(reachable.values());
  const selectedAreas = adminAreas
    .filter((area) => reachableNodes.some((node) => pointNearBbox(node, area.bbox)))
    .sort((a, b) => a.code.localeCompare(b.code));

  const stats = [];
  const selectedAreasWithStats = [];
  const skippedAreas = [];
  for (const area of selectedAreas) {
    console.log(`Fetching stats ${area.code} ${area.name}`);
    const areaStats = await fetchStatsForArea(token, area);
    if (!areaStats.length) {
      skippedAreas.push(area);
      continue;
    }
    selectedAreasWithStats.push(area);
    stats.push(...areaStats);
  }

  const statByTract = new Map(stats.map((row) => [row.tract, row]));
  const features = [];
  for (const area of selectedAreasWithStats) {
    console.log(`Fetching tract points ${area.code} ${area.name}`);
    features.push(...await fetchPointFeaturesForArea(token, area, statByTract));
  }

  const tracts = features.map((feature) => {
    const row = statByTract.get(feature.properties.tract_code);
    return {
      tract: row.tract,
      adm_nm: row.adm_nm,
      population: row.population,
      workers: row.workers,
      businesses: row.businesses,
    };
  }).sort((a, b) => a.tract.localeCompare(b.tract));

  const totals = tracts.reduce((acc, row) => {
    acc.population += row.population;
    acc.workers += row.workers;
    acc.businesses += row.businesses;
    return acc;
  }, { population: 0, workers: 0, businesses: 0 });

  const scope = selectedAreasWithStats.map((area) => area.code);
  writeJson(path.join(PROCESSED, "sgis", "isochrone_tract_stats.json"), {
    source: "SGIS OpenAPI3 stats/population.json",
    collected_at: new Date().toISOString(),
    scope,
    scope_names: selectedAreasWithStats.map((area) => area.name),
    tract_count: tracts.length,
    totals,
    tracts,
    note: "Used for subway isochrone accessibility. Population, employee, and corporation counts are fetched at output-area level with low_search=2.",
  });
  writeJson(path.join(PROCESSED, "sgis", "isochrone_tract_points.geojson"), {
    type: "FeatureCollection",
    crs: { type: "name", properties: { name: "EPSG:4326" } },
    features,
  });
  const oldBoundaryPath = path.join(PROCESSED, "sgis", "isochrone_tract_boundaries.geojson");
  if (fs.existsSync(oldBoundaryPath)) fs.unlinkSync(oldBoundaryPath);
  writeJson(path.join(PROCESSED, "sgis", "isochrone_sgis_collection_metadata.json"), {
    collected_at: new Date().toISOString(),
    service_cutoff: SERVICE_CUTOFF,
    station_buffer_m: BUFFER_M,
    max_seconds: MAX_SECONDS,
    reachable_node_count: reachableNodes.length,
    candidate_area_count: selectedAreas.length,
    included_area_count: selectedAreasWithStats.length,
    skipped_area_count: skippedAreas.length,
    candidate_areas: selectedAreas.map(({ code, name }) => ({ code, name })),
    included_areas: selectedAreasWithStats.map(({ code, name }) => ({ code, name })),
    skipped_areas: skippedAreas.map(({ code, name }) => ({ code, name })),
  });
  updateAppData(scope, selectedAreasWithStats);
  console.log(`Expanded isochrone SGIS scope to ${selectedAreasWithStats.length} areas, ${tracts.length} tracts.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
