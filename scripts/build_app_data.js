const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const RAW = path.join(DATA, "raw");
const PROCESSED = path.join(DATA, "processed");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inQuotes) {
      if (ch === '"') {
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line) {
  return parseCsv(`${line}\n`)[0] || [];
}

function rowsToObjects(filePath) {
  const rows = parseCsv(readText(filePath));
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).filter((row) => row.some((cell) => String(cell).trim() !== "")).map((row) => {
    const obj = {};
    header.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

function toNum(value) {
  const n = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function formatNum(n) {
  return new Intl.NumberFormat("ko-KR").format(Math.round(n));
}

function safeJson(filePath) {
  return JSON.parse(readText(filePath));
}

function degToRad(v) {
  return (v * Math.PI) / 180;
}

function radToDeg(v) {
  return (v * 180) / Math.PI;
}

function epsg5179ToWgs84(x, y) {
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

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!polygon || !Array.isArray(polygon.coordinates)) return false;
  if (polygon.type === "MultiPolygon") {
    return polygon.coordinates.some((coordinates) => pointInPolygon(point, { type: "Polygon", coordinates }));
  }
  const rings = polygon.coordinates;
  if (!rings.length) return false;
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

function haversineMeters(a, b) {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const R = 6371000;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function geometryCenter(geometry) {
  if (!geometry || !geometry.coordinates) return null;
  const coords = geometryCoordinates(geometry);
  if (!coords.length) return null;
  let minX = coords[0][0];
  let maxX = coords[0][0];
  let minY = coords[0][1];
  let maxY = coords[0][1];
  for (const [x, y] of coords) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function geometryCoordinates(geometry) {
  const coords = [];
  const collect = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number" && typeof value[1] === "number") {
      coords.push(value);
      return;
    }
    for (const item of value) collect(item);
  };
  if (geometry?.coordinates) collect(geometry.coordinates);
  return coords;
}

function geometryBBox(geometry) {
  const coords = geometryCoordinates(geometry);
  if (!coords.length) return null;
  return coords.reduce((acc, [lon, lat]) => ({
    minLon: Math.min(acc.minLon, lon),
    maxLon: Math.max(acc.maxLon, lon),
    minLat: Math.min(acc.minLat, lat),
    maxLat: Math.max(acc.maxLat, lat),
  }), {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  });
}

function bboxesOverlap(a, b) {
  return Boolean(a && b) && !(
    a.maxLon < b.minLon ||
    a.minLon > b.maxLon ||
    a.maxLat < b.minLat ||
    a.minLat > b.maxLat
  );
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-12) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return (
    b[0] <= Math.max(a[0], c[0]) + 1e-12 &&
    b[0] + 1e-12 >= Math.min(a[0], c[0]) &&
    b[1] <= Math.max(a[1], c[1]) + 1e-12 &&
    b[1] + 1e-12 >= Math.min(a[1], c[1])
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function geometryRings(geometry) {
  if (!geometry?.coordinates) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

function geometryIntersectsPolygon(geometry, polygon) {
  const coords = geometryCoordinates(geometry);
  if (!coords.length) return false;

  const boundaryRing = polygon?.coordinates?.[0] || [];
  const boundaryBBox = geometryBBox(polygon);
  const featureBBox = geometryBBox(geometry);
  if (!bboxesOverlap(featureBBox, boundaryBBox)) return false;

  const center = geometryCenter(geometry);
  if (center && pointInPolygon(center, polygon)) return true;
  if (coords.some((point) => pointInPolygon(point, polygon))) return true;

  const featureOuterRings = geometryRings(geometry).filter((ring) => ring.length >= 2);
  for (const ring of featureOuterRings) {
    if (boundaryRing.some((point) => pointInRing(point, ring))) return true;
    for (let i = 1; i < ring.length; i += 1) {
      for (let j = 1; j < boundaryRing.length; j += 1) {
        if (segmentsIntersect(ring[i - 1], ring[i], boundaryRing[j - 1], boundaryRing[j])) {
          return true;
        }
      }
    }
  }

  return false;
}

function clipGeoFeatures(features, boundaryPolygon) {
  return features.filter((feature) => geometryIntersectsPolygon(feature.geometry, boundaryPolygon));
}

function readDbfRecords(filePath) {
  const buffer = fs.readFileSync(filePath);
  const recordCount = buffer.readUInt32LE(4);
  const headerLength = buffer.readUInt16LE(8);
  const recordLength = buffer.readUInt16LE(10);
  const fields = [];
  let offset = 32;
  while (buffer[offset] !== 0x0d) {
    const name = buffer.slice(offset, offset + 11).toString("ascii").replace(/\0.*$/, "").trim();
    const type = String.fromCharCode(buffer[offset + 11]);
    const length = buffer[offset + 16];
    fields.push({ name, type, length });
    offset += 32;
  }
  const records = [];
  let rowOffset = headerLength;
  for (let i = 0; i < recordCount; i += 1) {
    const deleted = buffer[rowOffset] === 0x2a;
    rowOffset += 1;
    const row = {};
    for (const field of fields) {
      const raw = buffer.slice(rowOffset, rowOffset + field.length).toString("utf8").trim();
      row[field.name] = raw;
      rowOffset += field.length;
    }
    if (!deleted) records.push(row);
    rowOffset = headerLength + (i + 1) * recordLength;
  }
  return records;
}

function readShpRecordCenters(filePath) {
  const buffer = fs.readFileSync(filePath);
  const records = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readUInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const shapeType = buffer.readUInt32LE(contentOffset);
    if (shapeType === 5 || shapeType === 3) {
      const minX = buffer.readDoubleLE(contentOffset + 4);
      const minY = buffer.readDoubleLE(contentOffset + 12);
      const maxX = buffer.readDoubleLE(contentOffset + 20);
      const maxY = buffer.readDoubleLE(contentOffset + 28);
      records.push({
        bbox5179: { minX, minY, maxX, maxY },
        center5179: [(minX + maxX) / 2, (minY + maxY) / 2],
      });
    } else {
      records.push({ center5179: null, bbox5179: null });
    }
    offset = contentOffset + contentLength;
  }
  return records;
}

function readShpPolygonRecords(filePath) {
  const buffer = fs.readFileSync(filePath);
  const records = [];
  let offset = 100;
  while (offset + 8 <= buffer.length) {
    const contentLength = buffer.readUInt32BE(offset + 4) * 2;
    const contentOffset = offset + 8;
    const shapeType = buffer.readUInt32LE(contentOffset);
    if (shapeType === 5) {
      const minX = buffer.readDoubleLE(contentOffset + 4);
      const minY = buffer.readDoubleLE(contentOffset + 12);
      const maxX = buffer.readDoubleLE(contentOffset + 20);
      const maxY = buffer.readDoubleLE(contentOffset + 28);
      const numParts = buffer.readInt32LE(contentOffset + 36);
      const numPoints = buffer.readInt32LE(contentOffset + 40);
      const partsOffset = contentOffset + 44;
      const pointsOffset = partsOffset + numParts * 4;
      const parts = [];
      for (let i = 0; i < numParts; i += 1) {
        parts.push(buffer.readInt32LE(partsOffset + i * 4));
      }
      const points = [];
      for (let i = 0; i < numPoints; i += 1) {
        const x = buffer.readDoubleLE(pointsOffset + i * 16);
        const y = buffer.readDoubleLE(pointsOffset + i * 16 + 8);
        points.push(epsg5179ToWgs84(x, y));
      }
      const rings = parts.map((start, index) => {
        const end = index + 1 < parts.length ? parts[index + 1] : points.length;
        return points.slice(start, end);
      }).filter((ring) => ring.length >= 4);
      const bboxWgs84 = [
        epsg5179ToWgs84(minX, minY),
        epsg5179ToWgs84(maxX, minY),
        epsg5179ToWgs84(maxX, maxY),
        epsg5179ToWgs84(minX, maxY),
      ].reduce((acc, [lon, lat]) => ({
        minLon: Math.min(acc.minLon, lon),
        maxLon: Math.max(acc.maxLon, lon),
        minLat: Math.min(acc.minLat, lat),
        maxLat: Math.max(acc.maxLat, lat),
      }), { minLon: Infinity, maxLon: -Infinity, minLat: Infinity, maxLat: -Infinity });
      records.push({
        bbox5179: { minX, minY, maxX, maxY },
        center5179: [(minX + maxX) / 2, (minY + maxY) / 2],
        bboxWgs84,
        rings,
      });
    } else {
      records.push({ center5179: null, bbox5179: null, bboxWgs84: null, rings: [] });
    }
    offset = contentOffset + contentLength;
  }
  return records;
}

function pointInShpPolygon(point, record) {
  return (record.rings || []).some((ring) => pointInRing(point, ring));
}

function bboxObjectsOverlap(a, b) {
  return !(a.maxLon < b.minLon || a.minLon > b.maxLon || a.maxLat < b.minLat || a.minLat > b.maxLat);
}

function estimatePolygonOverlapRatio(record, boundaryPolygon, boundaryBBox) {
  if (!record?.bboxWgs84 || !record.rings?.length || !bboxObjectsOverlap(record.bboxWgs84, boundaryBBox)) return 0;
  const bbox = record.bboxWgs84;
  const steps = 16;
  let insideTract = 0;
  let insideBoth = 0;
  for (let ix = 0; ix < steps; ix += 1) {
    const lon = bbox.minLon + ((ix + 0.5) / steps) * (bbox.maxLon - bbox.minLon);
    for (let iy = 0; iy < steps; iy += 1) {
      const lat = bbox.minLat + ((iy + 0.5) / steps) * (bbox.maxLat - bbox.minLat);
      const point = [lon, lat];
      if (!pointInShpPolygon(point, record)) continue;
      insideTract += 1;
      if (pointInPolygon(point, boundaryPolygon)) insideBoth += 1;
    }
  }
  if (insideTract > 0) return insideBoth / insideTract;
  const center = record.center5179 ? epsg5179ToWgs84(record.center5179[0], record.center5179[1]) : null;
  return center && pointInPolygon(center, boundaryPolygon) ? 1 : 0;
}

function flattenFeaturesFromVWorldJson(filePath, sourceLayer) {
  const raw = safeJson(filePath);
  const fc = raw?.response?.result?.featureCollection || raw?.featureCollection || raw;
  const features = Array.isArray(fc?.features) ? fc.features : [];
  return features.map((feature, index) => ({
    type: "Feature",
    id: feature.id || `${path.basename(filePath)}_${index}`,
    properties: {
      ...(feature.properties || {}),
      source_file: path.basename(filePath),
      source_layer: sourceLayer,
    },
    geometry: feature.geometry,
  }));
}

function dedupeFeatures(features) {
  const seen = new Set();
  const out = [];
  for (const feature of features) {
    const key = String(
      feature.id ||
      feature.properties?.bd_mgt_sn ||
      feature.properties?.pnu ||
      JSON.stringify(feature.geometry)
    );
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feature);
  }
  return out;
}

function collectAreaFeatures(areaDir, layerNames) {
  const areaPath = path.join(RAW, "vworld", areaDir);
  const featuresByLayer = {};
  for (const layer of layerNames) {
    const layerPath = path.join(areaPath, layer);
    if (!fs.existsSync(layerPath)) {
      featuresByLayer[layer] = [];
      continue;
    }
    const files = fs.readdirSync(layerPath).filter((name) => name.endsWith(".json")).sort();
    const collected = [];
    for (const file of files) {
      const full = path.join(layerPath, file);
      try {
        collected.push(...flattenFeaturesFromVWorldJson(full, layer));
      } catch {
        // Keep raw files as provenance; skip malformed pages.
      }
    }
    featuresByLayer[layer] = dedupeFeatures(collected);
  }
  return featuresByLayer;
}

function lineLengthMeters(coords) {
  let sum = 0;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  for (let i = 1; i < coords.length; i += 1) {
    const [lon1, lat1] = coords[i - 1];
    const [lon2, lat2] = coords[i];
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    sum += 2 * R * Math.asin(Math.sqrt(a));
  }
  return sum;
}

function polygonMetrics(polygon) {
  const ring = polygon?.coordinates?.[0] || [];
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  const lat0 = degToRad(lats.reduce((sum, lat) => sum + lat, 0) / Math.max(lats.length, 1));
  const radius = 6378137;
  const xy = ring.map(([lon, lat]) => [
    radius * degToRad(lon) * Math.cos(lat0),
    radius * degToRad(lat),
  ]);

  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < xy.length - 1; i += 1) {
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[i + 1];
    const crossValue = x1 * y2 - x2 * y1;
    area += crossValue;
    cx += (x1 + x2) * crossValue;
    cy += (y1 + y2) * crossValue;
  }
  area /= 2;

  const centroid = area
    ? [
        radToDeg((cx / (6 * area)) / (radius * Math.cos(lat0))),
        radToDeg((cy / (6 * area)) / radius),
      ]
    : [
        (Math.min(...lons) + Math.max(...lons)) / 2,
        (Math.min(...lats) + Math.max(...lats)) / 2,
      ];

  return {
    area_m2: Math.round(Math.abs(area)),
    centroid,
    bbox: {
      minLon: Math.min(...lons),
      maxLon: Math.max(...lons),
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
    },
  };
}

function convertOsmWayToFeature(way) {
  if (!Array.isArray(way.geometry) || way.geometry.length < 2) return null;
  const coords = way.geometry.map((pt) => [pt.lon, pt.lat]);
  return {
    type: "Feature",
    id: way.id,
    properties: {
      highway: way.tags?.highway || "",
      name: way.tags?.name || "",
      ref: way.tags?.ref || "",
      source: "osm",
      way_id: way.id,
      length_m: lineLengthMeters(coords),
    },
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
  };
}

function isRoadParcel(feature) {
  const p = feature.properties || {};
  const jibun = String(p.jibun || p.bonbun || "").trim();
  return jibun.endsWith("도");
}

function roadParcelsToFeatures(parcels) {
  return parcels.filter(isRoadParcel).map((feature) => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      source: "vworld_parcel_road",
      highway: "road_parcel",
      name: feature.properties?.addr || feature.properties?.jibun || "",
    },
  }));
}

function summarizeBuildingCsv(filePath) {
  const rows = rowsToObjects(filePath);
  const total = rows.length;
  const siteArea = rows.reduce((acc, row) => acc + toNum(row["대지면적(㎡)"]), 0);
  const buildingArea = rows.reduce((acc, row) => acc + toNum(row["건축면적(㎡)"]), 0);
  const floorArea = rows.reduce((acc, row) => acc + toNum(row["연면적(㎡)"] || row["총동연면적(㎡)"]), 0);
  const avgFloors = rows.reduce((acc, row) => acc + toNum(row["지상층수"]), 0) / Math.max(total, 1);
  const uses = new Map();
  for (const row of rows) {
    const use = row["주용도코드명"] || "미상";
    uses.set(use, (uses.get(use) || 0) + 1);
  }
  const useCounts = Array.from(uses.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    file: path.basename(filePath),
    rows: total,
    total_site_area_m2: siteArea,
    total_building_area_m2: buildingArea,
    total_floor_area_m2: floorArea,
    avg_floors: avgFloors,
    use_counts: useCounts,
    sample: rows.slice(0, 3),
  };
}

function cleanBom(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

function normalizeAddress(value) {
  return cleanBom(value)
    .replace(/\s+/g, "")
    .replace(/번지/g, "")
    .replace(/산(?=\d)/g, "")
    .trim();
}

function parcelKeyFromRegistryRow(row) {
  const sigungu = cleanBom(row["시군구코드"]).padStart(5, "0");
  const dong = cleanBom(row["법정동코드"]).padStart(5, "0");
  const bun = cleanBom(row["번"]).padStart(4, "0");
  const ji = cleanBom(row["지"]).padStart(4, "0");
  if (!sigungu.trim() || !dong.trim() || !bun.trim()) return "";
  return `${sigungu}${dong}:${bun}:${ji}`;
}

function parcelKeyFromBuildingFeature(feature) {
  const serial = String(feature.properties?.bd_mgt_sn || "");
  if (serial.length >= 19) {
    return `${serial.slice(0, 10)}:${serial.slice(11, 15)}:${serial.slice(15, 19)}`;
  }
  return "";
}

function featureAddressKey(feature) {
  const p = feature.properties || {};
  const parts = [p.sido, p.sigungu, p.gu, p.buld_no].filter(Boolean);
  return normalizeAddress(parts.join(" "));
}

function roadAddressKey(value) {
  const cleaned = cleanBom(value).replace(/\([^)]*\)/g, "").trim();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return "";
  return normalizeAddress(tokens.slice(-2).join(" "));
}

function featureRoadKey(feature) {
  const p = feature.properties || {};
  if (!p.rd_nm || !p.buld_no) return "";
  return normalizeAddress(`${p.rd_nm} ${p.buld_no}`);
}

function loadBuildingRegistryLookup() {
  const folder = path.join(RAW, "building_registry_manual");
  const files = [
    "building_title_20260617095616.csv",
    "building_title_20260617095637.csv",
    "building_total_title_20260617095702.csv",
    "building_total_title_20260617095713.csv",
  ];
  const parcelGroups = new Map();
  const addressGroups = new Map();
  const roadGroups = new Map();

  for (const file of files) {
    const rows = rowsToObjects(path.join(folder, file));
    const isTotal = file.includes("total_title");
    for (const row of rows) {
      const parcelKey = parcelKeyFromRegistryRow(row);
      const addressKey = normalizeAddress(row["대지위치"]);
      const roadKey = roadAddressKey(row["도로명대지위치"]);
      if (!parcelKey && !addressKey && !roadKey) continue;
      const item = {
        source_file: file,
        is_total_title: isTotal,
        land_address: cleanBom(row["대지위치"]),
        road_address: cleanBom(row["도로명대지위치"]),
        building_name: cleanBom(row["건물명"]),
        main_use: cleanBom(row["주용도코드명"]),
        floor_area: toNum(row["연면적(㎡)"]),
        site_area: toNum(row["대지면적(㎡)"]),
        far: toNum(row["용적률(%)"]),
        approval_date: cleanBom(row["사용승인일"]),
      };
      if (parcelKey) {
        if (!parcelGroups.has(parcelKey)) parcelGroups.set(parcelKey, []);
        parcelGroups.get(parcelKey).push(item);
      }
      if (addressKey) {
        if (!addressGroups.has(addressKey)) addressGroups.set(addressKey, []);
        addressGroups.get(addressKey).push(item);
      }
      if (roadKey) {
        if (!roadGroups.has(roadKey)) roadGroups.set(roadKey, []);
        roadGroups.get(roadKey).push(item);
      }
    }
  }

  const summarizeRows = (rows) => {
    if (!rows || !rows.length) return null;
    const preferred = rows.some((row) => row.is_total_title)
      ? rows.filter((row) => row.is_total_title)
      : rows;
    const sortedByArea = [...preferred].sort((a, b) => b.floor_area - a.floor_area);
    const representative = sortedByArea[0] || preferred[0];
    const floorArea = preferred.reduce((sum, row) => sum + row.floor_area, 0);
    const siteArea = Math.max(...preferred.map((row) => row.site_area), 0);
    return {
      "주용도": representative.main_use || "",
      "연면적": floorArea,
      "대지면적": siteArea,
      "용적률": siteArea > 0 ? (floorArea / siteArea) * 100 : representative.far || 0,
      "건물명": representative.building_name || "",
      "대지위치": representative.land_address || "",
      "도로명대지위치": representative.road_address || "",
      "사용승인일": representative.approval_date || "",
      "_registry_joined": true,
      "_registry_source": Array.from(new Set(preferred.map((row) => row.source_file))).join(", "),
    };
  };

  return {
    byParcel: new Map(Array.from(parcelGroups.entries()).map(([key, rows]) => [key, summarizeRows(rows)])),
    byAddress: new Map(Array.from(addressGroups.entries()).map(([key, rows]) => [key, summarizeRows(rows)])),
    byRoad: new Map(Array.from(roadGroups.entries()).map(([key, rows]) => [key, summarizeRows(rows)])),
  };
}

function classifyRegistryUse(properties) {
  const use = String(properties["주용도"] || "").trim();
  const name = String(properties.buld_nm || properties["건물명"] || "").trim();
  const floors = toNum(properties.gro_flo_co || properties["지상층수"]);
  const text = `${use} ${name}`;
  if (/업무|office|R&D|연구|벤처|테크|캠퍼스/i.test(text)) return { label: "업무시설", color: "#2f80ed" };
  if (/공장|지식산업|산업|factory|제조/i.test(text)) return { label: "공장/지식산업센터", color: "#777d86" };
  if (/근린|상가|소매|음식|생활|retail/i.test(text)) return { label: "근린생활시설", color: "#f2994a" };
  if (!use || use === "기타") {
    if (floors >= 5) return { label: "업무시설", color: "#2f80ed" };
    if (floors >= 1) return { label: "근린생활시설", color: "#f2994a" };
  }
  return { label: use || "기타", color: "#c8ced6" };
}

function enrichBuildingsWithRegistry(features, registryLookup) {
  let matched = 0;
  const enriched = features.map((feature) => {
    const properties = { ...(feature.properties || {}) };
    const registry =
      registryLookup.byParcel.get(parcelKeyFromBuildingFeature(feature)) ||
      registryLookup.byRoad.get(featureRoadKey(feature)) ||
      registryLookup.byAddress.get(featureAddressKey(feature));
    if (registry) {
      matched += 1;
      Object.assign(properties, registry);
    } else {
      properties["주용도"] = properties["주용도"] || "기타";
      properties["연면적"] = toNum(properties["연면적"]);
      properties["대지면적"] = toNum(properties["대지면적"]);
      properties["용적률"] = toNum(properties["용적률"]);
      properties["건물명"] = properties["건물명"] || properties.buld_nm || "";
      properties["사용승인일"] = properties["사용승인일"] || "";
      properties["_registry_joined"] = false;
    }
    const classified = classifyRegistryUse(properties);
    properties["색상"] = classified.color;
    properties["용도분류"] = classified.label;
    properties["지상층수"] = toNum(properties["지상층수"] || properties.gro_flo_co);
    return { ...feature, properties };
  });

  return { features: enriched, matched };
}

function buildBuildingStats(areaKey, features) {
  const groups = new Map();
  for (const feature of features) {
    const p = feature.properties || {};
    const hasFloorArea = toNum(p["연면적"]) > 0;
    const use = !p._registry_joined && !hasFloorArea ? "미분류(면적없음)" : p["용도분류"] || p["주용도"] || "기타";
    const entry = groups.get(use) || { count: 0, floor: 0, color: p["색상"] || "#c8ced6" };
    entry.count += 1;
    entry.floor += toNum(p["연면적"]);
    groups.set(use, entry);
  }
  const total = Array.from(groups.values()).reduce((sum, group) => sum + group.floor, 0);
  const byUse = Array.from(groups.entries())
    .sort((a, b) => b[1].floor - a[1].floor)
    .map(([label, group]) => ({
      "용도": label,
      "색상": group.color,
      "건물수": group.count,
      "연면적": Math.round(group.floor * 10) / 10,
      "비율": total ? Math.round((group.floor / total) * 1000) / 10 : 0,
    }));
  writeJson(path.join(PROCESSED, "stats", `${areaKey}_building_stats.json`), {
    area: areaKey,
    total_floor_area: Math.round(total * 10) / 10,
    by_use: byUse,
  });
}

function parseApprovalYear(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (digits.length < 4) return null;
  const year = Number(digits.slice(0, 4));
  return year >= 1900 && year <= 2100 ? year : null;
}

function buildCompletionTimeline(areaKey, features) {
  const byYear = new Map();
  let withDate = 0;
  let withoutDate = 0;
  for (const feature of features) {
    const p = feature.properties || {};
    const year = parseApprovalYear(p["사용승인일"]);
    if (year == null) {
      withoutDate += 1;
      continue;
    }
    withDate += 1;
    const entry = byYear.get(year) || { year, count: 0, floor_area: 0 };
    entry.count += 1;
    entry.floor_area += toNum(p["연면적"]);
    byYear.set(year, entry);
  }

  const years = Array.from(byYear.values()).sort((a, b) => a.year - b.year);
  let cumulativeCount = 0;
  let cumulativeFloorArea = 0;
  for (const row of years) {
    cumulativeCount += row.count;
    cumulativeFloorArea += row.floor_area;
    row.cumulative_count = cumulativeCount;
    row.cumulative_floor_area = Math.round(cumulativeFloorArea * 10) / 10;
    row.floor_area = Math.round(row.floor_area * 10) / 10;
  }

  const peak = years.reduce((best, row) => (!best || row.count > best.count ? row : best), null);
  const since2020Count = years.filter((row) => row.year >= 2020).reduce((sum, row) => sum + row.count, 0);

  writeJson(path.join(PROCESSED, "stats", `${areaKey}_completion_timeline.json`), {
    area: areaKey,
    years,
    total_with_date: withDate,
    total_without_date: withoutDate,
    peak_year: peak ? { year: peak.year, count: peak.count } : null,
    since_2020: {
      count: since2020Count,
      ratio: withDate ? Math.round((since2020Count / withDate) * 1000) / 10 : 0,
    },
  });
}

function summarizeSgisFolder(folderPath, options = {}) {
  const files = fs.readdirSync(folderPath).filter((name) => name.endsWith(".csv")).sort();
  const summaries = {};
  for (const file of files) {
    if (options.prefix && !file.startsWith(options.prefix)) continue;
    const rows = parseCsv(readText(path.join(folderPath, file))).filter((row) => row.length >= 4);
    const records = rows.map((row) => ({
      year: row[0],
      tot_oa_cd: row[1],
      indicator_code: row[2],
      value: toNum(row[3]),
    }));
    const filterCodes = options.codes && options.codes.length ? options.codes : null;
    const filtered = filterCodes ? records.filter((r) => filterCodes.includes(r.indicator_code)) : records;
    const byIndicator = {};
    for (const record of records) {
      byIndicator[record.indicator_code] = (byIndicator[record.indicator_code] || 0) + record.value;
    }
    summaries[file] = {
      rows: records.length,
      filtered_rows: filtered.length,
      total_value: filtered.reduce((acc, row) => acc + row.value, 0),
      unique_tracts: new Set(filtered.map((r) => r.tot_oa_cd)).size,
      indicators: Object.keys(byIndicator).sort(),
      indicator_totals: byIndicator,
      sample: records.slice(0, 3),
    };
  }
  return summaries;
}

function buildSgisTractStats(areaCode, shpZipBase, boundaryPolygon) {
  const populationFolder = path.join(RAW, "sgis", "census_tract_stats", "population_2020");
  const workersFolder = path.join(RAW, "sgis", "census_tract_stats", "business_workers_2020");
  const popFiles = fs.readdirSync(populationFolder).filter((name) => name.startsWith(areaCode));
  const workerFiles = fs.readdirSync(workersFolder).filter((name) => name.startsWith(areaCode));
  const dbfPath = path.join(RAW, "sgis", "census_tract_shp", shpZipBase, `${shpZipBase}.dbf`);
  const shpPath = path.join(RAW, "sgis", "census_tract_shp", shpZipBase, `${shpZipBase}.shp`);
  const dbfRecords = readDbfRecords(dbfPath);
  const shpRecords = readShpPolygonRecords(shpPath);
  const selectedCodes = new Set();
  const weights = new Map();
  const boundaryBBox = {
    minLon: Infinity,
    maxLon: -Infinity,
    minLat: Infinity,
    maxLat: -Infinity,
  };
  for (const [lon, lat] of boundaryPolygon.coordinates[0]) {
    if (lon < boundaryBBox.minLon) boundaryBBox.minLon = lon;
    if (lon > boundaryBBox.maxLon) boundaryBBox.maxLon = lon;
    if (lat < boundaryBBox.minLat) boundaryBBox.minLat = lat;
    if (lat > boundaryBBox.maxLat) boundaryBBox.maxLat = lat;
  }
  for (let i = 0; i < Math.min(dbfRecords.length, shpRecords.length); i += 1) {
    const code = dbfRecords[i].TOT_OA_CD || dbfRecords[i].tot_oa_cd || "";
    const record = shpRecords[i];
    if (!code || !record?.bbox5179) continue;
    const ratio = estimatePolygonOverlapRatio(record, boundaryPolygon, boundaryBBox);
    if (ratio > 0) {
      selectedCodes.add(code);
      weights.set(code, ratio);
    }
  }

  if (selectedCodes.size > 100) {
    selectedCodes.clear();
  }

  const population = {};
  for (const file of popFiles) {
    const rows = parseCsv(readText(path.join(populationFolder, file))).filter((row) => row.length >= 4);
    for (const row of rows) {
      const tract = row[1];
      const code = row[2];
      const value = toNum(row[3]);
      if (!tract) continue;
      if (!population[tract]) population[tract] = { tract, indicators: {} };
      population[tract].indicators[code || "unknown"] = value;
    }
  }

  const workers = {};
  for (const file of workerFiles) {
    const rows = parseCsv(readText(path.join(workersFolder, file))).filter((row) => row.length >= 4);
    for (const row of rows) {
      const tract = row[1];
      const code = row[2];
      const value = toNum(row[3]);
      if (!tract) continue;
      if (!workers[tract]) workers[tract] = { tract, indicators: {} };
      workers[tract].indicators[code || "unknown"] = value;
    }
  }

  let selectedPopulation = 0;
  let selectedWorkers = 0;
  for (const code of selectedCodes) {
    const weight = weights.get(code) || 1;
    selectedPopulation += (population[code]?.indicators?.to_in_001 || 0) * weight;
    selectedWorkers += (workers[code]?.indicators?.to_em_020 || 0) * weight;
  }

  if (!selectedCodes.size || (selectedPopulation === 0 && selectedWorkers === 0)) {
    const boundaryCenter = [(boundaryBBox.minLon + boundaryBBox.maxLon) / 2, (boundaryBBox.minLat + boundaryBBox.maxLat) / 2];
    const candidates = [];
    for (let i = 0; i < Math.min(dbfRecords.length, shpRecords.length); i += 1) {
      const code = dbfRecords[i].TOT_OA_CD || dbfRecords[i].tot_oa_cd || "";
      const record = shpRecords[i];
      if (!code || !record?.bbox5179 || !record.center5179) continue;
      const center = epsg5179ToWgs84(record.center5179[0], record.center5179[1]);
      candidates.push({
        code,
        dist: haversineMeters(center, boundaryCenter),
        population: population[code]?.indicators?.to_in_001 || 0,
        workers: workers[code]?.indicators?.to_em_020 || 0,
      });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    let populationSum = 0;
    let workerSum = 0;
    for (const candidate of candidates) {
      selectedCodes.add(candidate.code);
      weights.set(candidate.code, 1);
      populationSum += candidate.population;
      workerSum += candidate.workers;
      if ((populationSum >= 3000 || workerSum >= 10000) && selectedCodes.size >= 3) break;
      if (selectedCodes.size >= 30) break;
    }
  }

  const tractCodes = new Set([...selectedCodes]);
  const tracts = Array.from(tractCodes).sort().map((tract) => ({
    tract,
    weight: Math.round((weights.get(tract) || 1) * 10000) / 10000,
    raw_population: population[tract]?.indicators?.to_in_001 || 0,
    raw_workers: workers[tract]?.indicators?.to_em_020 || 0,
    raw_businesses: workers[tract]?.indicators?.to_fa_010 || 0,
    population: Math.round((population[tract]?.indicators?.to_in_001 || 0) * (weights.get(tract) || 1) * 10) / 10,
    workers: Math.round((workers[tract]?.indicators?.to_em_020 || 0) * (weights.get(tract) || 1) * 10) / 10,
    businesses: Math.round((workers[tract]?.indicators?.to_fa_010 || 0) * (weights.get(tract) || 1) * 10) / 10,
    population_indicators: population[tract]?.indicators || {},
    worker_indicators: workers[tract]?.indicators || {},
  }));

  const totals = tracts.reduce(
    (acc, tract) => {
      acc.population += tract.population;
      acc.workers += tract.workers;
      acc.businesses += tract.businesses;
      return acc;
    },
    { population: 0, workers: 0, businesses: 0 }
  );
  totals.population = Math.round(totals.population);
  totals.workers = Math.round(totals.workers);
  totals.businesses = Math.round(totals.businesses);

  return {
    tract_count: tracts.length,
    totals,
    tracts,
    selected_codes: Array.from(selectedCodes).sort(),
    population_files: popFiles,
    worker_files: workerFiles,
  };
}

function loadIndustryClassCodes() {
  const json = JSON.parse(cleanBom(readText(path.join(RAW, "sgis", "industry_codes_10th.json"))));
  return (json.result || []).map((row) => ({ class_code: row.class_code, class_nm: row.class_nm }));
}

function buildIndustryWorkerStats(areaKey, sgisCode, tractStats) {
  const filePath = path.join(
    RAW, "sgis", "census_tract_stats", "business_workers_2020",
    `${sgisCode}_2020년_산업분류별(10차_대분류)_종사자수.csv`
  );
  if (!fs.existsSync(filePath)) return;

  const classCodes = loadIndustryClassCodes();
  const weightByTract = new Map(tractStats.tracts.map((row) => [row.tract, row.weight || 1]));
  const totalsByClass = new Map();
  let suppressedRows = 0;

  const rows = parseCsv(readText(filePath)).filter((row) => row.length >= 4);
  for (const row of rows) {
    const tract = row[1];
    const indicatorCode = row[2];
    const rawValue = row[3];
    if (!weightByTract.has(tract)) continue;
    const match = /^cp_bem_(\d+)$/.exec(indicatorCode || "");
    if (!match) continue;
    const classInfo = classCodes[Number(match[1]) - 1];
    if (!classInfo) continue;
    if (String(rawValue).trim().toUpperCase() === "N/A") {
      suppressedRows += 1;
      continue;
    }
    const value = toNum(rawValue) * (weightByTract.get(tract) || 1);
    const entry = totalsByClass.get(classInfo.class_code) || {
      class_code: classInfo.class_code,
      label: classInfo.class_nm,
      workers: 0,
    };
    entry.workers += value;
    totalsByClass.set(classInfo.class_code, entry);
  }

  const byClass = Array.from(totalsByClass.values())
    .map((entry) => ({ ...entry, workers: Math.round(entry.workers * 10) / 10 }))
    .filter((entry) => entry.workers > 0)
    .sort((a, b) => b.workers - a.workers);
  const total = byClass.reduce((sum, entry) => sum + entry.workers, 0);
  byClass.forEach((entry) => {
    entry.ratio = total ? Math.round((entry.workers / total) * 1000) / 10 : 0;
  });

  writeJson(path.join(PROCESSED, "stats", `${areaKey}_industry_workers.json`), {
    area: areaKey,
    total_workers_classified: Math.round(total * 10) / 10,
    by_class: byClass,
    suppressed_rows: suppressedRows,
    note: "10차 대분류 기준, 구역계와 교차하는 SGIS 집계구를 면적 가중 합산. SGIS 비공개(N/A) 처리 행은 0으로 집계되어 과소평가될 수 있음. 10차 중분류 코드명 매핑은 아직 수집되지 않아 제외함.",
  });
}

function buildIsochroneTractStats(areaCodes) {
  const populationFolder = path.join(RAW, "sgis", "census_tract_stats", "population_2020");
  const workersFolder = path.join(RAW, "sgis", "census_tract_stats", "business_workers_2020");
  const population = {};
  const workers = {};
  const populationFiles = [];
  const workerFiles = [];

  for (const areaCode of areaCodes) {
    const popFiles = fs.readdirSync(populationFolder).filter((name) => name.startsWith(areaCode));
    const empFiles = fs.readdirSync(workersFolder).filter((name) => name.startsWith(areaCode));
    populationFiles.push(...popFiles);
    workerFiles.push(...empFiles);

    for (const file of popFiles) {
      const rows = parseCsv(readText(path.join(populationFolder, file))).filter((row) => row.length >= 4);
      for (const row of rows) {
        const tract = row[1];
        const code = row[2];
        const value = toNum(row[3]);
        if (!tract) continue;
        if (!population[tract]) population[tract] = { tract, indicators: {} };
        population[tract].indicators[code || "unknown"] = value;
      }
    }

    for (const file of empFiles) {
      const rows = parseCsv(readText(path.join(workersFolder, file))).filter((row) => row.length >= 4);
      for (const row of rows) {
        const tract = row[1];
        const code = row[2];
        const value = toNum(row[3]);
        if (!tract) continue;
        if (!workers[tract]) workers[tract] = { tract, indicators: {} };
        workers[tract].indicators[code || "unknown"] = value;
      }
    }
  }

  const tracts = Array.from(new Set([...Object.keys(population), ...Object.keys(workers)]))
    .sort()
    .map((tract) => ({
      tract,
      population: population[tract]?.indicators?.to_in_001 || 0,
      workers: workers[tract]?.indicators?.to_em_020 || 0,
      businesses: workers[tract]?.indicators?.to_fa_010 || 0,
      population_indicators: population[tract]?.indicators || {},
      worker_indicators: workers[tract]?.indicators || {},
    }));
  const totals = tracts.reduce(
    (acc, tract) => {
      acc.population += tract.population;
      acc.workers += tract.workers;
      acc.businesses += tract.businesses;
      return acc;
    },
    { population: 0, workers: 0, businesses: 0 }
  );

  return {
    scope: areaCodes,
    tract_count: tracts.length,
    totals,
    tracts,
    population_files: populationFiles.sort(),
    worker_files: workerFiles.sort(),
    note: "Used for subway isochrone accessibility only. Geometry is loaded from full city SHP zips without project-boundary clipping.",
  };
}

function emptyBusinessPointStats(sourceFile) {
  return {
    source: sourceFile || null,
    method: "point_in_boundary",
    count: 0,
    by_large_category: [],
    by_middle_category: [],
    samples: [],
  };
}

function rankedCounts(map, limit = 12) {
  return Array.from(map.entries())
    .map(([label, count]) => ({ label: label || "미분류", count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

async function buildBusinessPointStats(boundariesByKey) {
  const sourceFile = path.join(RAW, "business", "소상공인시장진흥공단_상가(상권)정보_경기_202603.csv");
  const stats = {};
  const entries = Object.entries(boundariesByKey).map(([key, boundary]) => ({
    key,
    boundary,
    bbox: geometryBBox(boundary),
  }));

  for (const { key } of entries) {
    stats[key] = emptyBusinessPointStats("data/raw/business/소상공인시장진흥공단_상가(상권)정보_경기_202603.csv");
    stats[key]._large = new Map();
    stats[key]._middle = new Map();
  }

  if (!fs.existsSync(sourceFile) || !entries.length) {
    return stats;
  }

  const stream = fs.createReadStream(sourceFile, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let header = null;
  let idx = null;

  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = parseCsvLine(line);
    if (!header) {
      header = row.map((value) => value.trim());
      idx = {
        name: header.indexOf("상호명"),
        large: header.indexOf("상권업종대분류명"),
        middle: header.indexOf("상권업종중분류명"),
        small: header.indexOf("상권업종소분류명"),
        sigungu: header.indexOf("시군구명"),
        roadAddress: header.indexOf("도로명주소"),
        parcelAddress: header.indexOf("지번주소"),
        lon: header.indexOf("경도"),
        lat: header.indexOf("위도"),
      };
      continue;
    }

    const lon = Number(row[idx.lon]);
    const lat = Number(row[idx.lat]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const point = [lon, lat];

    for (const entry of entries) {
      const { key, boundary, bbox } = entry;
      if (
        bbox &&
        (lon < bbox.minLon || lon > bbox.maxLon || lat < bbox.minLat || lat > bbox.maxLat)
      ) {
        continue;
      }
      if (!pointInPolygon(point, boundary)) continue;

      const stat = stats[key];
      const large = row[idx.large] || "미분류";
      const middle = row[idx.middle] || "미분류";
      stat.count += 1;
      stat._large.set(large, (stat._large.get(large) || 0) + 1);
      stat._middle.set(middle, (stat._middle.get(middle) || 0) + 1);
      if (stat.samples.length < 20) {
        stat.samples.push({
          name: row[idx.name] || "",
          large_category: large,
          middle_category: middle,
          small_category: row[idx.small] || "",
          sigungu: row[idx.sigungu] || "",
          address: row[idx.roadAddress] || row[idx.parcelAddress] || "",
          lon,
          lat,
        });
      }
    }
  }

  for (const stat of Object.values(stats)) {
    stat.by_large_category = rankedCounts(stat._large);
    stat.by_middle_category = rankedCounts(stat._middle);
    delete stat._large;
    delete stat._middle;
  }

  return stats;
}

function buildAreaSummary(areaKey, config, tractStats) {
  const boundaryPath = path.join(DATA, "processed", "boundaries", config.boundaryFile);
  const boundary = safeJson(boundaryPath).features[0];
  const boundaryPolygon = boundary.geometry;
  const metrics = polygonMetrics(boundary.geometry);

  const vworld = collectAreaFeatures(config.vworldDir, [
    "LP_PA_CBND_BUBUN",
    "LT_C_SPBD",
    "LT_C_UQ111",
    "LT_C_UQ112",
    "LT_C_UQ113",
    "LT_C_UQ114",
  ]);

  const osmRaw = safeJson(path.join(RAW, "osm", `${config.osmFile}.json`));
  const osmWays = Array.isArray(osmRaw.elements)
    ? osmRaw.elements.map(convertOsmWayToFeature).filter(Boolean)
    : [];

  const buildings = clipGeoFeatures(vworld.LT_C_SPBD, boundaryPolygon);
  const parcels = clipGeoFeatures(vworld.LP_PA_CBND_BUBUN, boundaryPolygon);
  const landuse = [
    ...clipGeoFeatures(vworld.LT_C_UQ111, boundaryPolygon).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ111" } })),
    ...clipGeoFeatures(vworld.LT_C_UQ112, boundaryPolygon).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ112" } })),
    ...clipGeoFeatures(vworld.LT_C_UQ113, boundaryPolygon).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ113" } })),
    ...clipGeoFeatures(vworld.LT_C_UQ114, boundaryPolygon).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ114" } })),
  ];
  const roads = clipGeoFeatures(osmWays, boundaryPolygon);
  const roadFeatures = roads.length ? roads : roadParcelsToFeatures(parcels);

  return {
    key: areaKey,
    label: config.label,
    core_station: config.coreStation,
    boundary: {
      geojson: `data/processed/boundaries/${config.boundaryFile}`,
      centroid: metrics.centroid,
      bbox: metrics.bbox,
      area_m2: metrics.area_m2,
      note: boundary.properties?.note || "",
    },
    sgis: {
      shp_zip: `data/raw/sgis/census_tract_shp/${config.shpZip}.zip`,
      tract_stats: `data/processed/sgis/${areaKey}_tract_stats.json`,
      clipped: {
        tract_count: tractStats.tract_count,
        population: tractStats.totals.population,
        workers: tractStats.totals.workers,
        businesses: tractStats.totals.businesses,
        selected_codes: tractStats.selected_codes,
      },
      raw_population: summarizeSgisFolder(path.join(RAW, "sgis", "census_tract_stats", "population_2020"), { prefix: config.sgisCode }),
      raw_business_workers: summarizeSgisFolder(path.join(RAW, "sgis", "census_tract_stats", "business_workers_2020"), { prefix: config.sgisCode }),
    },
    buildings: {
      title: summarizeBuildingCsv(path.join(RAW, "building_registry_manual", config.buildingTitleFile)),
      total_title: summarizeBuildingCsv(path.join(RAW, "building_registry_manual", config.buildingTotalTitleFile)),
    },
    vworld: {
      parcels: {
        count: parcels.length,
        geojson: `data/processed/vworld/${areaKey}_parcels.geojson`,
      },
      buildings: {
        count: buildings.length,
        geojson: `data/processed/vworld/${areaKey}_buildings.geojson`,
      },
      landuse: {
        count: landuse.length,
        geojson: `data/processed/vworld/${areaKey}_landuse.geojson`,
      },
      roads: {
        count: roadFeatures.length,
        geojson: `data/processed/osm/${areaKey}_roads.geojson`,
      },
    },
  };
}

async function build() {
  ensureDir(path.join(PROCESSED, "vworld"));
  ensureDir(path.join(PROCESSED, "osm"));
  ensureDir(path.join(PROCESSED, "sgis"));
  ensureDir(path.join(PROCESSED, "business"));

  const areaConfigs = {
    pangyo_phase1: {
      label: "Pangyo Techno Valley Phase 1",
      coreStation: "Pangyo",
      boundaryFile: "pangyo_phase1_boundary.geojson",
      vworldDir: "pangyo_techno_valley",
      osmFile: "pangyo_roads_overpass",
      shpZip: "bnd_oa_31023_2025_2Q",
      sgisCode: "31023",
      sigunguCd: "41135",
      buildingTitleFile: "building_title_20260617095637.csv",
      buildingTotalTitleFile: "building_total_title_20260617095713.csv",
      area_m2: 660390,
      centroid: [127.0985, 37.4080],
    },
    dongtan_techno_valley: {
      label: "Dongtan Techno Valley",
      coreStation: "Dongtan",
      boundaryFile: "dongtan_techno_valley_boundary.geojson",
      vworldDir: "dongtan_techno_valley",
      osmFile: "dongtan_roads_overpass",
      shpZip: "bnd_oa_31240_2025_2Q",
      sgisCode: "31240",
      sigunguCd: "41597",
      buildingTitleFile: "building_title_20260617095616.csv",
      buildingTotalTitleFile: "building_total_title_20260617095702.csv",
      area_m2: 1556000,
      centroid: [127.0860, 37.2650],
    },
  };

  const areaSummaries = {};
  const boundariesByKey = {};
  const buildingRegistryLookup = loadBuildingRegistryLookup();
  for (const [key, cfg] of Object.entries(areaConfigs)) {
    const boundary = safeJson(path.join(DATA, "processed", "boundaries", cfg.boundaryFile)).features[0];
    boundariesByKey[key] = boundary.geometry;
    const vworld = collectAreaFeatures(cfg.vworldDir, [
      "LP_PA_CBND_BUBUN",
      "LT_C_SPBD",
      "LT_C_UQ111",
      "LT_C_UQ112",
      "LT_C_UQ113",
      "LT_C_UQ114",
    ]);
    const osmRaw = safeJson(path.join(RAW, "osm", `${cfg.osmFile}.json`));
    const osmWays = Array.isArray(osmRaw.elements) ? osmRaw.elements.map(convertOsmWayToFeature).filter(Boolean) : [];
    const tractStats = buildSgisTractStats(cfg.sgisCode, cfg.shpZip, boundary.geometry);
    buildIndustryWorkerStats(key, cfg.sgisCode, tractStats);
    const clippedParcels = clipGeoFeatures(vworld.LP_PA_CBND_BUBUN, boundary.geometry);
    const clippedBuildings = clipGeoFeatures(vworld.LT_C_SPBD, boundary.geometry);
    const enrichedBuildings = enrichBuildingsWithRegistry(clippedBuildings, buildingRegistryLookup);
    const clippedLanduse = [
      ...clipGeoFeatures(vworld.LT_C_UQ111, boundary.geometry).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ111" } })),
      ...clipGeoFeatures(vworld.LT_C_UQ112, boundary.geometry).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ112" } })),
      ...clipGeoFeatures(vworld.LT_C_UQ113, boundary.geometry).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ113" } })),
      ...clipGeoFeatures(vworld.LT_C_UQ114, boundary.geometry).map((f) => ({ ...f, properties: { ...f.properties, zone_kind: "UQ114" } })),
    ];
    const clippedRoads = clipGeoFeatures(osmWays, boundary.geometry);
    const roadFeatures = clippedRoads.length ? clippedRoads : roadParcelsToFeatures(clippedParcels);

    writeJson(path.join(PROCESSED, "vworld", `${key}_parcels.geojson`), {
      type: "FeatureCollection",
      name: `${key}_parcels`,
      features: clippedParcels,
    });
    writeJson(path.join(PROCESSED, "vworld", `${key}_buildings.geojson`), {
      type: "FeatureCollection",
      name: `${key}_buildings`,
      features: clippedBuildings,
    });
    writeJson(path.join(PROCESSED, "vworld", `${key}_buildings_enriched.geojson`), {
      type: "FeatureCollection",
      name: `${key}_buildings_enriched`,
      properties: {
        registry_matched: enrichedBuildings.matched,
        registry_total: enrichedBuildings.features.length,
      },
      features: enrichedBuildings.features,
    });
    buildBuildingStats(key, enrichedBuildings.features);
    buildCompletionTimeline(key, enrichedBuildings.features);
    writeJson(path.join(PROCESSED, "vworld", `${key}_landuse.geojson`), {
      type: "FeatureCollection",
      name: `${key}_landuse`,
      features: clippedLanduse,
    });
    writeJson(path.join(PROCESSED, "osm", `${key}_roads.geojson`), {
      type: "FeatureCollection",
      name: `${key}_roads`,
      features: roadFeatures,
    });
    writeJson(path.join(PROCESSED, "sgis", `${key}_tract_stats.json`), tractStats);
    areaSummaries[key] = buildAreaSummary(key, cfg, tractStats);
  }

  const businessPointStats = await buildBusinessPointStats(boundariesByKey);
  for (const [key, stats] of Object.entries(businessPointStats)) {
    writeJson(path.join(PROCESSED, "business", `${key}_stores.json`), stats);
    if (areaSummaries[key]) {
      areaSummaries[key].business_points = {
        file: `data/processed/business/${key}_stores.json`,
        source: stats.source,
        method: stats.method,
        count: stats.count,
        by_large_category: stats.by_large_category,
        by_middle_category: stats.by_middle_category,
      };
    }
  }

  writeJson(
    path.join(PROCESSED, "vworld", "pangyo_buildings_enriched.geojson"),
    safeJson(path.join(PROCESSED, "vworld", "pangyo_phase1_buildings_enriched.geojson"))
  );
  writeJson(
    path.join(PROCESSED, "vworld", "dongtan_buildings_enriched.geojson"),
    safeJson(path.join(PROCESSED, "vworld", "dongtan_techno_valley_buildings_enriched.geojson"))
  );
  const isochroneTractStats = buildIsochroneTractStats(["31023", "31240"]);
  writeJson(path.join(PROCESSED, "sgis", "isochrone_tract_stats.json"), isochroneTractStats);

  const appData = {
    generated_at: new Date().toISOString(),
    areas: areaSummaries,
    isochrone_sgis: {
      tract_stats: "data/processed/sgis/isochrone_tract_stats.json",
      shp_zips: [
        "data/raw/sgis/census_tract_shp/bnd_oa_31023_2025_2Q.zip",
        "data/raw/sgis/census_tract_shp/bnd_oa_31240_2025_2Q.zip",
      ],
      scope: ["31023", "31240"],
      note: "Current local SGIS scope contains Seongnam-si and Hwaseong-si only; Seoul and full Gyeonggi tracts are not included.",
    },
    sources: {
      boundaries: "data/processed/boundaries/*.geojson",
      sgis_shp: "data/raw/sgis/census_tract_shp/*.zip",
      sgis_stats: "data/raw/sgis/census_tract_stats/*/*.csv",
      vworld: "data/raw/vworld/*/*.json",
      osm: "data/raw/osm/*.json",
      business_points: "data/raw/business/소상공인시장진흥공단_상가(상권)정보_경기_202603.csv",
      buildings: "data/raw/building_registry_manual/*.csv",
      subway: "data/raw/subway/subway_network.zip",
    },
    notes: {
      dongtan_evidence: "Required later for report writing. This system build only prepares the analysis dataset and map UI.",
    },
  };

  writeJson(path.join(PROCESSED, "app_data.json"), appData);
  console.log("Wrote data/processed/app_data.json");
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
