# 과제: 판교테크노밸리 vs 동탄테크노밸리 비교분석 시스템 구축

## 시스템 목적
수도권 업무지구 성공/실패 원인을 공공데이터로 비교분석하는 웹 시스템.
판교테크노밸리(성공)와 동탄테크노밸리(실패)를 토지이용·교통망·인구사회 3개 영역에서
정량 비교하고, GitHub Pages로 배포되는 정적 웹사이트로 구현한다.

## 기술 조건
- GitHub Pages 배포 (정적 사이트, 별도 서버/DB 없음)
- 데이터는 전처리 후 GeoJSON/JSON 정적 파일로 포함
- 베이스맵: Leaflet.js + VWorld WMTS 또는 OSM
- 언어: HTML/CSS/JS (또는 React)

## 데이터 파일 경로 (전처리 입력)
### 경계
- data/processed/boundaries/pangyo_phase1_boundary.geojson
- data/processed/boundaries/dongtan_techno_valley_boundary.geojson

### SGIS 집계구 경계 SHP (EPSG:5179 → WGS84 변환 필요)
- data/raw/sgis/census_tract_shp/bnd_oa_31023_2025_2Q/bnd_oa_31023_2025_2Q.shp  (성남시 분당구)
- data/raw/sgis/census_tract_shp/bnd_oa_31240_2025_2Q/bnd_oa_31240_2025_2Q.shp  (화성시)

### SGIS 집계구 통계 CSV
- data/raw/sgis/census_tract_stats/population_2020/31023_2020년_인구총괄(총인구).csv
- data/raw/sgis/census_tract_stats/population_2020/31240_2020년_인구총괄(총인구).csv
- data/raw/sgis/census_tract_stats/business_workers_2020/31023_2020년_산업분류별(10차_대분류)_총괄종사자수.csv
- data/raw/sgis/census_tract_stats/business_workers_2020/31240_2020년_산업분류별(10차_대분류)_총괄종사자수.csv

### VWorld (판교)
- data/raw/vworld/pangyo_techno_valley/LP_PA_CBND_BUBUN/  (필지)
- data/raw/vworld/pangyo_techno_valley/LT_C_SPBD/          (건물)
- data/raw/vworld/pangyo_techno_valley/LT_C_UQ111/         (용도지역)

### VWorld (동탄)
- data/raw/vworld/dongtan_techno_valley/LP_PA_CBND_BUBUN/
- data/raw/vworld/dongtan_techno_valley/LT_C_SPBD/
- data/raw/vworld/dongtan_techno_valley/LT_C_UQ111/

### OSM 도로망
- data/raw/osm/pangyo_roads_overpass.json
- data/raw/osm/dongtan_roads_overpass.json

### 지하철 네트워크
- data/raw/subway/subway_network.zip  (network/nodes.tsv, network/links.tsv)

## 전처리 스크립트 요구사항 (Python)
scripts/preprocess/ 폴더에 작성할 것

1. convert_sgis_shp_to_geojson.py
   - SGIS SHP(EPSG:5179) → WGS84 GeoJSON 변환
   - 판교 경계 안에 포함되는 집계구 추출 (공간 교차)
   - 동탄 경계 안에 포함되는 집계구 추출
   - 집계구 경계에 인구(총인구) + 종사자수 CSV join
   - 출력: data/processed/sgis/pangyo_census_tracts.geojson
   - 출력: data/processed/sgis/dongtan_census_tracts.geojson

2. convert_vworld_to_geojson.py
   - VWorld JSON 파일들을 GeoJSON으로 변환 (좌표계 확인 후 WGS84로 변환)
   - 판교/동탄 경계 안쪽만 clip
   - 출력: data/processed/vworld/pangyo_parcels.geojson (필지)
   - 출력: data/processed/vworld/pangyo_buildings.geojson (건물)
   - 출력: data/processed/vworld/pangyo_landuse.geojson (용도지역)
   - 동탄도 동일하게

3. compute_isochrone.py
   - subway_network.zip 압축 해제 후 nodes.tsv, links.tsv 로드
   - 판교역 (신분당선/경강선) 을 출발 노드로 설정
   - 다익스트라로 전체 역까지 최단시간 계산
   - 30분/60분 이내 도달 가능한 역 목록 추출
   - 각 역 좌표로 등시간권 폴리곤 생성 (convex hull 또는 alpha shape)
   - 등시간권 × 집계구 공간 결합 → 도달가능 인구/종사자 합산
   - 출력: data/processed/isochrone/pangyo_isochrone_30min.geojson
   - 출력: data/processed/isochrone/pangyo_isochrone_60min.geojson
   - 출력: data/processed/isochrone/pangyo_isochrone_stats.json
     ({"30min": {"population": N, "workers": N}, "60min": {...}})
   - 동탄은 "핵심역 없음"으로 처리:
     - 가장 가까운 역(분당선 청명역, 약 2.0km) 기준으로 분석은 수행하되
     - stats JSON에 "note": "동탄테크노밸리와 최근접역(청명역) 거리 2.0km — 역세권 외 위치" 명시

4. compute_statistics.py
   - 토지이용 통계: 용도지역별 면적 비율, 건물 주용도 구성비, 평균 용적률
   - 도로망 통계: 도로 밀도(km/km²)
   - 인구사회 통계: 구역 내 총인구, 총종사자, 직주비
   - 출력: data/processed/stats/pangyo_stats.json
   - 출력: data/processed/stats/dongtan_stats.json

## 시스템 필수 기능 (§4 기준)

### 1. 지도 기반 시각화
- 두 구역 경계를 지도에 표시
- 필지/건물 단위 주용도 컬러맵
- 판교/동탄 전환 버튼 또는 side-by-side 뷰

### 2. 등시간권 레이어
- 판교역 기준 30분/60분 등시간권 폴리곤 표시
- 슬라이더 또는 버튼으로 30분/60분 전환
- 각 등시간권의 도달가능 인구/종사자 수치 표시
- 동탄은 "최근접역(청명역) 기준" + 접근성 부재 설명 표시

### 3. 통계 패널
- 토지이용 비교 (파이차트 또는 막대차트)
- 인구/종사자 비교 (막대차트)
- 누적 접근성 곡선 (0~60분 도달가능 인구/종사자)
- 두 지역 수치가 한 화면에서 비교 가능하게

### 4. 상호작용
- 필지/건물 클릭 시 속성 팝업 (주용도, 연면적, 용적률 등)

## 출력 구조

## README 요구사항
- 데이터 출처/기준월 명시
- 전처리 실행 순서 명시
- GitHub Pages URL 명시

## 주의사항
- dongtan_business_area/ 폴더 데이터는 사용하지 말 것 (잘못된 범위)
- building_registry/ 폴더는 오류 로그라 사용하지 말 것
- 모든 좌표는 WGS84(EPSG:4326)로 통일
- 보고서 수치와 시스템 수치가 일치해야 함

