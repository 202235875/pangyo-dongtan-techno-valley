# 판교 테크노밸리 · 동탄 테크노밸리 비교분석 시스템

수도권 업무지구의 성공/실패 원인을 공공데이터로 비교분석하는 정적 웹 시스템입니다.
판교 테크노밸리(1단계)와 동탄 테크노밸리를 토지이용·건축, 교통망(등시간권), 인구사회 3개 영역에서 정량 비교합니다.

- **Live**: https://202235875.github.io/pangyo-dongtan-techno-valley/
- **과제 원본 프롬프트**: [`docs/final_exam_prompt.html`](docs/final_exam_prompt.html)
- **과제 작성 스펙(요구 기능/출력 구조)**: [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)

## 디렉터리 구조

```
index.html, app.js, styles.css   배포되는 정적 사이트 본체
scripts/                         전처리 · 수집 스크립트 (아래 "전처리 파이프라인" 참고)
data/raw/                        원본 데이터 (대용량 일부는 .gitignore로 제외, 재현 방법은 아래 참고)
data/processed/                  전처리 결과 GeoJSON/JSON — 사이트가 fetch로 직접 읽는 단일 진실 소스
data/metadata/                   수집 현황·인벤토리 기록 (README.md, collection_status.md, required_data_inventory.csv)
docs/                            과제 원본 문서(참고용, 시스템 코드 아님)
```

## 데이터 출처 · 기준월 · 처리 과정

| 데이터 | 출처 | 기준 시점 / 수집일 | 원본 경로 | 처리 방식 |
| --- | --- | --- | --- | --- |
| 분석 경계(판교 1단계, 동탄) | 수동 작도(공식 지구단위계획 경계 아님, 좌표만 EPSG:4326 사각형) | — | `data/processed/boundaries/*.geojson` | EPSG:5179 원본이면 `scripts/convert_epsg5179_to_wgs84.js`로 변환. 정밀한 공식 경계로 교체 전까지는 근사값으로 간주 |
| VWorld 필지(LP_PA_CBND_BUBUN) | VWorld 2D Data API | 2026-06-18 수집 | `data/raw/vworld/<area>/LP_PA_CBND_BUBUN/` | `build_app_data.js`가 0.01°×0.01° 타일(`tile_RRR_CCC_page_PPPP.json`)을 모두 병합 후 경계와 공간 교차 클리핑. VWorld API가 10km² 초과 bbox를 거부해서(`geomFilter` `INVALID_RANGE`) 타일링이 필요함 — 비타일 단일 호출 잔재가 `page_0001.json`으로 남아있는 곳은 실패 응답이므로 무시됨 |
| VWorld 건물(LT_C_SPBD) | VWorld 2D Data API | 2026-06-18 수집 | `data/raw/vworld/<area>/LT_C_SPBD/` | 위와 동일 타일 병합 + 클리핑. 이후 건축물대장과 조인(아래) |
| VWorld 용도지역(LT_C_UQ111~114) | VWorld 2D Data API | 2026-06-18 수집 | `data/raw/vworld/<area>/LT_C_UQ11{1..4}/` | 4개 레이어를 합쳐 `zone_kind` 태그를 붙이고 경계로 클리핑 → 토지이용혼합도(LUM, 엔트로피 지수) 계산에 사용 |
| 건축물대장(용도·연면적·대지면적·용적률·사용승인일) | data.go.kr 건축물대장 — **수동 다운로드** (자동화 시도는 실패, 아래 참고) | 2026-06-17 다운로드 | `data/raw/building_registry_manual/*.csv` | 필지코드(법정동코드+번+지) → 도로명주소 → 지번주소 순으로 fallback 매칭해 VWorld 건물 폴리곤에 조인. 동일 동에 여러 건축물대장 행이 잡히면 연면적은 합산, 대표값(주용도 등)은 연면적이 가장 큰 행 기준. 매칭 안 된 건물은 층수 추정치로 대체(`_추정` 플래그) |
| SGIS 집계구 경계 SHP | SGIS Open API (`boundary` 서비스) | 2025년 2분기 (`BASE_DATE 20250630`) | `data/raw/sgis/census_tract_shp/bnd_oa_31023_2025_2Q/`, `bnd_oa_31240_2025_2Q/` | 순수 JS로 직접 SHP/DBF 바이너리를 파싱(좌표계 EPSG:5179 → WGS84 직접 변환, 외부 GIS 라이브러리 미사용). 분석 경계와 폴리곤 교차 비율을 16×16 샘플링으로 추정해 가중치로 사용 |
| SGIS 인구 (총인구 등) | SGIS 전국인구총조사 | 2020년 | `data/raw/sgis/census_tract_stats/population_2020/*.csv` | `(year, tot_oa_cd, indicator_code, value)` 헤더 없는 4열 CSV. 집계구별 가중치를 곱해 경계 내부로 합산 |
| SGIS 사업체·종사자 (10차 대분류/중분류) | SGIS 전국사업체조사 | 2020년 | `data/raw/sgis/census_tract_stats/business_workers_2020/*.csv` | 동일 4열 구조. 10차 **대분류** 21종 코드(`cp_bem_001`~)를 `industry_codes_10th.json` 순서(A~U)에 매핑해 업종별 종사자수 산출. **중분류 코드명 매핑은 미수집**이라 중분류는 집계만 하고 화면에는 노출하지 않음. SGIS가 소규모 값을 `N/A`로 비공개 처리한 행은 0으로 집계되어 과소평가될 수 있음 |
| SGIS 10차 산업분류 코드 목록 | SGIS Open API (`stats/industrycode`) | 2026-06-17 수집 | `data/raw/sgis/industry_codes_10th.json` | 대분류 21종 이름/코드만 보유 |
| OSM 도로망 (판교) | OpenStreetMap Overpass API | 2026-06-08 | `data/raw/osm/pangyo_roads_overpass.json` | `highway` 태그가 있는 way를 LineString으로 변환, 경계로 클리핑 후 길이(km)·방위각 10° bin 엔트로피 계산 |
| OSM 도로망 (동탄) | OpenStreetMap Overpass API | 2026-06-21 (재수집) | `data/raw/osm/dongtan_roads_overpass.json` | 최초 수집 bbox(`37.260,127.073,37.270,127.099`)가 실제 확정 경계(`37.21 부근`)와 겹치지 않아 0건이었음. `37.194,127.071,127.125,37.236` 범위로 재수집(`scripts/download_osm_overpass.ps1`) |
| 수도권 지하철 네트워크 (역/구간) | LMS 제공 `subway_network.zip` | — | `data/raw/subway/subway_network.zip` | `network/nodes.tsv` + `network/links.tsv`. 서비스 시작일 `effective_begin`이 2026-06-18 이후인 구간은 등시간권 계산에서 제외(`SUBWAY_SERVICE_CUTOFF`) |
| 상가(상권)정보 | 소상공인시장진흥공단 | 2026년 3월 | `data/raw/business/소상공인시장진흥공단_상가(상권)정보_경기_202603.csv` | 경도/위도가 분석 경계 폴리곤 내부인 행만 스트리밍으로 집계(전체 351MB를 메모리에 올리지 않고 한 줄씩 처리). 대분류/중분류 업종 비중 산출 |

## 전처리 파이프라인

> 과제 스펙은 Python 전처리 스크립트를 가정했지만, 이 저장소는 **Node.js 단일 스크립트(`scripts/build_app_data.js`)** 로 동일한 역할을 합니다 — 외부 GIS/통계 라이브러리 없이 좌표계 변환, SHP/DBF 파싱, 공간 클리핑, 통계 집계를 직접 구현했습니다. (참고: 초기에 작성했던 `preprocess_buildings.py`는 건축물대장 조인 키 매칭에 실패 사례가 많아 폐기했고, 디버그 로그도 함께 정리했습니다. 같은 작업은 `build_app_data.js`의 `enrichBuildingsWithRegistry`가 대신합니다.)

실행 순서:

1. **(최초 1회, API 키 필요) 원본 수집**
   - `.env`에 `SGIS_CONSUMER_KEY`, `SGIS_CONSUMER_SECRET`, `VWORLD_KEY`, `DATA_GO_KR_SERVICE_KEY` 채우기 (커밋하지 말 것 — `.gitignore`에 포함됨)
   - `powershell -File scripts/collect_project_data.ps1` — SGIS 통계/산업분류 코드, VWorld 필지·건물·용도지역 타일 다운로드. **건축물대장은 이 스크립트의 data.go.kr API 자동 호출이 전수 HTTP 500으로 실패**해서(`data/metadata/collection_status.md` 참고) 결국 건축물대장 열람 사이트에서 CSV를 수동 다운로드해 `data/raw/building_registry_manual/`에 넣었습니다
   - `powershell -File scripts/download_osm_overpass.ps1` — 판교/동탄 OSM 도로망
   - `powershell -File scripts/download_sgis_census_tract_boundaries.ps1` — SGIS 집계구 경계 보조 다운로드
2. **(필요 시) 좌표계 변환**: `node scripts/convert_epsg5179_to_wgs84.js <input.geojson> <output.geojson>` — EPSG:5179 경계 원본을 WGS84로 변환해 `data/processed/boundaries/`에 배치
3. **핵심 빌드**: `node scripts/build_app_data.js`
   - 모든 raw 데이터를 읽어 `data/processed/{vworld,osm,sgis,stats,business}/`에 GeoJSON/JSON 생성
   - 건축물대장 조인(용도·연면적·용적률·사용승인일), 사용승인일 기반 연도별 준공 타임라인, SGIS 10차 대분류 종사자 가중합산, 도로망 길이/방향엔트로피용 원본 정리, 상가업소 공간집계까지 전부 이 단계에서 끝남
   - 마지막에 `data/processed/app_data.json` 한 파일로 두 지역 메타데이터를 합쳐 씀 — **사이트가 처음 로드할 때 fetch하는 단일 진입점**
4. **로컬 확인**: `node scripts/serve.js` → http://127.0.0.1:4173

데이터만 새로 받지 않고 코드만 고친 경우엔 3번(`node scripts/build_app_data.js`)만 다시 실행하면 됩니다. `data/processed/`만 있으면 1~3 없이 4번만으로 바로 띄울 수 있습니다.

## 재현 시 알아둘 것 (caveat)

- `data/raw/business/`, `data/raw/vworld/`, `data/raw/building_registry_manual/`, `data/raw/sgis/census_tract_stats/`, `data/raw/osm/`는 `.gitignore`로 제외했습니다. 사이트가 런타임에 fetch하지 않는 **빌드 입력 전용** 데이터이고, 상가업소 원본 1개는 351MB로 GitHub 100MB 파일 제한을 넘기 때문입니다. 처음부터 재현하려면 위 "전처리 파이프라인" 1번부터 다시 받아야 합니다.
- 분석 경계는 공식 지구단위계획 경계가 아니라 수동으로 그린 사각형입니다. 정밀 비교를 위해선 공식 경계로 교체가 필요합니다.
- 건축물대장 매칭률은 100%가 아닙니다 — 매칭 안 된 건물은 층수 기반 추정치로 대체됩니다 (지도 팝업에 `추정` 표시).
- SGIS는 소규모 값을 `N/A`로 비공개 처리합니다. 이 시스템은 `N/A`를 0으로 집계하므로 일부 지표(특히 종사자 업종 구성)가 실제보다 낮게 나올 수 있습니다.
- SGIS 10차 산업분류는 **대분류만** 명칭 매핑이 있고 중분류 코드명은 미수집 상태입니다.
- 동탄 OSM 도로망은 한 번 0건으로 수집되어 재수집했습니다 — bbox를 바꿀 일이 있으면 항상 확정된 분석 경계와 겹치는지 먼저 확인하세요.
- 보고서 수치와 시스템 수치가 일치해야 한다는 과제 요구사항에 따라, **`data/processed/stats/*.json`과 `data/processed/app_data.json`이 단일 진실 소스**입니다. 다른 곳에 수치를 따로 적지 마세요.

## 기술 스택

- 정적 사이트: HTML/CSS/Vanilla JS, Leaflet.js(지도), Turf.js(공간연산), shpjs(SHP 파싱), JSZip(지하철망 압축 해제)
- 전처리: Node.js(`scripts/build_app_data.js`) — 외부 GIS/통계 의존성 없이 좌표계 변환·SHP/DBF 파싱·공간 클리핑을 순수 JS로 구현
- 수집: PowerShell(SGIS/VWorld/OSM API 호출)

## 주의사항 (과제 스펙 원문)

- `dongtan_business_area/`, `building_registry/`(자동수집 실패 에러 로그) 폴더 데이터는 사용하지 않음
- 모든 좌표는 WGS84(EPSG:4326)로 통일
- 보고서 수치와 시스템 수치는 일치해야 함
