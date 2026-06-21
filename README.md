# 판교-동탄 테크노밸리 비교분석 시스템

제1 판교테크노밸리와 동탄 테크노밸리를 지도와 핵심 지표로 비교하는 정적 웹 시스템입니다.

- 배포 URL: https://202235875.github.io/pangyo-dongtan-techno-valley/
- 실행 방식: GitHub Pages 정적 배포
- 기술 스택: HTML, CSS, Vanilla JavaScript, Leaflet, Turf.js, JSZip, shpjs

## 코드 구조

```text
index.html
```

GitHub Pages의 진입점입니다. 외부 라이브러리와 `04_system/web` 아래의 앱 파일을 불러옵니다.

```text
04_system/web/
  app.js
  styles.css
```

실제 웹 시스템 코드입니다.

- `app.js`: 지도 생성, 레이어 전환, 통계 계산, 핵심 비교 카드 렌더링
- `styles.css`: 전체 UI, 지도 패널, 비교 카드, 범례, 등시간권 컨트롤 스타일

```text
03_analysis/scripts/
```

데이터 수집과 전처리용 스크립트입니다.

- `build_app_data.js`: 원천 데이터를 읽어 웹에서 쓰는 `02_data/processed/**` 파일을 생성
- `collect_project_data.ps1`: SGIS, VWorld 등 API 수집 보조
- `download_osm_overpass.ps1`: OSM 도로망 수집
- `download_sgis_census_tract_boundaries.ps1`: SGIS 집계구 경계 수집
- `convert_epsg5179_to_wgs84.js`: EPSG:5179 좌표를 WGS84로 변환
- `serve.js`: 로컬 정적 서버

## 데이터 구조

```text
02_data/raw/
```

원천 데이터입니다. 일부 대용량 원천 데이터는 `.gitignore`로 제외했습니다.

```text
02_data/processed/
```

웹 시스템이 직접 읽는 전처리 결과입니다. 배포 화면은 이 폴더의 JSON/GeoJSON을 `fetch`로 불러옵니다.

주요 파일:

- `02_data/processed/app_data.json`: 웹 앱의 메인 데이터 진입점
- `02_data/processed/boundaries/*.geojson`: 판교/동탄 분석 경계
- `02_data/processed/vworld/*.geojson`: 필지, 건물, 용도지역
- `02_data/processed/osm/*.geojson`: OSM 도로망
- `02_data/processed/sgis/*.json`: 집계구 기반 인구/종사자 통계
- `02_data/processed/stats/*.json`: 건물, 준공연도, 산업 종사자 지표
- `02_data/processed/business/*.json`: 상가업소 기반 사업체 통계

```text
02_data/metadata/
```

수집 현황과 데이터 인벤토리 기록입니다.

## 사용 데이터

| 분야 | 사용 데이터 | 경로 |
| --- | --- | --- |
| 분석 경계 | 판교 1단계, 동탄 테크노밸리 경계 GeoJSON | `02_data/processed/boundaries/` |
| 필지 | VWorld 필지 데이터 | `02_data/processed/vworld/*_parcels.geojson` |
| 건물 | VWorld 건물 데이터 + 건축물대장 매칭 결과 | `02_data/processed/vworld/*_buildings_enriched.geojson` |
| 용도지역 | VWorld 용도지역 데이터 | `02_data/processed/vworld/*_landuse.geojson` |
| 인구/종사자 | SGIS 집계구 통계 | `02_data/processed/sgis/` |
| 도로망 | OpenStreetMap Overpass 도로망 | `02_data/processed/osm/` |
| 지하철 접근성 | 수도권 지하철 네트워크 ZIP | `02_data/raw/subway/subway_network.zip` |
| 사업체 | 소상공인시장진흥공단 상가(상권)정보 가공 결과 | `02_data/processed/business/` |

## 현재 비교 지표

- 건물 주용도 구성비
- 용도지역 및 토지이용 혼합도
- 평균 용적률
- 도로망 밀도와 도로 방향 엔트로피
- 30분/60분 등시간권 접근성
- 상주인구, 종사자수, 산업 종사자 구성
- 사업체수와 업종 분포
- 직주비

## 로컬 실행

```powershell
node 03_analysis/scripts/serve.js
```

브라우저에서 엽니다.

```text
http://127.0.0.1:4173
```

## 데이터 재생성

원천 데이터를 새로 수집하거나 전처리 결과를 다시 만들 때 실행합니다.

```powershell
node 03_analysis/scripts/build_app_data.js
```

결과는 `02_data/processed/` 아래에 생성됩니다.

## 보고서 자료

```text
05_report/
```

과제 원본 프롬프트와 검증용 export 파일을 보관합니다.
