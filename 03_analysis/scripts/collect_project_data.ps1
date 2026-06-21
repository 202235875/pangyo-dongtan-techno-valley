param(
  [int]$PageSize = 1000,
  [int]$MaxBuildingParcelsPerArea = 3000,
  [string]$EnvPath = ".env",
  [switch]$SkipSgis,
  [switch]$SkipVWorld,
  [switch]$SkipBuildingRegistry
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

function New-Dir {
  param([string]$Path)
  New-Item -ItemType Directory -Force -Path $Path | Out-Null
}

function Save-Json {
  param($Object, [string]$Path, [int]$Depth = 100)
  $Object | ConvertTo-Json -Depth $Depth | Set-Content -Path $Path -Encoding UTF8
}

function Invoke-Json {
  param([string]$Uri)
  Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec 120
}

function Invoke-WebFile {
  param([string]$Uri, [string]$Path)
  Invoke-WebRequest -Method Get -Uri $Uri -OutFile $Path -TimeoutSec 120
}

function Get-SgisToken {
  param([hashtable]$Env)
  $uri = "https://sgisapi.kostat.go.kr/OpenAPI3/auth/authentication.json?consumer_key=$([uri]::EscapeDataString($Env.SGIS_CONSUMER_KEY))&consumer_secret=$([uri]::EscapeDataString($Env.SGIS_CONSUMER_SECRET))"
  $auth = Invoke-Json -Uri $uri
  if ($auth.errCd -ne 0) {
    throw "SGIS authentication failed: $($auth.errMsg)"
  }
  return $auth.result.accessToken
}

function Download-Sgis {
  param([hashtable]$Env)

  New-Dir "02_data/raw/sgis"
  $token = Get-SgisToken -Env $Env

  $calls = @(
    @{ name = "gyeonggi_population_2020_low2"; url = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/population.json?accessToken=$token&year=2020&adm_cd=31&low_search=2" },
    @{ name = "gyeonggi_household_2020_low2"; url = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/household.json?accessToken=$token&year=2020&adm_cd=31&low_search=2" },
    @{ name = "gyeonggi_company_2019_low2"; url = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/company.json?accessToken=$token&year=2019&adm_cd=31&low_search=2" },
    @{ name = "industry_codes_10th"; url = "https://sgisapi.kostat.go.kr/OpenAPI3/stats/industrycode.json?accessToken=$token&class_deg=10" }
  )

  foreach ($call in $calls) {
    $data = Invoke-Json -Uri $call.url
    Save-Json -Object $data -Path "02_data/raw/sgis/$($call.name).json"
  }

  Save-Json -Object @{
    collected_at = (Get-Date).ToString("s")
    source = "SGIS OpenAPI3"
    note = "Keys are read from .env and are not stored in this metadata."
    files = $calls.name
  } -Path "02_data/raw/sgis/collection_metadata.json"
}

function Download-VWorldLayer {
  param(
    [string]$Layer,
    [string]$AreaKey,
    [double[]]$Bbox,
    [string]$Key,
    [int]$PageSize
  )

  $outDir = "02_data/raw/vworld/$AreaKey/$Layer"
  New-Dir $outDir

  $minLat = $Bbox[0]
  $minLon = $Bbox[1]
  $maxLat = $Bbox[2]
  $maxLon = $Bbox[3]
  $latStep = 0.01
  $lonStep = 0.01
  $requestCount = 0
  $okCount = 0
  $recordCount = 0

  for ($south = $minLat; $south -lt $maxLat; $south += $latStep) {
    $north = [Math]::Min($south + $latStep, $maxLat)
    for ($west = $minLon; $west -lt $maxLon; $west += $lonStep) {
      $east = [Math]::Min($west + $lonStep, $maxLon)
      $tileRow = [int][Math]::Round(($south - $minLat) / $latStep)
      $tileCol = [int][Math]::Round(($west - $minLon) / $lonStep)
      $page = 1

      while ($true) {
        $geomFilter = "BOX($west,$south,$east,$north)"
        $query = @{
          service = "data"
          request = "GetFeature"
          data = $Layer
          key = $Key
          domain = "localhost"
          format = "json"
          size = "$PageSize"
          page = "$page"
          geomFilter = $geomFilter
          geometry = "true"
          attribute = "true"
          crs = "EPSG:4326"
        }

        $pairs = $query.GetEnumerator() | ForEach-Object { "$([uri]::EscapeDataString($_.Key))=$([uri]::EscapeDataString($_.Value))" }
        $uri = "https://api.vworld.kr/req/data?" + ($pairs -join "&")
        $outPath = Join-Path $outDir ("tile_{0:D3}_{1:D3}_page_{2:D4}.json" -f $tileRow, $tileCol, $page)
        if (!(Test-Path $outPath)) {
          Invoke-WebFile -Uri $uri -Path $outPath
        }
        $requestCount += 1

        $rawText = Get-Content -Raw -Path $outPath
        if ($rawText -notmatch '"status"\s*:\s*"OK"') {
          break
        }

        $okCount += 1
        $current = 0
        if ($rawText -match '"current"\s*:\s*"(\d+)"') {
          $current = [int]$matches[1]
          $recordCount += $current
        }
        if ($current -lt $PageSize) {
          break
        }
        $page += 1
      }
    }
  }

  return [pscustomobject]@{
    requests = $requestCount
    ok_pages = $okCount
    records_seen = $recordCount
  }
}

function Download-VWorld {
  param([hashtable]$Env, [object]$Areas, [int]$PageSize)

  New-Dir "02_data/raw/vworld"
  $layers = @(
    "LP_PA_CBND_BUBUN",
    "LT_C_SPBD",
    "LT_C_UQ111",
    "LT_C_UQ112",
    "LT_C_UQ113",
    "LT_C_UQ114"
  )

  $summary = @()
  foreach ($areaName in $Areas.PSObject.Properties.Name) {
    $area = $Areas.$areaName
    foreach ($layer in $layers) {
      $stats = Download-VWorldLayer -Layer $layer -AreaKey $areaName -Bbox $area.bbox_south_west_north_east -Key $Env.VWORLD_KEY -PageSize $PageSize
      $summary += [pscustomobject]@{ area = $areaName; layer = $layer; requests = $stats.requests; ok_pages = $stats.ok_pages; records_seen = $stats.records_seen }
    }
  }

  Save-Json -Object @{
    collected_at = (Get-Date).ToString("s")
    source = "VWorld 2D Data API"
    layers = $layers
    summary = $summary
  } -Path "02_data/raw/vworld/collection_metadata.json"
}

function Get-PnuFromFeature {
  param($Feature)
  foreach ($name in @("pnu", "PNU", "A0", "a0")) {
    if ($Feature.properties.PSObject.Properties.Name -contains $name) {
      $value = [string]$Feature.properties.$name
      if ($value -match '^\d{19}$') {
        return $value
      }
    }
  }
  return $null
}

function Download-BuildingRegistry {
  param([hashtable]$Env, [object]$Areas, [int]$MaxParcels)

  New-Dir "02_data/raw/building_registry"
  $summary = @()

  foreach ($areaName in $Areas.PSObject.Properties.Name) {
    $parcelDir = "02_data/raw/vworld/$areaName/LP_PA_CBND_BUBUN"
    if (!(Test-Path $parcelDir)) {
      $summary += [pscustomobject]@{ area = $areaName; status = "skipped"; reason = "missing VWorld parcel directory"; parcel_count = 0; saved_count = 0 }
      continue
    }

    $areaOut = "02_data/raw/building_registry/$areaName"
    New-Dir $areaOut
    $pnus = @(Get-ChildItem -Path $parcelDir -Filter *.json | ForEach-Object {
      $rawText = Get-Content -Raw -Path $_.FullName
      [regex]::Matches($rawText, '"pnu"\s*:\s*"(\d{19})"') | ForEach-Object { $_.Groups[1].Value }
      [regex]::Matches($rawText, '"PNU"\s*:\s*"(\d{19})"') | ForEach-Object { $_.Groups[1].Value }
    } | Sort-Object -Unique)
    if ($pnus.Count -gt $MaxParcels) {
      $pnus = $pnus[0..($MaxParcels - 1)]
    }

    $saved = 0
    foreach ($pnu in $pnus) {
      $sigunguCd = $pnu.Substring(0, 5)
      $bjdongCd = $pnu.Substring(5, 5)
      $platGbCd = $pnu.Substring(10, 1)
      $bun = $pnu.Substring(11, 4)
      $ji = $pnu.Substring(15, 4)
      $outPath = Join-Path $areaOut "$pnu.json"
      if (Test-Path $outPath) {
        $saved += 1
        continue
      }

      $query = @{
        serviceKey = $Env.DATA_GO_KR_SERVICE_KEY
        sigunguCd = $sigunguCd
        bjdongCd = $bjdongCd
        platGbCd = $platGbCd
        bun = $bun
        ji = $ji
        numOfRows = "100"
        pageNo = "1"
        _type = "json"
      }
      $pairs = $query.GetEnumerator() | ForEach-Object { "$([uri]::EscapeDataString($_.Key))=$([uri]::EscapeDataString($_.Value))" }
      $uri = "https://apis.data.go.kr/1613000/BldRgstService_v2/getBrTitleInfo?" + ($pairs -join "&")

      try {
        Invoke-WebFile -Uri $uri -Path $outPath
        $saved += 1
      } catch {
        [pscustomobject]@{ pnu = $pnu; error = $_.Exception.Message } | ConvertTo-Json | Set-Content -Path $outPath -Encoding UTF8
      }
      Start-Sleep -Milliseconds 120
    }

    $status = if ($saved -gt 0) { "collected" } else { "failed" }
    $summary += [pscustomobject]@{ area = $areaName; status = $status; parcel_count = $pnus.Count; saved_count = $saved }
  }

  Save-Json -Object @{
    collected_at = (Get-Date).ToString("s")
    source = "data.go.kr BldRgstService_v2 getBrTitleInfo"
    note = "Queried by PNU values derived from VWorld parcel polygons."
    summary = $summary
  } -Path "02_data/raw/building_registry/collection_metadata.json"
}

$envValues = Read-DotEnv -Path $EnvPath
foreach ($required in @("SGIS_CONSUMER_KEY", "SGIS_CONSUMER_SECRET", "VWORLD_KEY", "DATA_GO_KR_SERVICE_KEY")) {
  if (!$envValues.ContainsKey($required) -or [string]::IsNullOrWhiteSpace($envValues[$required])) {
    throw "Missing required key in .env: $required"
  }
}

$areas = (Get-Content -Raw -Path "02_data/metadata/analysis_areas.json" | ConvertFrom-Json).areas

if (!$SkipSgis) {
  Download-Sgis -Env $envValues
}
if (!$SkipVWorld) {
  Download-VWorld -Env $envValues -Areas $areas -PageSize $PageSize
}
if (!$SkipBuildingRegistry) {
  Download-BuildingRegistry -Env $envValues -Areas $areas -MaxParcels $MaxBuildingParcelsPerArea
}

Save-Json -Object @{
  collected_at = (Get-Date).ToString("s")
  note = "Project raw data collection completed. API keys were read from .env and not written to output files."
} -Path "02_data/raw/collection_metadata.json"

Write-Host "Collection complete. See 02_data/raw."
