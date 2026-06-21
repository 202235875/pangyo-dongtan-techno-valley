# 판교-동탄 테크노밸리 비교분석 시스템

제1 판교테크노밸리와 동탄 테크노밸리를 지도, 공간 데이터, 통계 지표로 비교하는 정적 웹 분석 시스템입니다. GitHub Pages에서 바로 실행되도록 구성했으며, 사용자는 두 지역의 지도를 한 화면에서 비교하고 건물 용도, 용도지역, 인구, 종사자, 등시간권 접근성 지표를 확인할 수 있습니다.

- 배포 URL: https://202235875.github.io/pangyo-dongtan-techno-valley/
- 저장소: https://github.com/202235875/pangyo-dongtan-techno-valley
- 실행 방식: GitHub Pages 정적 배포
- 주요 기술: HTML, CSS, Vanilla JavaScript, Leaflet, Turf.js, JSZip, shpjs
- 비교 대상: 제1 판교테크노밸리, 동탄 테크노밸리

## 프로젝트 목적

이 프로젝트는 수도권의 대표적인 기술산업 집적지인 제1 판교테크노밸리와 동탄 테크노밸리를 같은 기준으로 비교하기 위해 만들었습니다. 단순한 표 비교가 아니라 지도 기반 공간 정보와 핵심 지표를 함께 보여주어 두 지역의 도시 구조, 접근성, 업무 기능, 토지 이용 특성을 직관적으로 비교하는 것이 목적입니다.

주요 비교 관점은 다음과 같습니다.

- 건물 주용도 구성 차이
- 용도지역과 토지이용 혼합도
- 평균 용적률과 개발 밀도
- 도로망 밀도와 도로 방향성
- 30분/60분 대중교통 등시간권 접근성
- 상주인구, 종사자수, 직주비
- 산업 종사자 구성과 사업체 업종 분포

## 화면 구성

웹 화면은 크게 지도 비교 영역과 핵심 비교 영역으로 구성됩니다.

지도 비교 영역에서는 판교와 동탄 지도를 좌우로 나란히 배치했습니다. 두 지도는 같은 지도모드를 공유하므로, 한 번의 모드 선택으로 두 지역의 동일한 주제를 동시에 비교할 수 있습니다.

현재 지도모드는 다음 5개입니다.

| 지도모드 | 내용 |
| --- | --- |
| 건물 주용도 | 건물별 주용도 분포를 색상으로 표시 |
| 용도지역 | 도시계획 용도지역 데이터를 지도에 표시 |
| 인구 | SGIS 집계구 기반 인구 분포를 단계구분도로 표시 |
| 종사자 | SGIS 집계구 기반 종사자 분포를 단계구분도로 표시 |
| 등시간권 | 핵심역 기준 30분/60분 접근 가능권역 계산 및 표시 |

기본 지도에는 경계와 도로 레이어가 표시됩니다. 필지 레이어는 지도별 버튼으로 켜고 끌 수 있습니다. 등시간권 레이어는 초기 로딩 성능을 고려해 기본으로 계산하지 않고, 사용자가 지도모드에서 `등시간권`을 선택한 뒤 30분권 또는 60분권을 눌렀을 때 계산되도록 구성했습니다.

핵심 비교 영역에서는 지도 아래에 주요 지표를 카드 형태로 정리했습니다. 이 영역은 지도에서 계산된 등시간권 결과와 전처리된 통계 데이터를 함께 사용합니다.

## 저장소 구조

```text
.
├─ index.html
├─ 02_data/
│  ├─ raw/
│  ├─ processed/
│  └─ metadata/
├─ 03_analysis/
│  └─ scripts/
├─ 04_system/
│  └─ web/
└─ 05_report/
   └─ exports/
```

### `index.html`

GitHub Pages의 진입점입니다. 화면의 기본 HTML 구조를 정의하고, 외부 라이브러리와 실제 웹 시스템 파일을 불러옵니다.

사용 라이브러리는 다음과 같습니다.

- Leaflet: 지도 렌더링
- Turf.js: 공간 연산, 면적 계산, 교차 판정, 등시간권 폴리곤 처리
- JSZip: 지하철 네트워크 ZIP 파일 로딩
- shpjs: SHP 파일 로딩과 GeoJSON 변환 보조

### `04_system/web/`

웹 시스템의 실제 실행 코드입니다.

```text
04_system/web/
├─ app.js
└─ styles.css
```

`app.js`는 지도와 비교 지표를 만드는 핵심 코드입니다.

- `02_data/processed/app_data.json` 로딩
- 판교/동탄 Leaflet 지도 생성
- 건물, 필지, 도로, 용도지역, 집계구 레이어 표시
- 지도모드 5종 전환
- 등시간권 계산과 결과 캐싱
- 각 지역 통계 패널 렌더링
- 하단 핵심 비교 카드 생성

`styles.css`는 화면 스타일을 담당합니다.

- 전체 레이아웃
- 좌우 지도 비교 화면
- 지도모드 버튼과 범례
- 지도별 레이어 버튼
- 통계 패널
- 핵심 비교 카드
- 모바일 반응형 배치

### `03_analysis/scripts/`

데이터 수집, 변환, 재생성에 사용하는 스크립트입니다.

```text
03_analysis/scripts/
├─ build_app_data.js
├─ collect_project_data.ps1
├─ convert_epsg5179_to_wgs84.js
├─ download_osm_overpass.ps1
├─ download_sgis_census_tract_boundaries.ps1
└─ serve.js
```

| 파일 | 역할 |
| --- | --- |
| `build_app_data.js` | 원천/전처리 데이터를 읽어 웹 앱에서 쓰는 `app_data.json`과 통계 파일을 생성 |
| `collect_project_data.ps1` | SGIS, VWorld 등 외부 데이터 수집 보조 |
| `download_osm_overpass.ps1` | OpenStreetMap Overpass API로 도로망 데이터 수집 |
| `download_sgis_census_tract_boundaries.ps1` | SGIS 집계구 경계 데이터 수집 |
| `convert_epsg5179_to_wgs84.js` | EPSG:5179 좌표계를 웹 지도용 WGS84로 변환 |
| `serve.js` | 로컬 확인용 정적 웹 서버 실행 |

## 데이터 구조

### `02_data/raw/`

원천 데이터가 들어가는 폴더입니다. 일부 원천 데이터는 용량이 크거나 재배포가 적절하지 않아 `.gitignore`로 제외했습니다. 현재 저장소에는 웹 실행에 필요한 일부 원천 자료와 메타데이터만 포함되어 있습니다.

주요 포함 자료:

- `02_data/raw/subway/subway_network.zip`
- `02_data/raw/sgis/industry_codes_10th.json`
- `02_data/raw/sgis/census_tract_shp/`
- `02_data/raw/collection_metadata.json`

### `02_data/processed/`

웹 시스템이 직접 읽는 전처리 결과입니다. GitHub Pages에서는 서버 사이드 코드가 실행되지 않기 때문에, 화면에 필요한 데이터는 모두 이 폴더의 JSON 또는 GeoJSON 파일로 미리 만들어 두었습니다.

```text
02_data/processed/
├─ app_data.json
├─ boundaries/
├─ business/
├─ osm/
├─ sgis/
├─ stats/
└─ vworld/
```

주요 데이터는 다음과 같습니다.

| 경로 | 내용 |
| --- | --- |
| `app_data.json` | 웹 앱이 처음 읽는 메인 데이터 진입점 |
| `boundaries/*.geojson` | 제1 판교테크노밸리, 동탄 테크노밸리 분석 경계 |
| `vworld/*_parcels.geojson` | VWorld 필지 데이터 |
| `vworld/*_buildings.geojson` | VWorld 건물 공간 데이터 |
| `vworld/*_buildings_enriched.geojson` | 건축물대장 정보가 결합된 건물 데이터 |
| `vworld/*_landuse.geojson` | VWorld 용도지역 데이터 |
| `osm/*_roads.geojson` | OpenStreetMap 기반 도로망 데이터 |
| `sgis/*_tract_stats.json` | SGIS 집계구 기반 인구/종사자 통계 |
| `sgis/isochrone_tract_stats.json` | 등시간권 접근성 계산에 사용하는 집계구 통계 |
| `stats/*_building_stats.json` | 건물 수, 용도, 용적률 등 건물 지표 |
| `stats/*_completion_timeline.json` | 건물 사용승인일 기반 준공 시기 지표 |
| `stats/*_industry_workers.json` | 산업 대분류별 종사자 지표 |
| `business/*_stores.json` | 상가업소 기반 사업체 업종 분포 |

### `02_data/metadata/`

데이터 수집 현황과 인벤토리 기록입니다. 웹 화면이 직접 읽는 파일은 아니지만, 어떤 데이터가 필요했고 어떤 자료가 수집되었는지 추적하기 위한 문서입니다.

```text
02_data/metadata/
├─ analysis_areas.json
├─ collection_status.md
├─ README.md
└─ required_data_inventory.csv
```

## 사용 데이터

| 분야 | 사용 데이터 | 출처/성격 | 저장 위치 |
| --- | --- | --- | --- |
| 분석 경계 | 제1 판교테크노밸리, 동탄 테크노밸리 경계 | 사용자가 제공한 경계 기반 가공 GeoJSON | `02_data/processed/boundaries/` |
| 필지 | 필지 경계 | VWorld 2D 데이터 API | `02_data/processed/vworld/*_parcels.geojson` |
| 건물 | 건물 공간 데이터 | VWorld 건물 레이어 | `02_data/processed/vworld/*_buildings.geojson` |
| 건물 속성 | 주용도, 연면적, 대지면적, 용적률, 사용승인일 | 건축물대장 수동 수집 자료와 건물 데이터 매칭 | `02_data/processed/vworld/*_buildings_enriched.geojson` |
| 용도지역 | 도시계획 용도지역 | VWorld 용도지역 레이어 | `02_data/processed/vworld/*_landuse.geojson` |
| 도로망 | 도로 중심선 | OpenStreetMap Overpass API | `02_data/processed/osm/*_roads.geojson` |
| 집계구 경계 | SGIS 집계구 SHP | SGIS 집계구 경계 | `02_data/raw/sgis/census_tract_shp/` |
| 인구 | 집계구 기반 인구 통계 | SGIS 통계 자료 가공 | `02_data/processed/sgis/` |
| 종사자 | 집계구 기반 종사자 통계 | SGIS 전국사업체조사 계열 자료 가공 | `02_data/processed/sgis/`, `02_data/processed/stats/` |
| 사업체 | 상가업소 업종 분포 | 소상공인시장진흥공단 상가업소 정보 가공 | `02_data/processed/business/` |
| 지하철망 | 수도권 지하철 노드/링크 | 수업 제공 ZIP 자료 | `02_data/raw/subway/subway_network.zip` |

## 주요 분석 지표

### 1. 건물 및 토지이용

- 건물 수
- 건물 주용도 구성
- 평균 용적률
- 용도지역 구성
- 토지이용 혼합도
- 사용승인일 기반 준공 시기 분포

건물 데이터는 VWorld 건물 레이어와 건축물대장 속성 정보를 결합해 사용했습니다. 이 데이터를 통해 단순 건물 위치뿐 아니라 주용도, 연면적, 용적률, 준공 시기까지 비교할 수 있도록 구성했습니다.

### 2. 인구와 고용

- 상주인구
- 종사자수
- 직주비
- 산업 대분류별 종사자 구성
- 집계구 기반 인구/종사자 공간 분포

SGIS 집계구 통계를 분석 경계와 교차시켜 두 지역의 인구와 고용 규모를 비교했습니다. 경계와 일부만 겹치는 집계구는 면적 교차를 기준으로 가중 합산했습니다.

### 3. 접근성과 도로망

- OSM 도로망 길이
- 도로망 밀도
- 도로 방향 엔트로피
- 핵심역 기준 30분/60분 등시간권
- 등시간권 내 접근 가능 인구와 종사자

등시간권은 판교역과 동탄역을 각 지역의 대표 핵심역으로 설정하고, 지하철 네트워크의 노드와 링크를 이용해 계산합니다. 계산량이 크기 때문에 초기 화면에서는 자동 실행하지 않고, 사용자가 `등시간권` 지도모드를 선택한 뒤 필요한 시간권을 직접 계산하도록 했습니다.

### 4. 사업체 분포

- 총 사업체수
- 업종 대분류 구성
- 지역별 업종 집중도

상가업소 정보를 분석 경계 안으로 필터링해 두 지역의 업종 구성을 비교했습니다.

## 로컬 실행 방법

Node.js가 설치되어 있으면 아래 명령으로 로컬 정적 서버를 실행할 수 있습니다.

```powershell
node 03_analysis/scripts/serve.js
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:4173
```

GitHub Pages와 동일하게 정적 파일을 불러오는 방식이므로, 로컬 실행 결과와 배포 화면의 구조는 같습니다.

## 데이터 재생성 방법

전처리 데이터를 다시 만들 때는 아래 스크립트를 실행합니다.

```powershell
node 03_analysis/scripts/build_app_data.js
```

이 스크립트는 원천 데이터와 가공 데이터를 읽어 `02_data/processed/` 아래의 웹용 JSON/GeoJSON 파일을 갱신합니다.

주요 생성 대상:

- `02_data/processed/app_data.json`
- `02_data/processed/stats/*.json`
- `02_data/processed/sgis/*.json`
- `02_data/processed/business/*.json`

## 배포 방식

이 프로젝트는 별도 백엔드 없이 GitHub Pages로 배포됩니다.

배포 구조는 다음과 같습니다.

1. `index.html`이 첫 화면으로 로드됩니다.
2. `04_system/web/app.js`와 `04_system/web/styles.css`가 로드됩니다.
3. 앱은 `02_data/processed/app_data.json`을 읽습니다.
4. 필요한 GeoJSON/JSON 데이터를 추가로 `fetch`합니다.
5. Leaflet 지도와 핵심 비교 카드가 브라우저에서 렌더링됩니다.

정적 배포 방식이기 때문에 서버에서 실시간 계산을 수행하지 않습니다. 등시간권처럼 계산량이 큰 기능은 브라우저에서 사용자가 직접 실행할 때만 계산합니다.

## 성능 관련 메모

초기 접속 시에는 지도 라이브러리, 공간 연산 라이브러리, GeoJSON 데이터가 함께 로드됩니다. 특히 건물, 필지, 도로망, 집계구 데이터는 용량이 크기 때문에 처음 접속할 때 약간의 지연이 발생할 수 있습니다.

성능을 줄이기 위해 적용한 방식은 다음과 같습니다.

- 등시간권 계산은 초기 자동 실행에서 제외
- 등시간권 레이어는 지도모드에서 사용자가 선택할 때만 표시
- 30분/60분 접근성 결과는 한 번 계산하면 재사용
- 핵심 비교 영역의 등시간권 지표는 계산 전 안내 문구 표시
- 웹 화면이 읽는 데이터는 `02_data/processed/`로 정리해 경로를 단순화

## 보고서 및 검증 자료

```text
05_report/exports/
```

보고서 작성이나 데이터 검증에 사용한 export 파일을 보관합니다. 웹 시스템 실행에는 필수 파일이 아니며, 분석 과정에서 경계와 집계구 자료를 확인하기 위한 보조 자료입니다.

## 한계와 주의사항

- 분석 경계는 제공된 경계 파일을 기준으로 가공했습니다. 공식 고시 경계와 차이가 있을 경우 결과가 달라질 수 있습니다.
- 집계구 통계는 분석 경계와 완전히 일치하지 않으므로 면적 가중 방식으로 합산했습니다.
- 일부 비공개 또는 결측 통계값은 실제보다 작게 집계될 수 있습니다.
- 건축물대장과 VWorld 건물 데이터의 매칭 과정에서 일부 건물은 속성 정보가 누락될 수 있습니다.
- 등시간권은 지하철 네트워크 기반 접근성을 단순화해 계산한 결과이며, 실제 보행 접근, 환승 대기, 운행 간격, 버스 연계는 완전하게 반영하지 않습니다.

## 요약

이 저장소는 제1 판교테크노밸리와 동탄 테크노밸리를 비교하기 위한 웹 분석 시스템, 전처리 데이터, 데이터 수집/가공 스크립트를 포함합니다. 최종 사용자는 배포 URL에서 지도와 핵심 지표를 통해 두 지역의 공간 구조와 산업적 특성을 비교할 수 있습니다.
