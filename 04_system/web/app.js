const state = {
  data: null,
  maps: {},
  overlays: {},
  metrics: {},
  subway: null,
  isochrones: {},
  isochroneControls: {},
  isochroneStats: {},
  isochroneTracts: {},
  modeContext: {},
  modeLayers: {},
  activeModeLayer: {},
  currentMode: "building_use",
  compareInputsPromise: null,
  shpCache: new Map(),
};

const COLORS = {
  boundary: "#1a3a6b",
  parcels:  "#b76d2f",
  landuse:  "#6b4cc2",
  roads:    "#7b8794",
  office:   "#2f80ed",
  factory:  "#777d86",
  retail:   "#f2994a",
  other:    "#c8ced6",
};

const LANDUSE_COLORS = {
  "준주거지역": "#f2994a",
  "일반상업지역": "#eb5757",
  "근린상업지역": "#f2c94c",
  "제1종일반주거지역": "#9b59b6",
  "제2종일반주거지역": "#8e44ad",
  "제3종일반주거지역": "#6c3483",
  "자연녹지지역": "#27ae60",
  "보전녹지지역": "#1e8449",
  "공업지역": "#7f8c8d",
};
const LANDUSE_FALLBACK_COLOR = "#c8ced6";

const BUILDING_USE_LEGEND = [
  { label: "업무시설", color: COLORS.office },
  { label: "공장/지식산업센터", color: COLORS.factory },
  { label: "근린생활시설", color: COLORS.retail },
  { label: "기타", color: COLORS.other },
];

const SUBWAY_SERVICE_CUTOFF = "2026-06-18";

const ISOCHRONE_CONFIGS = {
  pangyo_phase1: {
    layerKey: "pangyo",
    stationLabel: "판교역",
    stationName: "판교",
    linePattern: /신분당|경강/,
    fallbackLatLng: [37.3948, 127.1112],
    fallbackCount: 2,
  },
  dongtan_techno_valley: {
    layerKey: "dongtan",
    stationLabel: "동탄역",
    stationName: "동탄",
    linePattern: /GTX_A|GTX/,
    fallbackLatLng: [37.2001565, 127.0962535],
    fallbackCount: 1,
  },
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmt(n) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(n));
}

function loadJson(url) {
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
    return res.json();
  });
}

function parseTsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = line.split("\t");
    const obj = {};
    header.forEach((key, index) => { obj[key] = cols[index] ?? ""; });
    return obj;
  });
}

function haversineMeters(a, b) {
  const [lat1, lon1] = a;
  const [lat2, lon2] = b;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(x));
}

function classifyBuildingUse(properties = {}) {
  const use = String(properties["주용도"] || properties.main_use || "").trim();
  const name = String(properties.buld_nm || properties["건물명_kr"] || "").trim();
  const floors = num(properties.gro_flo_co || properties["지상층수"]);
  const text = `${use} ${name}`;

  if (/업무|office|R&D|연구|벤처|테크|캠퍼스/i.test(text)) {
    return { label: "업무시설", color: COLORS.office };
  }
  if (/공장|지식산업|산업|factory|제조/i.test(text)) {
    return { label: "공장/지식산업센터", color: COLORS.factory };
  }
  if (/근린|상가|소매|음식|생활|retail/i.test(text)) {
    return { label: "근린생활시설", color: COLORS.retail };
  }
  if (!use || use === "기타") {
    if (floors >= 5) return { label: "업무시설", color: COLORS.office };
    if (floors >= 1) return { label: "근린생활시설", color: COLORS.retail };
  }
  return { label: use || "기타", color: COLORS.other };
}

function landuseColorFor(uname) {
  const name = String(uname || "").trim();
  return LANDUSE_COLORS[name] || LANDUSE_FALLBACK_COLOR;
}

function loadShpCached(zipPath) {
  if (!state.shpCache.has(zipPath)) {
    state.shpCache.set(zipPath, shp(zipPath));
  }
  return state.shpCache.get(zipPath);
}

function isSubwayRowInService(row) {
  const begin = String(row.effective_begin || row.begin || "").trim();
  return !begin || begin <= SUBWAY_SERVICE_CUTOFF;
}

async function loadSubwayNetwork() {
  if (state.subway) return state.subway;

  const buffer = await fetch("02_data/raw/subway/subway_network.zip").then((r) =>
    r.arrayBuffer()
  );
  const zip = await JSZip.loadAsync(buffer);
  const nodesText = await zip.file("network/nodes.tsv").async("string");
  const linksText = await zip.file("network/links.tsv").async("string");
  const nodes = parseTsv(nodesText)
    .filter(isSubwayRowInService)
    .map((row) => ({
      id: Number(row.id),
      line: row.linenm || "",
      station: row.statnm || "",
      lat: Number(row.lat),
      lng: Number(row.lng),
    }))
    .filter((node) => Number.isFinite(node.id) && Number.isFinite(node.lat) && Number.isFinite(node.lng));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const graph = new Map(nodes.map((node) => [node.id, []]));
  parseTsv(linksText).filter(isSubwayRowInService).forEach((link) => {
    const from = Number(link.fromNode);
    const to = Number(link.toNode);
    const timeFT = Number(link.timeFT);
    const timeTF = Number(link.timeTF);
    if (!nodeById.has(from) || !nodeById.has(to)) return;
    if (Number.isFinite(timeFT)) graph.get(from).push({ to, seconds: timeFT });
    if (Number.isFinite(timeTF)) graph.get(to).push({ to: from, seconds: timeTF });
  });

  state.subway = { nodes, nodeById, graph };
  return state.subway;
}

function stationNodesForArea(network, areaKey) {
  const config = ISOCHRONE_CONFIGS[areaKey];
  if (!config) return [];

  const candidates = network.nodes.filter((node) =>
    node.station === config.stationName && config.linePattern.test(node.line)
  );
  if (candidates.length) return candidates;

  return network.nodes
    .map((node) => ({
      ...node,
      startDistance: haversineMeters(config.fallbackLatLng, [node.lat, node.lng]),
    }))
    .sort((a, b) => a.startDistance - b.startDistance)
    .slice(0, config.fallbackCount || 1);
}

function reachableSubwayNodes(network, startIds, limitSeconds) {
  const dist = new Map(startIds.map((id) => [id, 0]));
  const queue = startIds.map((id) => ({ id, seconds: 0 }));

  while (queue.length) {
    queue.sort((a, b) => a.seconds - b.seconds);
    const current = queue.shift();
    if (current.seconds !== dist.get(current.id)) continue;
    if (current.seconds > limitSeconds) continue;

    for (const edge of network.graph.get(current.id) || []) {
      const nextSeconds = current.seconds + edge.seconds;
      if (nextSeconds > limitSeconds) continue;
      if (nextSeconds < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, nextSeconds);
        queue.push({ id: edge.to, seconds: nextSeconds });
      }
    }
  }

  return Array.from(dist.entries())
    .map(([id, seconds]) => ({ ...network.nodeById.get(id), seconds }))
    .filter((node) => node && Number.isFinite(node.lat) && Number.isFinite(node.lng));
}

function buildIsochroneGeoJson(nodes, minutes) {
  const bounds = {
    minLat: 37.0,
    maxLat: 37.8,
    minLng: 126.5,
    maxLng: 127.5,
  };
  const boundedNodes = nodes.filter((node) =>
    node.lat >= bounds.minLat &&
    node.lat <= bounds.maxLat &&
    node.lng >= bounds.minLng &&
    node.lng <= bounds.maxLng
  );
  const buffers = boundedNodes.map((node) =>
    turf.buffer(turf.point([node.lng, node.lat], node), 1, { units: "kilometers" })
  );
  if (!buffers.length) return null;

  let polygon;
  try {
    polygon = buffers.reduce((acc, cur) => turf.union(acc, cur));
  } catch (error) {
    console.warn("Isochrone union failed", error);
    polygon = null;
  }
  if (!polygon || polygon.type === "FeatureCollection") return null;

  const bbox = turf.bbox(polygon);
  const withinMetroBounds =
    bbox[0] >= bounds.minLng - 0.02 &&
    bbox[1] >= bounds.minLat - 0.02 &&
    bbox[2] <= bounds.maxLng + 0.02 &&
    bbox[3] <= bounds.maxLat + 0.02;
  if (!withinMetroBounds) return null;

  polygon.properties = {
    minutes,
    station_count: boundedNodes.length,
    buffer_m: 1000,
  };
  return polygon;
}

async function loadTractsForIsochrone(areaKey) {
  const cacheKey = "metro_scope";
  if (state.isochroneTracts[cacheKey]) return state.isochroneTracts[cacheKey];

  const scope = state.data.isochrone_sgis || {};
  const stats = await loadJson(scope.tract_stats || "02_data/processed/sgis/isochrone_tract_stats.json");
  const statByTract = new Map(stats.tracts.map((row) => [row.tract, row]));
  const shpZips = scope.shp_zips || [
    "02_data/raw/sgis/census_tract_shp/bnd_oa_31023_2025_2Q.zip",
    "02_data/raw/sgis/census_tract_shp/bnd_oa_31240_2025_2Q.zip",
  ];
  const geojsons = await Promise.all(shpZips.map((zipPath) => loadShpCached(zipPath)));
  const features = geojsons.flatMap((result) => {
    const geojson = Array.isArray(result) ? result[0] : result;
    return geojson?.features || [];
  });

  state.isochroneTracts[cacheKey] = features.map((feature) => {
    const code =
      feature.properties?.TOT_OA_CD ||
      feature.properties?.tot_oa_cd ||
      feature.properties?.OA_CD ||
      feature.properties?.oa_cd;
    const row = statByTract.get(code) || {};
    return {
      ...feature,
      properties: {
        ...feature.properties,
        tract_code: code,
        population: num(row.population),
        workers: num(row.workers),
      },
    };
  });
  return state.isochroneTracts[cacheKey];
}

async function summarizeIsochroneReach(areaKey, isochroneGeoJson, stationCount) {
  const tracts = await loadTractsForIsochrone(areaKey);
  const matched = [];
  for (const tract of tracts) {
    try {
      if (turf.booleanIntersects(tract, isochroneGeoJson)) {
        matched.push(tract);
      }
    } catch {}
  }

  return matched.reduce((acc, tract) => {
    acc.tractCount += 1;
    acc.population += num(tract.properties.population);
    acc.workers += num(tract.properties.workers);
    return acc;
  }, {
    stationCount,
    tractCount: 0,
    population: 0,
    workers: 0,
  });
}

function renderAccessibilityCurveSvg(points = []) {
  if (!points.length) {
    return `<div class="access-curve-empty">곡선 계산 전</div>`;
  }

  const width = 520;
  const height = 260;
  const pad = { left: 92, right: 28, top: 24, bottom: 62 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxTime = Math.max(...points.map((p) => p.minutes), 60);
  const maxRawValue = Math.max(1, ...points.map((p) => Math.max(p.population, p.workers)));
  const maxValue = Math.ceil(maxRawValue / 10000);
  const x = (minutes) => pad.left + (minutes / maxTime) * plotW;
  const scaled = (value) => value / 10000;
  const y = (value) => pad.top + plotH - (scaled(value) / maxValue) * plotH;
  const pathFor = (key) => points
    .map((p, index) => `${index ? "L" : "M"}${x(p.minutes).toFixed(1)},${y(p[key]).toFixed(1)}`)
    .join(" ");
  const dotsFor = (key) => points
    .map((p) => `<circle class="${key}" cx="${x(p.minutes).toFixed(1)}" cy="${y(p[key]).toFixed(1)}" r="2.4" />`)
    .join("");
  const xTicks = [0, 15, 30, 45, 60].map((t) => `
      <g>
        <line x1="${x(t)}" y1="${pad.top}" x2="${x(t)}" y2="${pad.top + plotH}" />
      <text class="x-tick" x="${x(t)}" y="${height - 6}">${t}</text>
      </g>
  `).join("");
  const yTicks = [0, Math.ceil(maxValue / 2), maxValue].map((value) => {
    const yy = pad.top + plotH - (value / maxValue) * plotH;
    return `
      <g>
        <line x1="${pad.left}" y1="${yy}" x2="${pad.left + plotW}" y2="${yy}" />
        <text class="y-tick" x="${pad.left - 8}" y="${yy + 3}">${value}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="access-curve" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="누적 접근성 곡선">
      <g class="access-grid">
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" />
        <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" />
        ${xTicks}
        ${yTicks}
      </g>
      <text class="access-axis-label x" x="${pad.left + plotW / 2}" y="${height - 28}">소요시간 (분)</text>
      <text class="access-axis-label y" transform="translate(18 ${pad.top + plotH / 2}) rotate(-90)">도달가능 인구/종사자 (만 명)</text>
      <path class="access-line population" d="${pathFor("population")}" />
      <path class="access-line workers" d="${pathFor("workers")}" />
      <g class="access-dots">${dotsFor("population")}${dotsFor("workers")}</g>
    </svg>
  `;
}

async function buildAccessibilityCurve(areaKey, network, starts) {
  const minutesList = Array.from({ length: 13 }, (_, index) => index * 5);
  const allReachableNodes = reachableSubwayNodes(network, starts.map((node) => node.id), 60 * 60);
  const curve = [];
  for (const minutes of minutesList) {
    if (minutes === 0) {
      curve.push({ minutes, stationCount: 0, population: 0, workers: 0 });
      continue;
    }

    const limitSeconds = minutes * 60;
    const nodes = allReachableNodes.filter((node) => node.seconds <= limitSeconds);
    const geojson = buildIsochroneGeoJson(nodes, minutes);
    if (!geojson) {
      curve.push({ minutes, stationCount: 0, population: 0, workers: 0 });
      continue;
    }
    const stats = await summarizeIsochroneReach(areaKey, geojson, geojson.properties.station_count);
    curve.push({
      minutes,
      stationCount: stats.stationCount,
      population: stats.population,
      workers: stats.workers,
    });
  }
  return curve;
}

async function ensureAccessibilityCurve(areaKey, network, starts) {
  const statsState = state.isochroneStats[areaKey] || { panel: null, values: {} };
  state.isochroneStats[areaKey] = statsState;
  if (statsState.curve || statsState.curveLoading) return;

  statsState.curveLoading = true;
  renderIsochroneStatsPanel(areaKey);
  try {
    statsState.curve = await buildAccessibilityCurve(areaKey, network, starts);
  } finally {
    statsState.curveLoading = false;
    renderIsochroneStatsPanel(areaKey);
    renderCompareTable();
  }
}

async function preloadAccessibilityCurves() {
  try {
    const network = await loadSubwayNetwork();
    await Promise.all(Object.keys(ISOCHRONE_CONFIGS).map((areaKey) => {
      const starts = stationNodesForArea(network, areaKey);
      return ensureAccessibilityCurve(areaKey, network, starts);
    }));
  } catch (error) {
    console.warn("Accessibility curve preload failed", error);
  }
}

function renderIsochroneStatsPanel(areaKey) {
  const config = ISOCHRONE_CONFIGS[areaKey];
  const statsState = state.isochroneStats?.[areaKey];
  const panel = statsState?.panel;
  if (!panel) return;
  const data = statsState.values || {};
  const currentMinutes = statsState.currentMinutes ?? 30;
  const current = data[currentMinutes];
  const renderRow = (minutes) => {
    const row = data[minutes];
    if (!row) {
      return `
        <div class="iso-stat-row muted">
          <span>${minutes}분권</span><b>계산 전</b>
        </div>
      `;
    }
    return `
      <div class="iso-stat-block">
        <div class="iso-stat-title">${minutes}분권</div>
        <div class="iso-stat-row"><span>도달가능 역 수</span><b>${fmt(row.stationCount)}</b></div>
        <div class="iso-stat-row"><span>도달가능 인구</span><b>${fmt(row.population)}명</b></div>
        <div class="iso-stat-row"><span>도달가능 종사자</span><b>${fmt(row.workers)}명</b></div>
      </div>
    `;
  };

  panel.innerHTML = `
    <div class="iso-stat-head">${config.stationLabel} 등시간권</div>
    <div class="iso-stat-block current">
      <div class="iso-stat-title">현재 ${currentMinutes}분권</div>
      <div class="iso-stat-row"><span>도달가능 역 수</span><b>${current ? fmt(current.stationCount) : "계산 전"}</b></div>
      <div class="iso-stat-row"><span>도달가능 인구</span><b>${current ? fmt(current.population) + "명" : "계산 전"}</b></div>
      <div class="iso-stat-row"><span>도달가능 종사자</span><b>${current ? fmt(current.workers) + "명" : "계산 전"}</b></div>
    </div>
    ${renderRow(30)}
    ${renderRow(60)}
  `;
}

function addIsochroneStatsPanel(map, areaKey) {
  const control = L.control({ position: "bottomleft" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "isochrone-stats");
    div.classList.add("is-hidden");
    state.isochroneStats[areaKey] = {
      ...(state.isochroneStats[areaKey] || {}),
      panel: div,
      values: state.isochroneStats[areaKey]?.values || {},
    };
    renderIsochroneStatsPanel(areaKey);
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  control.addTo(map);
}

async function showSubwayIsochrone(map, areaKey, minutes, controls = {}) {
  const buttons = controls.buttons || [];
  const range = controls.range || null;
  const valueLabel = controls.valueLabel || null;
  const summary = controls.summary || null;
  buttons.forEach((button) => { button.disabled = true; });
  if (range) range.disabled = true;
  try {
    const config = ISOCHRONE_CONFIGS[areaKey];
    const network = await loadSubwayNetwork();
    const starts = stationNodesForArea(network, areaKey);
    if (!starts.length) return;

    if (state.isochrones[config.layerKey]) {
      map.removeLayer(state.isochrones[config.layerKey]);
      state.isochrones[config.layerKey] = null;
    }

    let reachStats = { stationCount: 0, tractCount: 0, population: 0, workers: 0 };
    if (minutes > 0) {
      const nodes = reachableSubwayNodes(network, starts.map((node) => node.id), minutes * 60);
      const geojson = buildIsochroneGeoJson(nodes, minutes);
      if (geojson) {
        reachStats = await summarizeIsochroneReach(areaKey, geojson, geojson.properties.station_count);
        const color = minutes >= 60 ? "#7b61ff" : "#2f80ed";
        const layer = L.geoJSON(geojson, {
          interactive: false,
          style: {
            color,
            weight: 2.5,
            opacity: 0.9,
            fillColor: color,
            fillOpacity: 0.2,
          },
        });

        if (state.currentMode === "isochrone") layer.addTo(map);
        state.isochrones[config.layerKey] = layer;
      }
    }
    if (!state.isochroneStats[areaKey]) {
      state.isochroneStats[areaKey] = { panel: null, values: {} };
    }
    state.isochroneStats[areaKey].currentMinutes = minutes;
    state.isochroneStats[areaKey].values[minutes] = reachStats;
    renderIsochroneStatsPanel(areaKey);
    renderCompareTable();
    buttons.forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.minutes) === minutes);
    });
    if (range) range.value = String(minutes);
    if (valueLabel) valueLabel.textContent = `${minutes}분`;
    if (summary) {
      summary.textContent = `도달역 ${fmt(reachStats.stationCount)}개 · 인구 ${fmt(reachStats.population)}명 · 종사자 ${fmt(reachStats.workers)}명`;
    }
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
    if (range) range.disabled = false;
  }
}

function addIsochroneControl(map, areaKey) {
  const control = L.control({ position: "topright" });
  control.onAdd = () => {
    const div = L.DomUtil.create("div", "isochrone-control");
    div.classList.add("is-hidden");
    div.innerHTML = `
      <div class="iso-control-buttons">
        <button type="button" data-minutes="30">30분권</button>
        <button type="button" data-minutes="60">60분권</button>
      </div>
      <div class="iso-slider-row">
        <span>0분</span>
        <input type="range" min="0" max="60" step="5" value="30" aria-label="등시간권 소요시간" />
        <span>60분</span>
      </div>
      <div class="iso-slider-value">30분</div>
      <div class="iso-slider-summary">도달역 계산 전</div>
    `;
    const buttons = Array.from(div.querySelectorAll("button"));
    const range = div.querySelector("input[type='range']");
    const valueLabel = div.querySelector(".iso-slider-value");
    const summary = div.querySelector(".iso-slider-summary");
    const controls = { buttons, range, valueLabel, summary };
    state.isochroneControls[areaKey] = { container: div, controls, initialized: false };
    let sliderTimer = null;
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        showSubwayIsochrone(map, areaKey, Number(button.dataset.minutes), controls);
      });
    });
    range.addEventListener("input", () => {
      const minutes = Number(range.value);
      valueLabel.textContent = `${minutes}분`;
      window.clearTimeout(sliderTimer);
      sliderTimer = window.setTimeout(() => {
        showSubwayIsochrone(map, areaKey, minutes, controls);
      }, 120);
    });
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    return div;
  };
  control.addTo(map);
}

function setIsochroneModeActive(areaKey, active) {
  const ctx = state.modeContext[areaKey];
  const config = ISOCHRONE_CONFIGS[areaKey];
  const controlState = state.isochroneControls[areaKey];
  const statsPanel = state.isochroneStats[areaKey]?.panel;

  controlState?.container?.classList.toggle("is-hidden", !active);
  statsPanel?.classList.toggle("is-hidden", !active);

  if (!ctx || !config) return;

  const layer = state.isochrones[config.layerKey];
  if (!active) {
    if (layer && ctx.map.hasLayer(layer)) ctx.map.removeLayer(layer);
    return;
  }

  if (layer && !ctx.map.hasLayer(layer)) layer.addTo(ctx.map);
}

function makeMap(id, center) {
  const map = L.map(id, { zoomControl: true, preferCanvas: true }).setView(center, 14);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
  return map;
}

function fitBoundary(map, layer) {
  if (!layer) return;
  const bounds = layer.getBounds();
  if (bounds.isValid()) map.fitBounds(bounds.pad(0.1));
}

function getBoundaryFeature(boundaryGeoJson) {
  if (!boundaryGeoJson) return null;
  if (boundaryGeoJson.type === "Feature") return boundaryGeoJson;
  if (boundaryGeoJson.type === "FeatureCollection") return boundaryGeoJson.features?.[0] || null;
  return { type: "Feature", properties: {}, geometry: boundaryGeoJson };
}

function pushClippedFeature(out, clipped, sourceProperties) {
  if (!clipped) return;
  if (clipped.type === "FeatureCollection") {
    clipped.features.forEach((feature) => pushClippedFeature(out, feature, sourceProperties));
    return;
  }
  if (clipped.type === "Feature") {
    out.push({
      ...clipped,
      properties: { ...(sourceProperties || {}), ...(clipped.properties || {}) },
    });
  }
}

function lineMidpoint(lineFeature) {
  try {
    const length = turf.length(lineFeature, { units: "kilometers" });
    return turf.along(lineFeature, length / 2, { units: "kilometers" });
  } catch {
    return null;
  }
}

function boundaryToLineSplitter(boundaryFeature) {
  const geometry = boundaryFeature?.geometry;
  if (!geometry) return boundaryFeature;
  if (geometry.type === "Polygon") {
    return turf.multiLineString(geometry.coordinates);
  }
  if (geometry.type === "MultiPolygon") {
    return turf.multiLineString(geometry.coordinates.flat());
  }
  return boundaryFeature;
}

function clipLineFeatureToBoundary(feature, boundaryFeature) {
  const sourceProperties = feature.properties || {};
  const splitter = boundaryToLineSplitter(boundaryFeature);
  const lines =
    feature.geometry?.type === "MultiLineString"
      ? feature.geometry.coordinates.map((coordinates) => ({
          type: "Feature",
          properties: sourceProperties,
          geometry: { type: "LineString", coordinates },
        }))
      : [feature];
  const clipped = [];

  lines.forEach((line) => {
    let pieces = [line];
    try {
      const split = turf.lineSplit(line, splitter);
      if (split.features?.length) pieces = split.features;
    } catch {}

    pieces.forEach((piece) => {
      const midpoint = lineMidpoint(piece);
      try {
        if (midpoint && turf.booleanPointInPolygon(midpoint, boundaryFeature)) {
          clipped.push({ ...piece, properties: sourceProperties });
        }
      } catch {}
    });
  });

  if (!clipped.length) return null;
  if (clipped.length === 1) return clipped[0];
  return { type: "FeatureCollection", features: clipped };
}

function clipFeatureToBoundary(feature, boundaryFeature) {
  if (!boundaryFeature || !feature?.geometry) return feature;
  const type = feature.geometry.type;
  try {
    if (!turf.booleanIntersects(feature, boundaryFeature)) return null;
  } catch {
    return null;
  }

  if (type === "Polygon" || type === "MultiPolygon") {
    try {
      return turf.intersect(feature, boundaryFeature);
    } catch {
      return null;
    }
  }
  if (type === "LineString" || type === "MultiLineString") {
    return clipLineFeatureToBoundary(feature, boundaryFeature);
  }
  if (type === "Point") {
    try {
      return turf.booleanPointInPolygon(feature, boundaryFeature) ? feature : null;
    } catch {
      return null;
    }
  }
  return feature;
}

function clipGeoJsonToBoundary(data, boundaryFeature) {
  if (!boundaryFeature) return data;
  const features = data.type === "FeatureCollection" ? data.features || [] : [data];
  const clippedFeatures = [];
  features.forEach((feature) => {
    pushClippedFeature(clippedFeatures, clipFeatureToBoundary(feature, boundaryFeature), feature.properties);
  });
  return {
    type: "FeatureCollection",
    name: data.name,
    features: clippedFeatures,
  };
}

async function loadGeoJsonLayer(url, style, boundaryFeature = null, options = {}) {
  const data = await loadJson(url);
  return L.geoJSON(clipGeoJsonToBoundary(data, boundaryFeature), { ...options, style });
}

// ── Map mode: 용도지역 (zoning) ─────────────────────────────────────────────
async function loadLanduseLayer(area, boundaryFeature) {
  const data = await loadJson(area.vworld.landuse.geojson);
  const clipped = clipGeoJsonToBoundary(data, boundaryFeature);
  return L.geoJSON(clipped, {
    style: (feature) => ({
      color: "#55555599",
      weight: 0.5,
      fillColor: landuseColorFor(feature.properties?.uname),
      fillOpacity: 0.55,
    }),
    onEachFeature: (feature, layer) => {
      layer.bindTooltip(feature.properties?.uname || "미분류", { sticky: true });
    },
  });
}

// ── Map mode: 인구/종사자 집계구 choropleth ─────────────────────────────────
function styleTractFeature(feature, maxValue, metricKey) {
  const value = num(feature.properties?.[metricKey]);
  const ratio = maxValue > 0 ? value / maxValue : 0;
  const fillColor =
    ratio > 0.75 ? "#224f9c" :
    ratio > 0.5  ? "#3f71b6" :
    ratio > 0.25 ? "#7e9fca" :
    ratio > 0.05 ? "#bfd0e3" :
    "#eef3f8";
  return { color: "#7a8a99", weight: 1, opacity: 0.8, fillColor, fillOpacity: 0.55 };
}

async function buildTractChoroplethLayer(area, boundaryFeature) {
  const stats = await loadJson(area.sgis.tract_stats);
  const zip = await loadShpCached(area.sgis.shp_zip);
  const geojson = Array.isArray(zip) ? zip[0] : zip;
  const selectedCodes = new Set(stats.selected_codes || []);
  const statByTract = new Map(stats.tracts.map((row) => [row.tract, row]));

  const clippedFeatures = [];
  (geojson.features || []).forEach((feature) => {
    const code =
      feature.properties?.TOT_OA_CD ||
      feature.properties?.tot_oa_cd ||
      feature.properties?.OA_CD ||
      feature.properties?.oa_cd;
    let include = Boolean(selectedCodes.size && code && selectedCodes.has(code));
    try { if (!include && turf.booleanIntersects(feature, boundaryFeature)) include = true; } catch {}
    try { if (!include) include = turf.booleanPointInPolygon(turf.centerOfMass(feature), boundaryFeature); } catch {}
    if (!include) return;
    const clipped = clipFeatureToBoundary(feature, boundaryFeature);
    pushClippedFeature(clippedFeatures, clipped, feature.properties);
  });

  const features = clippedFeatures.map((feature) => {
    const code =
      feature.properties?.TOT_OA_CD ||
      feature.properties?.tot_oa_cd ||
      feature.properties?.OA_CD ||
      feature.properties?.oa_cd;
    const row = statByTract.get(code) || {};
    return {
      ...feature,
      properties: {
        ...feature.properties,
        population: num(row.population),
        workers: num(row.workers),
      },
    };
  });

  const maxPopulation = Math.max(1, ...stats.tracts.map((row) => num(row.population)));
  const maxWorkers = Math.max(1, ...stats.tracts.map((row) => num(row.workers)));

  const layer = L.geoJSON({ type: "FeatureCollection", features }, {
    style: (feature) => styleTractFeature(feature, maxPopulation, "population"),
    onEachFeature: (feature, tractLayer) => {
      const code =
        feature.properties?.TOT_OA_CD ||
        feature.properties?.tot_oa_cd ||
        feature.properties?.OA_CD ||
        feature.properties?.oa_cd;
      tractLayer.bindTooltip(
        `집계구 ${code || "unknown"}<br>인구 ${fmt(num(feature.properties.population))}명<br>종사자 ${fmt(num(feature.properties.workers))}명`,
        { sticky: true }
      );
    },
  });

  return { layer, maxPopulation, maxWorkers };
}

function restyleTractLayer(info, metric) {
  if (!info?.layer) return;
  const maxValue = metric === "workers" ? info.maxWorkers : info.maxPopulation;
  info.layer.setStyle((feature) => styleTractFeature(feature, maxValue, metric));
}

// ── Map mode switching (shared across both maps) ────────────────────────────
async function ensureModeLayer(areaKey, mode) {
  const ctx = state.modeContext[areaKey];
  if (!ctx) return null;
  const cache = state.modeLayers[areaKey];
  if (mode === "isochrone") return null;
  if (mode === "building_use") return cache.building_use;
  if (mode === "landuse") {
    if (!cache.landuse) {
      cache.landuse = await loadLanduseLayer(ctx.area, ctx.boundaryFeature);
    }
    return cache.landuse;
  }
  if (!cache.tract) {
    cache.tract = await buildTractChoroplethLayer(ctx.area, ctx.boundaryFeature);
  }
  return cache.tract.layer;
}

async function setMapMode(mode) {
  if (state.currentMode === mode) return;
  const buttons = Array.from(document.querySelectorAll(".mode-buttons .toggle"));
  buttons.forEach((button) => { button.disabled = true; });
  try {
    for (const areaKey of Object.keys(state.modeContext)) {
      const ctx = state.modeContext[areaKey];
      setIsochroneModeActive(areaKey, mode === "isochrone");
      const layer = await ensureModeLayer(areaKey, mode);
      const current = state.activeModeLayer[areaKey];
      if (current && ctx.map.hasLayer(current)) ctx.map.removeLayer(current);
      if (layer) {
        if (mode === "population" || mode === "workers") {
          restyleTractLayer(state.modeLayers[areaKey].tract, mode);
        }
        layer.addTo(ctx.map);
      }
      state.activeModeLayer[areaKey] = layer;
    }
    state.currentMode = mode;
    buttons.forEach((button) => {
      button.classList.toggle("active", button.dataset.mode === mode);
    });
    renderModeLegend(mode);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function renderModeLegend(mode) {
  const el = document.getElementById("modeLegend");
  if (!el) return;

  if (mode === "building_use") {
    el.innerHTML = BUILDING_USE_LEGEND
      .map((item) => `<span><i class="swatch" style="background:${item.color}"></i>${item.label}</span>`)
      .join("");
    return;
  }

  if (mode === "landuse") {
    const entries = Object.entries(LANDUSE_COLORS)
      .map(([label, color]) => `<span><i class="swatch" style="background:${color}"></i>${label}</span>`)
      .join("");
    el.innerHTML = `${entries}<span><i class="swatch" style="background:${LANDUSE_FALLBACK_COLOR}"></i>기타/미분류</span>`;
    return;
  }

  if (mode === "isochrone") {
    el.innerHTML = `
      <span class="legend-title">등시간권</span>
      <span><i class="swatch" style="background:#2f80ed"></i>30분권</span>
      <span><i class="swatch" style="background:#7b61ff"></i>60분권</span>
    `;
    return;
  }

  const metricLabel = mode === "workers" ? "종사자" : "인구";
  el.innerHTML = `
    <span class="legend-title">${metricLabel} (지역 내 최댓값 기준 상대 비교)</span>
    <span><i class="swatch" style="background:#224f9c"></i>매우 높음</span>
    <span><i class="swatch" style="background:#3f71b6"></i>높음</span>
    <span><i class="swatch" style="background:#7e9fca"></i>중간</span>
    <span><i class="swatch" style="background:#bfd0e3"></i>낮음</span>
    <span><i class="swatch" style="background:#eef3f8"></i>매우 낮음</span>
  `;
}

function bindModeButtons() {
  document.querySelectorAll(".mode-buttons .toggle").forEach((button) => {
    button.addEventListener("click", () => setMapMode(button.dataset.mode));
  });
}

// ── Donut chart (pure SVG, no library) ────────────────────────────────────────
function makeSvgDonut(items) {
  const nonZero = items.filter(d => d.연면적 > 0);
  const total = nonZero.reduce((s, d) => s + d.연면적, 0);
  if (!total) return '<p class="donut-empty">면적 데이터 없음</p>';

  const size = 148, cx = 74, cy = 74, r = 60, ri = 36;

  if (nonZero.length === 1) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${nonZero[0].색상}"/>
      <circle cx="${cx}" cy="${cy}" r="${ri}" fill="white"/>
    </svg>`;
  }

  let ang = -Math.PI / 2;

  const paths = nonZero.map(d => {
    const a = (d.연면적 / total) * Math.PI * 2;
    const cos1 = Math.cos(ang), sin1 = Math.sin(ang);
    ang += a;
    const cos2 = Math.cos(ang), sin2 = Math.sin(ang);
    const lf = a > Math.PI ? 1 : 0;
    const x1 = cx + r * cos1,  y1 = cy + r * sin1;
    const x2 = cx + r * cos2,  y2 = cy + r * sin2;
    const ix1 = cx + ri * cos1, iy1 = cy + ri * sin1;
    const ix2 = cx + ri * cos2, iy2 = cy + ri * sin2;
    const path = `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 ${lf} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} L${ix2.toFixed(1)} ${iy2.toFixed(1)} A${ri} ${ri} 0 ${lf} 0 ${ix1.toFixed(1)} ${iy1.toFixed(1)}Z`;
    return `<path d="${path}" fill="${d.색상}" stroke="white" stroke-width="1.2"><title>${d.용도} ${d.비율}%</title></path>`;
  });

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths.join("")}</svg>`;
}

function renderUsageStats(areaKey, stats) {
  const suffix = areaKey === "pangyo_phase1" ? "pangyo" : "dongtan";
  const panel = document.getElementById(suffix + "StatsPanel");
  if (!panel) return;

  const donutSvg = makeSvgDonut(stats.by_use);
  const rows = stats.by_use.map(d => `
    <tr>
      <td><span class="use-dot" style="background:${d.색상}"></span>${d.용도}</td>
      <td class="num-cell">${d.건물수}</td>
      <td class="num-cell">${d.연면적 > 0 ? fmt(d.연면적) : "—"}</td>
      <td class="num-cell">${d.연면적 > 0 ? d.비율 + "%" : "—"}</td>
    </tr>
  `).join("");

  panel.innerHTML = `
    <div class="stats-label">용도별 연면적</div>
    <div class="donut-wrap">${donutSvg}</div>
    <div class="donut-total">연면적 합계 ${fmt(stats.total_floor_area)}㎡</div>
    <table class="use-table">
      <thead><tr><th>용도</th><th>동</th><th>연면적(㎡)</th><th>비율</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ── Load one area ─────────────────────────────────────────────────────────────
async function loadArea(areaKey) {
  const area   = state.data.areas[areaKey];
  const map    = state.maps[areaKey];
  const suffix = areaKey === "pangyo_phase1" ? "pangyo" : "dongtan";

  // Boundary
  const boundaryJson = await loadJson(area.boundary.geojson);
  const boundaryFeature = getBoundaryFeature(boundaryJson);
  const boundary = L.geoJSON(boundaryJson, {
    color: COLORS.boundary,
    weight: 4,
    opacity: 1,
    fillColor: COLORS.boundary,
    fillOpacity: 0,
  }).addTo(map);

  // Enriched buildings (use-type colors + popup)
  const enrichedPath = area.vworld.buildings.geojson.replace(
    "_buildings.geojson",
    "_buildings_enriched.geojson"
  );
  const buildingData = await loadJson(enrichedPath);
  const clippedBuildingData = clipGeoJsonToBoundary(buildingData, boundaryFeature);
  clippedBuildingData.features.forEach((feature) => {
    const classified = classifyBuildingUse(feature.properties);
    feature.properties["색상"] = classified.color;
    feature.properties["용도분류"] = classified.label;
  });
  const buildings = L.geoJSON(clippedBuildingData, {
    style: (feature) => ({
      color: "#55555599",
      weight: 0.5,
      fillColor: feature.properties.색상 || "#cccccc",
      fillOpacity: 0.78,
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const nameRow = p.건물명_kr
        ? `<div class="bld-name">${p.건물명_kr}</div>`
        : "";
      const estTag = p._추정
        ? `<span class="bld-est">추정</span>`
        : "";
      layer.bindPopup(`
        <div class="bld-popup">
          ${nameRow}
          <div class="bld-row"><span>주용도</span><b>${p.주용도 || "—"}${estTag}</b></div>
          <div class="bld-row"><span>연면적</span><b>${p.연면적 > 0 ? fmt(p.연면적) + "㎡" : "—"}</b></div>
          <div class="bld-row"><span>대지면적</span><b>${p.대지면적 > 0 ? fmt(p.대지면적) + "㎡" : "—"}</b></div>
          <div class="bld-row"><span>용적률</span><b>${p.용적률 > 0 ? p.용적률 + "%" : "—"}</b></div>
          <div class="bld-row"><span>지상층수</span><b>${p.지상층수 || p.gro_flo_co || "—"}층</b></div>
        </div>
      `, { maxWidth: 240 });
    },
  });

  const parcels = await loadGeoJsonLayer(area.vworld.parcels.geojson, {
    color: COLORS.parcels, weight: 1, fillColor: COLORS.parcels, fillOpacity: 0.12,
  }, boundaryFeature);
  const roads = await loadGeoJsonLayer(area.vworld.roads.geojson, {
    color: COLORS.roads, weight: 1.5, opacity: 0.8, fillOpacity: 0.04,
  }, boundaryFeature, { interactive: false });

  const stats = area.sgis?.clipped || { population: 0, workers: 0, tract_count: 0 };
  const roadStats = computeRoadOrientationStats(roads);
  const areaKm2 = area.boundary.area_m2 > 0 ? area.boundary.area_m2 / 1e6 : 0;

  state.overlays[areaKey] = { boundary, parcels, buildings, roads };
  state.modeContext[areaKey] = { area, boundaryFeature, map };
  state.modeLayers[areaKey] = { building_use: buildings, landuse: null, tract: null };
  state.activeModeLayer[areaKey] = buildings;

  buildings.addTo(map);
  roads.addTo(map);

  state.metrics[areaKey] = {
    population:    stats.population,
    workers:       stats.workers,
    businesses:    area.business_points?.count ?? stats.businesses ?? 0,
    sgisBusinesses: stats.businesses || 0,
    businessSource: area.business_points ? "store_points" : "sgis_estimate",
    tractCount:    stats.tract_count,
    parcelCount:   parcels.getLayers().length,
    buildingCount: clippedBuildingData.features.length,
    roadCount:     roads.getLayers().length,
    roadLengthKm:  roadStats.totalKm,
    roadDensityKmPerKm2: areaKm2 > 0 && roadStats.totalKm > 0 ? roadStats.totalKm / areaKm2 : 0,
    roadOrientationEntropy: roadStats.entropy,
    hasRoadLineData: roadStats.totalKm > 0,
  };

  fitBoundary(map, boundary);

  const buildingStats = await loadJson(
    `02_data/processed/stats/${areaKey}_building_stats.json`
  );
  renderUsageStats(areaKey, buildingStats);

  const footEl = document.getElementById(suffix + "Foot");
  if (footEl) {
    footEl.textContent = [
      `경계면적 ${fmt(area.boundary.area_m2)}㎡`,
      `건축물 ${fmt(clippedBuildingData.features.length)}동`,
      `도로 ${roadStats.totalKm.toFixed(1)}km (${(areaKm2 > 0 ? roadStats.totalKm / areaKm2 : 0).toFixed(2)}km/km²)`,
    ].join(" · ");
  }
}

function bindLayerButtons(areaKey) {
  const mapName = areaKey === "pangyo_phase1" ? "pangyo" : "dongtan";
  document
    .querySelectorAll(`.layer-buttons[data-map="${mapName}"] .toggle`)
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const overlay = state.overlays[areaKey]?.[btn.dataset.layer];
        if (!overlay) return;
        const map = state.maps[areaKey];
        if (map.hasLayer(overlay)) {
          map.removeLayer(overlay);
          btn.classList.remove("active");
        } else {
          overlay.addTo(map);
          btn.classList.add("active");
        }
      });
    });
}

function roadOrientationEntropy(bins) {
  const total = bins.reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  let entropy = 0;
  for (const value of bins) {
    if (value <= 0) continue;
    const p = value / total;
    entropy -= p * Math.log(p);
  }
  return entropy / Math.log(bins.length);
}

function computeRoadOrientationStats(roadsLayer) {
  const numBins = 18;
  const binWidth = 180 / numBins;
  const bins = new Array(numBins).fill(0);
  let totalKm = 0;
  roadsLayer.eachLayer((layer) => {
    const geometry = layer.feature?.geometry;
    if (!geometry) return;
    const lines = geometry.type === "MultiLineString" ? geometry.coordinates : [geometry.coordinates];
    for (const coords of lines) {
      for (let i = 1; i < coords.length; i += 1) {
        const a = coords[i - 1];
        const b = coords[i];
        const segKm = haversineMeters([a[1], a[0]], [b[1], b[0]]) / 1000;
        if (!Number.isFinite(segKm) || segKm <= 0) continue;
        totalKm += segKm;
        const bearing = ((turf.bearing(a, b) % 180) + 180) % 180;
        const binIndex = Math.min(numBins - 1, Math.floor(bearing / binWidth));
        bins[binIndex] += segKm;
      }
    }
  });
  return { totalKm, bins, entropy: roadOrientationEntropy(bins) };
}

function entropyIndex(items) {
  const values = items.map((item) => item.value).filter((value) => value > 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total || values.length <= 1) return 0;
  const entropy = values.reduce((sum, value) => {
    const p = value / total;
    return sum - p * Math.log(p);
  }, 0);
  return entropy / Math.log(values.length);
}

async function landuseCompareStats(areaKey) {
  const area = state.data.areas[areaKey];
  const geojson = await loadJson(area.vworld.landuse.geojson);
  const groups = new Map();
  let unclassifiedArea = 0;
  for (const feature of geojson.features || []) {
    const label = String(feature.properties?.uname || "").trim();
    let areaM2 = 0;
    try { areaM2 = turf.area(feature); } catch {}
    if (!label) {
      unclassifiedArea += areaM2;
      continue;
    }
    const entry = groups.get(label) || { label, value: 0 };
    entry.value += areaM2;
    groups.set(label, entry);
  }
  const groupedTotal = Array.from(groups.values()).reduce((sum, item) => sum + item.value, 0);
  const total = groupedTotal + unclassifiedArea;
  const items = Array.from(groups.values())
    .map((item) => ({ ...item, ratio: total ? (item.value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);
  if (unclassifiedArea > 0) {
    items.push({
      label: "미분류",
      value: unclassifiedArea,
      ratio: total ? (unclassifiedArea / total) * 100 : 0,
    });
  }
  return { total, items, lum: entropyIndex(items) };
}

async function buildingCompareStats(areaKey) {
  const [stats, buildings] = await Promise.all([
    loadJson(`02_data/processed/stats/${areaKey}_building_stats.json`),
    loadJson(`02_data/processed/vworld/${areaKey}_buildings_enriched.geojson`),
  ]);
  const valid = (buildings.features || [])
    .map((feature) => feature.properties || {})
    .filter((p) => num(p["연면적"]) > 0 && num(p["대지면적"]) > 0);
  const floor = valid.reduce((sum, p) => sum + num(p["연면적"]), 0);
  const site = valid.reduce((sum, p) => sum + num(p["대지면적"]), 0);
  const avgFar = site ? (floor / site) * 100 : 0;
  return {
    totalFloorArea: stats.total_floor_area || 0,
    byUse: (stats.by_use || [])
      .filter((row) => num(row["연면적"]) > 0)
      .map((row) => ({ label: row["용도"], ratio: num(row["비율"]), floor: num(row["연면적"]) })),
    avgFar,
  };
}

function accessValue(areaKey, minutes, field) {
  const values = state.isochroneStats?.[areaKey]?.values || {};
  const direct = values[minutes];
  if (direct && direct[field] != null) return direct[field];
  const curve = state.isochroneStats?.[areaKey]?.curve || [];
  const row = curve.find((point) => point.minutes === minutes);
  return row ? row[field] : null;
}

function accessText(areaKey, minutes) {
  const pop = accessValue(areaKey, minutes, "population");
  const workers = accessValue(areaKey, minutes, "workers");
  const stations = accessValue(areaKey, minutes, "stationCount");
  if (pop == null || workers == null || stations == null) {
    return "지도모드 등시간권에서<br>먼저 계산 필요";
  }
  return `역 ${fmt(stations)}개<br>인구 ${fmt(pop)}명<br>종사자 ${fmt(workers)}명`;
}

function compareValue(title, value, note = "", meta = "") {
  return `
    <div class="compare-value">
      <span>${title}</span>
      <b>${value}</b>
      ${meta ? `<small class="compare-meta">${meta}</small>` : ""}
      ${note ? `<small>${note}</small>` : ""}
    </div>
  `;
}

function compareBar(value, max, suffix = "", decimals = 0) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const displayValue = decimals > 0 ? value.toFixed(decimals) : fmt(value);
  return `
    <div class="compare-bar">
      <div class="compare-bar-track"><i style="width:${pct.toFixed(1)}%"></i></div>
      <strong>${displayValue}${suffix}</strong>
    </div>
  `;
}

function compareDualBar(pangyo, dongtan, suffix = "", decimals = 0) {
  const max = Math.max(pangyo, dongtan, 1);
  return {
    pangyo: compareBar(pangyo, max, suffix, decimals),
    dongtan: compareBar(dongtan, max, suffix, decimals),
  };
}

function miniShareBars(items, limit = 4) {
  return `
    <div class="mini-share-list">
      ${items.slice(0, limit).map((item) => `
        <div class="mini-share-row">
          <span>${item.label}</span>
          <div class="mini-share-track"><i style="width:${Math.max(0, Math.min(100, item.ratio)).toFixed(1)}%"></i></div>
          <b>${item.ratio.toFixed(1)}%</b>
        </div>
      `).join("")}
    </div>
  `;
}

function businessIndustryShares(areaKey) {
  const source = state.data?.areas?.[areaKey]?.business_points;
  if (!source) return { large: [], middle: [] };
  const toShares = (items = []) => {
    const total = items.reduce((sum, item) => sum + (item.count || 0), 0) || 1;
    return items.map((item) => ({
      label: item.label,
      ratio: ((item.count || 0) / total) * 100,
      count: item.count || 0,
    }));
  };
  return {
    large: toShares(source.by_large_category || []),
    middle: toShares(source.by_middle_category || []),
  };
}

function metricComparisonChart(label, pangyo, dongtan, options = {}) {
  const suffix = options.suffix || "";
  const decimals = options.decimals || 0;
  const max = Math.max(pangyo, dongtan, 1);
  const valueText = (value) => decimals > 0 ? value.toFixed(decimals) : fmt(value);
  const bar = (name, value, className) => `
    <div class="detail-metric-row ${className}">
      <span>${name}</span>
      <div class="detail-bar-track"><i style="width:${Math.min(100, (value / max) * 100).toFixed(1)}%"></i></div>
      <b>${valueText(value)}${suffix}</b>
    </div>
  `;
  return `
    <div class="detail-chart">
      <div class="detail-chart-title">${label}</div>
      ${bar("판교", pangyo, "pangyo")}
      ${bar("동탄", dongtan, "dongtan")}
    </div>
  `;
}

function shareComparisonChart(pangyoItems, dongtanItems, title) {
  const labels = Array.from(new Set([
    ...pangyoItems.slice(0, 5).map((item) => item.label),
    ...dongtanItems.slice(0, 5).map((item) => item.label),
  ]));
  const getRatio = (items, label) => items.find((item) => item.label === label)?.ratio || 0;
  return `
    <div class="detail-chart">
      <div class="detail-chart-title">${title}</div>
      <div class="share-compare-table">
        ${labels.map((label) => {
          const p = getRatio(pangyoItems, label);
          const d = getRatio(dongtanItems, label);
          return `
            <div class="share-compare-row">
              <span>${label}</span>
              <div class="share-region">
                <em>판교</em>
                <div class="detail-bar-track"><i style="width:${Math.min(100, p).toFixed(1)}%"></i></div>
                <b>${p.toFixed(1)}%</b>
              </div>
              <div class="share-region dongtan">
                <em>동탄</em>
                <div class="detail-bar-track"><i style="width:${Math.min(100, d).toFixed(1)}%"></i></div>
                <b>${d.toFixed(1)}%</b>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

async function industryWorkerStats(areaKey) {
  return loadJson(`02_data/processed/stats/${areaKey}_industry_workers.json`);
}

async function completionTimelineStats(areaKey) {
  return loadJson(`02_data/processed/stats/${areaKey}_completion_timeline.json`);
}

function renderCompletionTimelineSvg(pangyoYears = [], dongtanYears = []) {
  const pMap = new Map(pangyoYears.map((row) => [row.year, row.count]));
  const dMap = new Map(dongtanYears.map((row) => [row.year, row.count]));
  const allYears = Array.from(new Set([...pMap.keys(), ...dMap.keys()])).sort((a, b) => a - b);
  if (!allYears.length) {
    return `<div class="detail-note">사용승인일 데이터가 없습니다.</div>`;
  }

  const width = 720;
  const height = 240;
  const pad = { left: 46, right: 14, top: 18, bottom: 36 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxCount = Math.max(1, ...allYears.map((year) => Math.max(pMap.get(year) || 0, dMap.get(year) || 0)));
  const groupW = plotW / allYears.length;
  const barW = Math.max(2, groupW * 0.36);
  const yFor = (value) => pad.top + plotH - (value / maxCount) * plotH;
  const labelStep = Math.max(1, Math.ceil(allYears.length / 16));

  const heightFor = (value) => (value / maxCount) * plotH;
  const bars = allYears.map((year, index) => {
    const groupX = pad.left + index * groupW;
    const pCount = pMap.get(year) || 0;
    const dCount = dMap.get(year) || 0;
    const px = groupX + groupW * 0.1;
    const dx = px + barW + 2;
    const label = index % labelStep === 0
      ? `<text class="timeline-x-tick" x="${(groupX + groupW / 2).toFixed(1)}" y="${height - 14}">${year}</text>`
      : "";
    return `
      <rect class="timeline-bar pangyo" x="${px.toFixed(1)}" y="${yFor(pCount).toFixed(1)}" width="${barW.toFixed(1)}" height="${heightFor(pCount).toFixed(1)}" />
      <rect class="timeline-bar dongtan" x="${dx.toFixed(1)}" y="${yFor(dCount).toFixed(1)}" width="${barW.toFixed(1)}" height="${heightFor(dCount).toFixed(1)}" />
      ${label}
    `;
  }).join("");

  const yTicks = [0, Math.round(maxCount / 2), maxCount].map((value) => {
    const yy = yFor(value);
    return `
      <g>
        <line x1="${pad.left}" y1="${yy.toFixed(1)}" x2="${pad.left + plotW}" y2="${yy.toFixed(1)}" />
        <text class="timeline-y-tick" x="${pad.left - 8}" y="${(yy + 3).toFixed(1)}">${value}</text>
      </g>
    `;
  }).join("");

  return `
    <svg class="timeline-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="연도별 사용승인 동수">
      <g class="timeline-grid">
        <line x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + plotH}" />
        <line x1="${pad.left}" y1="${pad.top + plotH}" x2="${pad.left + plotW}" y2="${pad.top + plotH}" />
        ${yTicks}
      </g>
      ${bars}
    </svg>
  `;
}

function accessDetailChart(minutes) {
  const p = state.isochroneStats?.pangyo_phase1?.values?.[minutes]
    || state.isochroneStats?.pangyo_phase1?.curve?.find((point) => point.minutes === minutes);
  const d = state.isochroneStats?.dongtan_techno_valley?.values?.[minutes]
    || state.isochroneStats?.dongtan_techno_valley?.curve?.find((point) => point.minutes === minutes);
  if (!p || !d) {
    return `<div class="detail-note">지도모드에서 등시간권 버튼을 누른 뒤 30분권 또는 60분권을 계산하면 이 비교가 자동 갱신됩니다.</div>`;
  }
  return `
    ${metricComparisonChart(`${minutes}분 도달 역 수`, p.stationCount, d.stationCount, { suffix: "개" })}
    ${metricComparisonChart(`${minutes}분 도달가능 인구`, p.population, d.population, { suffix: "명" })}
    ${metricComparisonChart(`${minutes}분 도달가능 종사자`, p.workers, d.workers, { suffix: "명" })}
  `;
}

function accessCurveComparisonHtml() {
  const pCurve = state.isochroneStats?.pangyo_phase1?.curve;
  const dCurve = state.isochroneStats?.dongtan_techno_valley?.curve;
  if (!pCurve?.length || !dCurve?.length) {
    return `<div class="detail-note">누적 접근성 곡선은 지도모드 등시간권에서 분권 계산을 완료한 뒤 표시됩니다.</div>`;
  }
  const pLast = pCurve[pCurve.length - 1];
  const dLast = dCurve[dCurve.length - 1];
  return `
    <div class="access-inline-grid">
      <div class="detail-chart access-inline-chart">
        <div class="detail-chart-title">판교역 기준 누적 접근성</div>
        ${renderAccessibilityCurveSvg(pCurve)}
        <div class="access-curve-summary">60분 인구 ${fmt(pLast.population)}명 · 종사자 ${fmt(pLast.workers)}명</div>
      </div>
      <div class="detail-chart access-inline-chart">
        <div class="detail-chart-title">동탄역 기준 누적 접근성</div>
        ${renderAccessibilityCurveSvg(dCurve)}
        <div class="access-curve-summary">60분 인구 ${fmt(dLast.population)}명 · 종사자 ${fmt(dLast.workers)}명</div>
      </div>
    </div>
    <div class="access-legend compare inline">
      <span><i class="population"></i>인구</span>
      <span><i class="workers"></i>종사자</span>
    </div>
  `;
}

function compareDetail(text, chartHtml) {
  return `
    <div class="compare-detail">
      <p>${text}</p>
      ${chartHtml}
    </div>
  `;
}

function compareCard(title, rows) {
  return `
    <section class="compare-card">
      <h3>${title}</h3>
      ${rows.map((row) => `
        <article class="metric-compare-block">
          <div class="metric-compare-title">${row.metric}</div>
          <div class="metric-compare-values">
            <div class="region-compare-value">
              <div class="region-label">판교</div>
              ${row.pangyo}
            </div>
            <div class="region-compare-value">
              <div class="region-label">동탄</div>
              ${row.dongtan}
            </div>
          </div>
          ${row.detail || ""}
        </article>
      `).join("")}
    </section>
  `;
}

async function renderCompareTable() {
  const body = document.getElementById("advancedCompareBody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="4">비교 통계 계산 중</td></tr>`;

  if (!state.compareInputsPromise) {
    state.compareInputsPromise = Promise.all([
      landuseCompareStats("pangyo_phase1"),
      landuseCompareStats("dongtan_techno_valley"),
      buildingCompareStats("pangyo_phase1"),
      buildingCompareStats("dongtan_techno_valley"),
      completionTimelineStats("pangyo_phase1"),
      completionTimelineStats("dongtan_techno_valley"),
      industryWorkerStats("pangyo_phase1"),
      industryWorkerStats("dongtan_techno_valley"),
    ]);
  }
  const [pLand, dLand, pBuild, dBuild, pTimeline, dTimeline, pIndustry, dIndustry] =
    await state.compareInputsPromise;
  const pMetric = state.metrics.pangyo_phase1;
  const dMetric = state.metrics.dongtan_techno_valley;
  const farBars = compareDualBar(pBuild.avgFar, dBuild.avgFar, "%", 1);
  const popBars = compareDualBar(pMetric.population, dMetric.population, "명");
  const workerBars = compareDualBar(pMetric.workers, dMetric.workers, "명");
  const businessBars = compareDualBar(pMetric.businesses || 0, dMetric.businesses || 0, "개");
  const pBizPerBuilding = pMetric.buildingCount ? (pMetric.businesses || 0) / pMetric.buildingCount : 0;
  const dBizPerBuilding = dMetric.buildingCount ? (dMetric.businesses || 0) / dMetric.buildingCount : 0;
  const pBizIndustry = businessIndustryShares("pangyo_phase1");
  const dBizIndustry = businessIndustryShares("dongtan_techno_valley");
  const pJobHousing = pMetric.workers / Math.max(pMetric.population, 1);
  const dJobHousing = dMetric.workers / Math.max(dMetric.population, 1);
  const jobHousingBars = compareDualBar(pJobHousing, dJobHousing, "", 2);
  const roadDensityBars = compareDualBar(pMetric.roadDensityKmPerKm2, dMetric.roadDensityKmPerKm2, "km/km²", 2);
  const cards = [
    compareCard("1 개발 속도 (사용승인일 기준)", [
      {
        metric: "준공 집중도",
        pangyo: compareValue(
          "최다 준공 연도",
          pTimeline.peak_year ? `${pTimeline.peak_year.year}년 ${pTimeline.peak_year.count}동` : "데이터 없음",
          `2020년 이후 ${pTimeline.since_2020.ratio}% (${pTimeline.since_2020.count}동)`,
          "출처: 건축물대장 사용승인일"
        ),
        dongtan: compareValue(
          "최다 준공 연도",
          dTimeline.peak_year ? `${dTimeline.peak_year.year}년 ${dTimeline.peak_year.count}동` : "데이터 없음",
          `2020년 이후 ${dTimeline.since_2020.ratio}% (${dTimeline.since_2020.count}동)`,
          "출처: 건축물대장 사용승인일"
        ),
        detail: compareDetail(
          `사용승인일이 확인된 건물(판교 ${pTimeline.total_with_date}동, 동탄 ${dTimeline.total_with_date}동) 기준 연도별 준공 동수입니다. 판교는 여러 해에 걸쳐 분산 준공된 반면, 동탄은 특정 시점에 준공이 집중되었는지를 비교합니다. 사용승인일 매칭이 안 된 건물(판교 ${pTimeline.total_without_date}동, 동탄 ${dTimeline.total_without_date}동)은 집계에서 제외했습니다.`,
          `${renderCompletionTimelineSvg(pTimeline.years, dTimeline.years)}
          <div class="access-legend compare inline">
            <span><i class="pangyo"></i>판교</span>
            <span><i class="dongtan"></i>동탄</span>
          </div>`
        ),
      },
    ]),
    compareCard("2 토지이용·건축", [
      {
        metric: "건축물 주용도 구성비",
        pangyo: miniShareBars(pBuild.byUse),
        dongtan: miniShareBars(dBuild.byUse),
        detail: compareDetail(
          "건축물대장과 결합된 건물의 주용도별 연면적 비율입니다.",
          shareComparisonChart(pBuild.byUse, dBuild.byUse, "주용도별 연면적 비율 비교")
        ),
      },
      {
        metric: "혼합도",
        pangyo: compareValue("LUM", pLand.lum.toFixed(3), "0 단일용도 · 1 완전혼합", "출처: VWorld 용도지역"),
        dongtan: compareValue("LUM", dLand.lum.toFixed(3), "0 단일용도 · 1 완전혼합", "출처: VWorld 용도지역"),
        detail: compareDetail(
          "LUM은 용도지역 면적 비율의 엔트로피 지수입니다. 1에 가까울수록 여러 용도가 균형 있게 섞여 있고, 0에 가까울수록 특정 용도가 지배적입니다.",
          metricComparisonChart("토지이용 혼합도 LUM", pLand.lum, dLand.lum, { decimals: 3 })
        ),
      },
      {
        metric: "개발 실현 정도",
        pangyo: compareValue("평균 용적률", farBars.pangyo, "", "출처: 건축물대장 연면적/대지면적"),
        dongtan: compareValue("평균 용적률", farBars.dongtan, "", "출처: 건축물대장 연면적/대지면적"),
        detail: compareDetail(
          "건축물대장 연면적 합계를 대지면적 합계로 나눈 평균 용적률입니다. 값이 높을수록 구역 내 개발 밀도가 높은 것으로 해석할 수 있습니다.",
          metricComparisonChart("평균 용적률", pBuild.avgFar, dBuild.avgFar, { suffix: "%", decimals: 1 })
        ),
      },
      {
        metric: "도로망 밀도",
        pangyo: compareValue(
          "도로 연장/면적",
          pMetric.hasRoadLineData ? roadDensityBars.pangyo : "데이터 없음",
          pMetric.hasRoadLineData ? `총 ${pMetric.roadLengthKm.toFixed(1)}km` : "OSM 도로망 미수집",
          "출처: OSM 도로망"
        ),
        dongtan: compareValue(
          "도로 연장/면적",
          dMetric.hasRoadLineData ? roadDensityBars.dongtan : "데이터 없음",
          dMetric.hasRoadLineData ? `총 ${dMetric.roadLengthKm.toFixed(1)}km` : "OSM 도로망 미수집 (재수집 필요)",
          "출처: OSM 도로망"
        ),
        detail: compareDetail(
          "구역 경계 내부로 절단한 OSM 도로 선형의 총 길이를 구역 면적(km²)으로 나눈 값입니다. 값이 높을수록 단위면적당 도로가 촘촘하게 깔려 있습니다.",
          metricComparisonChart("도로망 밀도", pMetric.roadDensityKmPerKm2, dMetric.roadDensityKmPerKm2, { suffix: "km/km²", decimals: 2 })
        ),
      },
      {
        metric: "도로 방향 분산도 (격자성)",
        pangyo: compareValue(
          "방향 엔트로피",
          pMetric.roadOrientationEntropy != null ? pMetric.roadOrientationEntropy.toFixed(3) : "데이터 없음",
          "0 격자형 · 1 분산형", "출처: OSM 도로망 방위각"
        ),
        dongtan: compareValue(
          "방향 엔트로피",
          dMetric.roadOrientationEntropy != null ? dMetric.roadOrientationEntropy.toFixed(3) : "데이터 없음",
          "0 격자형 · 1 분산형", "출처: OSM 도로망 방위각"
        ),
        detail: compareDetail(
          "도로 선형을 10도 단위 방위각 구간(0~180도, 방향성 구분 없음)으로 나누고 길이로 가중한 정규화 엔트로피입니다. 0에 가까우면 소수의 직각 방향에 도로가 집중된 격자형 구조, 1에 가까우면 다양한 방향으로 분산된 구조로 해석합니다.",
          metricComparisonChart("도로 방향 엔트로피", pMetric.roadOrientationEntropy || 0, dMetric.roadOrientationEntropy || 0, { decimals: 3 })
        ),
      },
    ]),
    compareCard("3 등시간권", [
      {
        metric: "핵심역",
        pangyo: compareValue("판교역", "신분당선/경강선", "업무지구 중심부", "출처: 본인 정의"),
        dongtan: compareValue("동탄역", "GTX-A", "광역 접근 중심", "출처: 본인 정의"),
        detail: compareDetail(
          "핵심역은 각 업무지구의 광역 접근성을 대표하는 역으로 정의했습니다. 판교는 업무지구 중심부의 판교역, 동탄은 광역철도 접근 중심인 동탄역을 사용합니다.",
          `<div class="detail-chart station-detail-grid">
            <div><span>판교</span><b>판교역</b><small>신분당선/경강선 환승, 판교 업무지구 중심부</small></div>
            <div><span>동탄</span><b>동탄역</b><small>GTX-A 광역 접근 중심, 동탄권 대표역</small></div>
          </div>`
        ),
      },
      {
        metric: "30분 접근성",
        pangyo: compareValue("도달 규모", accessText("pangyo_phase1", 30), "", "출처: 지하철 네트워크 + SGIS"),
        dongtan: compareValue("도달 규모", accessText("dongtan_techno_valley", 30), "", "출처: 지하철 네트워크 + SGIS"),
        detail: compareDetail(
          "중심역에서 지하철 네트워크로 30분 이내 도달 가능한 역을 찾고, 각 역 1km 버퍼와 교차하는 집계구의 인구·종사자를 합산했습니다.",
          accessDetailChart(30)
        ),
      },
      {
        metric: "60분 접근성",
        pangyo: compareValue("도달 규모", accessText("pangyo_phase1", 60), "", "출처: 지하철 네트워크 + SGIS"),
        dongtan: compareValue("도달 규모", accessText("dongtan_techno_valley", 60), "", "출처: 지하철 네트워크 + SGIS"),
        detail: compareDetail(
          "60분권은 중심역에서 60분 이내로 도달 가능한 역과 그 주변 집계구의 인구·종사자를 합산한 값입니다.",
          accessDetailChart(60)
        ),
      },
      {
        metric: "누적 접근성",
        pangyo: compareValue("곡선", "아래 그래프", "0~60분, 5분 간격"),
        dongtan: compareValue("곡선", "아래 그래프", "0~60분, 5분 간격"),
        detail: compareDetail(
          "아래 누적 접근성 곡선은 5분 간격으로 도달가능 인구와 종사자가 어떻게 증가하는지 보여줍니다. 특정 시간대 한 점보다 증가 속도와 포화 구간을 비교하는 데 유용합니다.",
          accessCurveComparisonHtml()
        ),
      },
    ]),
    compareCard("4 인구사회", [
      {
        metric: "인구",
        pangyo: compareValue("상주인구", popBars.pangyo, "구역계 내 SGIS 집계구 총인구", "출처: SGIS 집계구"),
        dongtan: compareValue("상주인구", popBars.dongtan, "구역계 내 SGIS 집계구 총인구", "출처: SGIS 집계구"),
        detail: compareDetail(
          "구역 및 주변으로 선택된 SGIS 집계구의 총인구입니다. 행정 집계구 단위라 실제 구역 내부 인구와는 차이가 있을 수 있습니다.",
          metricComparisonChart("상주인구 비교", pMetric.population, dMetric.population, { suffix: "명" })
        ),
      },
      {
        metric: "종사자",
        pangyo: compareValue("종사자수", workerBars.pangyo, "구역계 내 SGIS 집계구 종사자", "출처: SGIS 집계구"),
        dongtan: compareValue("종사자수", workerBars.dongtan, "구역계 내 SGIS 집계구 종사자", "출처: SGIS 집계구"),
        detail: compareDetail(
          "SGIS 전국사업체조사의 종사자 지표를 구역계와 집계구의 교차 비율로 계산했습니다.",
          metricComparisonChart("종사자수 비교", pMetric.workers, dMetric.workers, { suffix: "명" })
        ),
      },
      {
        metric: "종사자 업종 구성 (SGIS 대분류)",
        pangyo: compareValue(
          "1위 업종",
          pIndustry.by_class[0] ? `${pIndustry.by_class[0].label} ${pIndustry.by_class[0].ratio}%` : "데이터 없음",
          "", "출처: SGIS 전국사업체조사 10차 대분류"
        ),
        dongtan: compareValue(
          "1위 업종",
          dIndustry.by_class[0] ? `${dIndustry.by_class[0].label} ${dIndustry.by_class[0].ratio}%` : "데이터 없음",
          "", "출처: SGIS 전국사업체조사 10차 대분류"
        ),
        detail: compareDetail(
          "SGIS 전국사업체조사 10차 대분류 기준 종사자수 비율입니다. 구역계와 교차하는 SGIS 집계구를 면적 가중 합산했습니다. 판교는 정보통신업(IT) 중심, 동탄은 제조업 비중이 높은지를 비교해 오피스 기반 고용 밀도 차이를 보여줍니다. 비공개(N/A) 처리된 값은 0으로 집계되어 과소평가될 수 있습니다.",
          shareComparisonChart(pIndustry.by_class, dIndustry.by_class, "산업 대분류별 종사자 비율 비교")
        ),
      },
      {
        metric: "사업체",
        pangyo: compareValue("사업체수", businessBars.pangyo, `상가업소 좌표 · 건물 1동당 ${pBizPerBuilding.toFixed(1)}개`, "출처: 상가(상권)정보"),
        dongtan: compareValue("사업체수", businessBars.dongtan, `상가업소 좌표 · 건물 1동당 ${dBizPerBuilding.toFixed(1)}개`, "출처: 상가(상권)정보"),
        detail: compareDetail(
          "소상공인시장진흥공단 상가(상권)정보의 경도·위도를 구역계와 공간 결합해 산정한 사업체수입니다.",
          `<div class="compare-warning">현재 사업체수는 상가업소 좌표 기반입니다. 동일 건물 안 여러 업소가 각각 집계됩니다.</div>
          ${metricComparisonChart("사업체수 비교", pMetric.businesses || 0, dMetric.businesses || 0, { suffix: "개" })}`
        ),
      },
      {
        metric: "기업 업종 상세",
        pangyo: compareValue("대분류", pBizIndustry.large.slice(0, 3).map((item) => item.label).join(" / "), "상가업소 업종 분포", "출처: 상가(상권)정보"),
        dongtan: compareValue("대분류", dBizIndustry.large.slice(0, 3).map((item) => item.label).join(" / "), "상가업소 업종 분포", "출처: 상가(상권)정보"),
        detail: compareDetail(
          "상가업소정보의 대분류와 중분류 비중을 집계한 업종 구성입니다.",
          `${shareComparisonChart(pBizIndustry.large, dBizIndustry.large, "대분류 업종 비율 비교")}
          ${shareComparisonChart(pBizIndustry.middle, dBizIndustry.middle, "중분류 업종 비율 비교")}`
        ),
      },
      {
        metric: "직주 지표",
        pangyo: compareValue("직주비", jobHousingBars.pangyo, "", "출처: 종사자 / 상주인구"),
        dongtan: compareValue("직주비", jobHousingBars.dongtan, "", "출처: 종사자 / 상주인구"),
        detail: compareDetail(
          "직주비는 종사자수/상주인구입니다. 1보다 크면 거주보다 일자리 기능이 상대적으로 강하고, 값이 클수록 업무지구 성격이 두드러집니다.",
          metricComparisonChart("직주비 비교", pJobHousing, dJobHousing, { decimals: 2 })
        ),
      },
    ]),
  ];

  body.innerHTML = cards.join("");
}

async function main() {
  state.data = await loadJson("02_data/processed/app_data.json");
  document.getElementById("generatedAt").textContent = state.data.generated_at;
  document.getElementById("dataStatus").textContent  = "processed data ready";

  const pangyo  = state.data.areas.pangyo_phase1;
  const dongtan = state.data.areas.dongtan_techno_valley;

  state.maps.pangyo_phase1          = makeMap("pangyoMap",  [37.4025, 127.0983]);
  state.maps.dongtan_techno_valley  = makeMap("dongtanMap", [37.2630, 127.0860]);

  document.getElementById("pangyoMeta").textContent  = `${pangyo.core_station} 기준 · ${fmt(pangyo.boundary.area_m2)}㎡`;
  document.getElementById("dongtanMeta").textContent = `${dongtan.core_station} 기준 · ${fmt(dongtan.boundary.area_m2)}㎡`;

  await Promise.all([
    loadArea("pangyo_phase1"),
    loadArea("dongtan_techno_valley"),
  ]);

  bindLayerButtons("pangyo_phase1");
  bindLayerButtons("dongtan_techno_valley");
  bindModeButtons();
  renderModeLegend(state.currentMode);
  renderCompareTable();

  addIsochroneControl(state.maps.pangyo_phase1, "pangyo_phase1");
  addIsochroneStatsPanel(state.maps.pangyo_phase1, "pangyo_phase1");
  addIsochroneControl(state.maps.dongtan_techno_valley, "dongtan_techno_valley");
  addIsochroneStatsPanel(state.maps.dongtan_techno_valley, "dongtan_techno_valley");
  preloadAccessibilityCurves();
}

main().catch((err) => {
  console.error(err);
  document.getElementById("dataStatus").textContent = "load failed";
});
