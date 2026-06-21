# Required Data Collection

This folder tracks the data needed for the final project comparing Pangyo Techno Valley and Dongtan.

## Currently Collected

- `data/raw/osm/pangyo_roads_overpass.json`
  - Source: OpenStreetMap Overpass API
  - Contents: highway ways inside the initial Pangyo bbox
  - OSM base timestamp: `2026-06-08T06:09:44Z`
- `data/raw/osm/dongtan_roads_overpass.json`
  - Source: OpenStreetMap Overpass API
  - Contents: highway ways inside the Dongtan Techno Valley boundary bbox (refreshed to `37.194,127.071,37.236,127.125`, matching `dongtan_techno_valley_boundary.geojson`; the original `37.260,127.073,37.270,127.099` bbox didn't overlap the final boundary and returned 0 elements)
  - OSM base timestamp: `2026-06-21T06:37:44Z`
- `subway_network (1).zip`
  - Source: LMS-provided project data
  - Contents: Seoul metropolitan subway network nodes and links
  - Copy this into `data/raw/subway/subway_network.zip` for preprocessing scripts.

## Still Required

- SGIS aggregate-unit population and worker/business data for Pangyo and Dongtan
- VWorld land-use zoning data for Pangyo and Dongtan
- Building registry / BuildingHub data for Pangyo and Dongtan
- Official analysis boundaries for both areas
- Evidence that Dongtan is a low-performing or less successful comparison case, such as vacancy, unsold-unit, audit, planning report, research report, or reliable news sources

## Notes

- The current OSM files are raw API responses. Some Korean text fields may need UTF-8 validation during preprocessing.
- Final analysis should use the same reference year or month across both regions whenever possible.
