# 프런트 오피스 (개발 빌드)

야구 구단 경영 시뮬레이션. PC(Windows/Steam) 우선. 기획 문서는 `../baseball_management_docs_v0.1/`에 있다. 작업 전 그 폴더의 `claude.md`와 `03_development.md`를 먼저 읽는다.

## 실행

```bash
npm install          # 처음 한 번. npm 11은 설치 스크립트를 막으므로 esbuild·koffi 허용이 package.json에 기록돼 있다
npm run dev          # 빌드 후 데스크톱 앱 실행
npm test             # 자동 테스트
npm run selftest     # 실제 Electron 런타임 자체 점검 (창 숨김)
npm run sim -- --seasons 10 --out .sim-output/run.json   # 헤드리스 장기 실행
npm run check:boundaries   # 계층 경계 검사
npm run typecheck
npm run check:docs         # 문서 정합성 검사 (../baseball_management_docs_v0.1 기준)
```

## 개발 차수 종료 검증

`verify.bat 2c`(차수 이름)로 타입·경계·테스트·빌드·Electron 자체 점검·10시즌 장기 실행·문서 정합성을 한 번에 검사한다. 결과는 `verify-reports/latest.md`에 남는다. 작업 중 빠른 확인은 `verify.bat 2c --quick`. 기준은 `scripts/verify.mjs`의 BUDGET.

VS Code 확장처럼 `ELECTRON_RUN_AS_NODE`가 설정된 환경에서 `electron .`을 직접 실행하면 Node 모드로 떠서 실패한다. `npm run dev`/`npm start`는 이 변수를 지우고 실행한다.

## 구조

| 폴더 | 계층 |
| --- | --- |
| `src/engine` | 시뮬레이션 엔진 (순수 규칙. 외부 의존 없음) |
| `src/game` | 게임 진행 (명령·조회) |
| `src/persistence` | SQLite 저장·버전 변환·백업 |
| `src/shared` | 화면 ↔ 게임 통신 형식 |
| `src/host` | 워커 스레드·요청 처리기·규칙 위반 검사 |
| `src/platform` | Steam 연결 (실제·모의) |
| `src/electron` | 창·IPC·워커 관리 |
| `src/ui` | React 화면 |
| `src/cli` | 헤드리스 장기 실행 |

임시 가정은 `src/engine/config.ts`의 `ASSUMPTION` 주석에 모여 있다.

## 게임 데이터 위치

`%APPDATA%/front-office/game-data/` 아래 `session/`(진행 중), `saves/`(완성된 저장본, 클라우드 동기화 대상), `tmp/`(작업 폴더). `FO_DATA_DIR` 환경 변수로 바꿀 수 있다.

## Steam

`steam_appid.txt`(또는 `STEAM_APP_ID`)와 Steamworks SDK 재배포 파일(`steamworks_sdk/`)이 있으면 실제 연결을 시도하고, 없으면 모의 구현으로 동작한다. 둘 다 저장소에 커밋하지 않는다.
