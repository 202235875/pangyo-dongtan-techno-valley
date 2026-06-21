param(
  [string]$EnvPath = ".env",
  [string]$OutDir = "data/raw/sgis/census_tract_boundaries"
)

$ErrorActionPreference = "Stop"

function Read-DotEnv {
  param([string]$Path)
  $map = @{}
  Get-Content -Path $Path | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $map[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $map
}

function Get-SgisToken {
  param([hashtable]$Env)
  $uri = "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json?consumer_key=$([uri]::EscapeDataString($Env.SGIS_CONSUMER_KEY))&consumer_secret=$([uri]::EscapeDataString($Env.SGIS_CONSUMER_SECRET))"
  $auth = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 120
  if ($auth.errCd -ne 0) {
    throw "SGIS authentication failed: $($auth.errMsg)"
  }
  return $auth.result.accessToken
}

function Convert-Wgs84ToUtmk {
  param([string]$Token, [double]$Lon, [double]$Lat)
  $uri = "https://sgisapi.kostat.go.kr/OpenAPI3/transformation/transcoord.json?accessToken=$Token&src=EPSG:4326&dst=EPSG:5179&posX=$Lon&posY=$Lat"
  $result = Invoke-RestMethod -Method Get -Uri $uri -TimeoutSec 120
  if ($result.errCd -ne 0) {
    throw "SGIS coordinate transform failed: $($result.errMsg)"
  }
  return $result.result
}

function Download-UserAreaStatsArea {
  param([string]$Token, [string]$Name, [double[]]$Bbox, [string]$OutDir)

  $south = $Bbox[0]
  $west = $Bbox[1]
  $north = $Bbox[2]
  $east = $Bbox[3]

  $c1 = Convert-Wgs84ToUtmk -Token $Token -Lon $west -Lat $south
  $c2 = Convert-Wgs84ToUtmk -Token $Token -Lon $east -Lat $north

  $minx = [Math]::Min([double]$c1.posX, [double]$c2.posX)
  $maxx = [Math]::Max([double]$c1.posX, [double]$c2.posX)
  $miny = [Math]::Min([double]$c1.posY, [double]$c2.posY)
  $maxy = [Math]::Max([double]$c1.posY, [double]$c2.posY)

  $uri = "https://sgisapi.kostat.go.kr/OpenAPI3/boundary/userarea.geojson?accessToken=$Token&minx=$minx&miny=$miny&maxx=$maxx&maxy=$maxy&cd=4"
  $path = Join-Path $OutDir "$Name`_census_tract_boundaries_epsg5179.geojson"
  Invoke-WebRequest -Method Get -Uri $uri -OutFile $path -TimeoutSec 120

  $raw = Get-Content -Raw -Path $path | ConvertFrom-Json
  return [pscustomobject]@{
    area = $Name
    path = $path
    errCd = $raw.errCd
    errMsg = $raw.errMsg
    feature_count = @($raw.features).Count
    crs = "EPSG:5179"
  }
}

function Get-BboxFromGeoJson {
  param([string]$Path)
  $text = Get-Content -Raw -Path $Path
  $matches = [regex]::Matches($text, '\[\s*([0-9]+\.[0-9]+)\s*,\s*([0-9]+\.[0-9]+)\s*\]')
  $lons = @()
  $lats = @()
  foreach ($m in $matches) {
    $lons += [double]$m.Groups[1].Value
    $lats += [double]$m.Groups[2].Value
  }
  return @(
    ($lats | Measure-Object -Minimum).Minimum,
    ($lons | Measure-Object -Minimum).Minimum,
    ($lats | Measure-Object -Maximum).Maximum,
    ($lons | Measure-Object -Maximum).Maximum
  )
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$envValues = Read-DotEnv -Path $EnvPath
$token = Get-SgisToken -Env $envValues

$summary = @()
$summary += Download-UserAreaStatsArea -Token $token -Name "pangyo_phase1" -Bbox (Get-BboxFromGeoJson -Path "data/processed/boundaries/pangyo_phase1_boundary.geojson") -OutDir $OutDir
$summary += Download-UserAreaStatsArea -Token $token -Name "dongtan_techno_valley" -Bbox (Get-BboxFromGeoJson -Path "data/processed/boundaries/dongtan_techno_valley_boundary.geojson") -OutDir $OutDir

$metadata = @{
  collected_at = (Get-Date).ToString("s")
  source = "SGIS OpenAPI3 boundary/userarea.geojson"
  note = "Census tract boundaries only. Coordinates are EPSG:5179 UTM-K. Population/worker CSV still needs SGIS statistical data download."
  summary = $summary
}

$metadata | ConvertTo-Json -Depth 20 | Set-Content -Path (Join-Path $OutDir "collection_metadata.json") -Encoding UTF8
$summary
