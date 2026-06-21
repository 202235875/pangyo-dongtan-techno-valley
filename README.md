# 판교 테크노밸리 · 동탄 테크노밸리 비교분석 시스템

수도권 업무지구의 성공/실패 원인을 공공데이터로 비교분석하는 정적 웹 시스템입니다.
판교 테크노밸리(1단계)와 동탄 테크노밸리를 토지이용·교통망·인구사회 3개 영역에서 정량 비교합니다.

과제 원본 프롬프트와 작성 스펙은 [`docs/final_exam_prompt.html`](docs/final_exam_prompt.html), [`docs/PROJECT_SPEC.md`](docs/PROJECT_SPEC.md)에 있습니다.

## GitHub Pages

- URL: https://202235875.github.io/pangyo-dongtan-techno-valley/

## 데이터 출처 / 기준월

| 데이터 | 출처 | 기준 시점 |
| --- | --- | --- |
| 건축물대장(건물 용도·연면적·사용승인일) | data.go.kr 건축물대장 수동 다운로드 (`data/raw/building_registry_manual/`) | 2026-06-17 다운로드 |
| VWorld 필지/건물/용도지역 (LP_PA_CBND_BUBUN, LT_C_SPBD, LT_C_UQ111 등) | VWorld 2D Data API | 2026-06-18 수집 |
| SGIS 집계구 인구/사업체·종사자(10차 산업분류 포함) | SGIS 전국사업체조사·인구총조사 | 2020년 기준 |
| SGIS 집계구 경계 SHP | SGIS Open API | 2025년 2분기 |
| OSM 도로망 (판교) | OpenStreetMap Overpass API | 2026-06-08 |
| OSM 도로망 (동탄) | OpenStreetMap Overpass API | 2026-06-21 (최초 수집 bbox가 실제 경계와 안 맞아 0건 — 경계에 맞춰 재수집) |
| 수도권 지하철 네트워크 (역/구간) | LMS 제공 `subway_network.zip` | 서비스 컷오프 2026-06-18 이후 미개통 구간 제외 |
| 상가(상권)정보 | 소상공인시장진흥공단 | 2026년 3월 |
| 10차 산업분류 코드 목록 | SGIS Open API | 2026-06-17 수집 (대분류만 보유, 중분류 코드명은 미수집) |

## 전처리 실행 순서

원본(raw) 데이터는 리포지토리에 포함하지 않습니다(`.gitignore` 참고 — 빌드에만 쓰이고 정적 사이트가 직접 fetch하지 않는 원본은 추적하지 않으며, 일부는 GitHub 100MB 파일 제한을 넘습니다). 처음부터 다시 만들 경우:

1. `.env`에 `SGIS_CONSUMER_KEY`, `SGIS_CONSUMER_SECRET`, `VWORLD_KEY`, `DATA_GO_KR_SERVICE_KEY` 채우기 (커밋하지 말 것)
2. `scripts/collect_project_data.ps1`, `scripts/download_osm_overpass.ps1`, `scripts/download_sgis_census_tract_boundaries.ps1`로 원본 수집
3. (필요 시) `node scripts/convert_epsg5179_to_wgs84.js <input> <output>`로 EPSG:5179 경계 파일을 WGS84로 변환해 `data/processed/boundaries/`에 배치
4. `node scripts/build_app_data.js` 실행 — 원본을 정리해 `data/processed/`에 GeoJSON/JSON 정적 파일을 생성하고 `data/processed/app_data.json`을 씁니다
5. `node scripts/serve.js`로 로컬 확인 (`http://127.0.0.1:4173`)

이미 생성된 `data/processed/`만 있으면 1~4 없이 5번만으로 바로 띄울 수 있습니다.

## 기술 스택

- 정적 사이트: HTML/CSS/Vanilla JS, Leaflet.js (지도), Turf.js (공간연산), shpjs (SHP 파싱), JSZip (지하철망 압축 해제)
- 전처리: Node.js (`scripts/build_app_data.js`), 외부 의존성 없이 순수 JS로 좌표계 변환·SHP/DBF 파싱·공간 클리핑 구현

## 주의사항 (스펙 원문)

- `dongtan_business_area/`, `building_registry/` 폴더 데이터는 사용하지 않음 (잘못된 범위/오류 로그)
- 모든 좌표는 WGS84(EPSG:4326)로 통일
- 보고서 수치와 시스템 수치는 일치해야 함 — `data/processed/stats/*.json`, `data/processed/app_data.json`이 단일 진실 소스(source of truth)입니다
