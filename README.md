# Pangyo-Dongtan Techno Valley Analysis

판교테크노밸리와 동탄테크노밸리를 정적 웹 지도와 핵심 지표로 비교하는 분석 저장소입니다.

- Live: https://202235875.github.io/pangyo-dongtan-techno-valley/
- 구역/요구사항: [01_구역선정/PROJECT_SPEC.md](01_%EA%B5%AC%EC%97%AD%EC%84%A0%EC%A0%95/PROJECT_SPEC.md)
- 과제 원본: [05_report/final_exam_prompt.html](05_report/final_exam_prompt.html)

## Repository Structure

```text
01_구역선정/              분석 구역 정의, 과제 스펙, 기준 문서
02_data/                  원천 데이터, 전처리 결과, 메타데이터
  raw/                    API/수동 수집 원본 데이터
  processed/              웹 앱이 직접 읽는 GeoJSON/JSON 결과
  metadata/               수집 현황, 데이터 인벤토리
03_analysis/              수집/전처리/분석 스크립트
  scripts/                Node.js, PowerShell 파이프라인
04_system/                배포 시스템
  web/                    정적 웹 앱 자산(app.js, styles.css)
05_report/                보고서 자료, 과제 프롬프트, 산출물
  exports/                검증용 압축 산출물
index.html                GitHub Pages 진입점
```

## Run Locally

```powershell
node 03_analysis/scripts/serve.js
```

Open `http://127.0.0.1:4173`.

## Rebuild Processed Data

원천 데이터를 새로 받은 뒤 전처리 결과를 다시 만들 때 실행합니다.

```powershell
node 03_analysis/scripts/build_app_data.js
```

주요 산출물은 `02_data/processed/app_data.json`과 `02_data/processed/**` 아래에 생성됩니다.

## Deployment Notes

GitHub Pages는 루트의 `index.html`을 진입점으로 사용합니다. 실제 앱 로직과 스타일은 `04_system/web/`에 있고, 데이터는 `02_data/processed/`와 일부 `02_data/raw/`의 배포용 파일을 fetch합니다.

대용량 원천 데이터 일부는 `.gitignore`로 제외되어 있습니다. 배포 화면이 직접 읽는 파일만 저장소에 포함합니다.
