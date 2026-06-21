param(
  [string]$OutDir = "02_data/raw/osm",
  [string]$Endpoint = "https://overpass.kumi.systems/api/interpreter"
)

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$queries = @{
  "pangyo_roads_overpass.json" = '[out:json][timeout:180];(way["highway"](37.386,127.087,37.413,127.125););out body geom;'
  "dongtan_roads_overpass.json" = '[out:json][timeout:180];(way["highway"](37.194,127.071,37.236,127.125););out body geom;'
}

foreach ($name in $queries.Keys) {
  $query = $queries[$name]
  $url = $Endpoint + "?data=" + [uri]::EscapeDataString($query)
  Invoke-WebRequest -Uri $url -OutFile (Join-Path $OutDir $name)
}
