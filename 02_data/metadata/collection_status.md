# Collection Status

Updated: 2026-06-17

## Usable Raw Data Collected

### OpenStreetMap road network

- `data/raw/osm/pangyo_roads_overpass.json`
- `data/raw/osm/dongtan_roads_overpass.json`

### Subway network

- `data/raw/subway/subway_network.zip`

### SGIS

- `data/raw/sgis/industry_codes_10th.json`
- `data/raw/sgis/census_tract_shp/bnd_oa_31023_2025_2Q/`
- `data/raw/sgis/census_tract_shp/bnd_oa_31240_2025_2Q/`

Administrative-dong SGIS JSON files and earlier API-derived boundary files were removed because they were not suitable for final census-tract analysis.

`bnd_oa_31023_2025_2Q` is an SGIS output-area/census-tract SHP with 926 records, `BASE_DATE`, `ADM_CD`, and `TOT_OA_CD` fields. It is a valid census-tract boundary file for code `31023`, base date `20250630`.

`bnd_oa_31240_2025_2Q` is an SGIS output-area/census-tract SHP with 2,057 records, `BASE_DATE`, `ADM_CD`, and `TOT_OA_CD` fields. It is a valid census-tract boundary file for code `31240`, base date `20250630`.

### SGIS Census Tract Business/Worker CSV

- `data/raw/sgis/census_tract_stats/business_workers_2020/`

Included files:

- `31023_2020...사업체수.csv`
- `31023_2020...종사자수.csv`
- `31240_2020...사업체수.csv`
- `31240_2020...종사자수.csv`

The files are headerless CSVs in this structure:

- `year,tot_oa_cd,indicator_code,value`

Record checks:

- `31023` total worker rows: 926
- `31240` total worker rows: 2,057

### SGIS Census Tract Population CSV

- `data/raw/sgis/census_tract_stats/population_2020/`

Included files:

- `31023_2020...인구총괄(총인구).csv`
- `31023_2020...성연령별인구.csv`
- `31240_2020...인구총괄(총인구).csv`
- `31240_2020...성연령별인구.csv`

The files are headerless CSVs in this structure:

- `year,tot_oa_cd,indicator_code,value`

Record checks:

- `31023` population summary rows: 2,778
- `31240` population summary rows: 6,171
- Other one-row-per-tract summary indicators have 926 rows for `31023` and 2,057 rows for `31240`.

### VWorld

Raw tiled API responses are stored under:

- `data/raw/vworld/pangyo_techno_valley/`
- `data/raw/vworld/dongtan_techno_valley/`

Collected layers:

- `LP_PA_CBND_BUBUN`: parcel boundary
- `LT_C_SPBD`: building footprint/address layer
- `LT_C_UQ111`: urban area zoning
- `LT_C_UQ112`: management area zoning
- `LT_C_UQ113`: agricultural/forest area zoning
- `LT_C_UQ114`: natural environment conservation area zoning

See `data/raw/vworld/collection_metadata.json` for request counts and record counts.

## Attempted But Not Usable Yet

### Building registry / BuildingHub API

Attempted endpoint:

- `data.go.kr BldRgstService_v2 getBrTitleInfo`

Attempted query method:

- Extracted PNU values from VWorld parcel polygons.
- Queried 1,000 sampled parcels for Pangyo and 1,000 sampled parcels for Dongtan.

Result:

- The API returned HTTP 500 for all sampled parcel requests.
- The error-log files were removed after manual building registry CSV files were collected.

### Manually Downloaded Building Registry

- `data/raw/building_registry_manual/building_title_20260617095616.csv`
- `data/raw/building_registry_manual/building_title_20260617095637.csv`
- `data/raw/building_registry_manual/building_total_title_20260617095702.csv`
- `data/raw/building_registry_manual/building_total_title_20260617095713.csv`

These are building registry title-section CSV files. They include fields needed for building-use analysis, including parcel codes, main use, site area, building area, floor area, building coverage ratio, floor area ratio, floors, and approval date.

Current coverage check:

- `sigunguCd = 41135`: 13,332 rows
- `sigunguCd = 41597`: 10,640 rows
- `sigunguCd = 41135` total-title rows: 711
- `sigunguCd = 41597` total-title rows: 408

These cover both Seongnam-si Bundang-gu and the Dongtan/Hwaseong side for both title and total-title sections.

## Still Needed Manually

- Evidence source for Dongtan as the lower-performing comparison case.

## Boundary Files

- `data/processed/boundaries/pangyo_phase1_boundary.geojson`
- `data/processed/boundaries/dongtan_techno_valley_boundary.geojson`

These came from `C:\Users\wjaah\Desktop\projectfiles.zip`. They are usable for system construction, but their metadata marks them as approximate rectangular boundaries. Replace them if official SHP/GeoJSON boundaries are later acquired.

## Removed Deprecated Data

- `data/raw/vworld/dongtan_business_area/`
- `data/raw/building_registry/`
- `data/raw/sgis/census_tract_boundaries/`
- `data/raw/sgis/gyeonggi_population_2020_low2.json`
- `data/raw/sgis/gyeonggi_household_2020_low2.json`
- `data/raw/sgis/gyeonggi_company_2019_low2.json`
- `subway_network (1).zip`

These were removed because they were wrong-range data, API error logs, administrative-dong data, API-derived coarse boundaries, or duplicate files.
