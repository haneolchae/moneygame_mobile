# 검증 리포트: 4a

- 일시: 2026. 11. 10. 오후 1:57:05
- 모드: 전체 (장기 실행 10시즌, 시드 verify-1)
- 환경: Node 24.18.0, win32/x64
- **종합 판정: 실패**

| 단계 | 판정 | 시간(초) | 요약 |
| --- | --- | --- | --- |
| 실행 환경 | PASS | 0 | 준비됨 |
| 타입 검사 | PASS | 0.9 | 오류 0건 |
| 계층 경계 검사 | PASS | 0.6 | 계층 경계 검사 통과 (91개 파일) |
| 자동 테스트 | PASS | 72.2 | 120/120개 통과 |
| 빌드 | PASS | 1 | 완료 |
| 실제 Electron 자체 점검 | PASS | 9 | 스토브리그 12주 1988ms, 시즌 720/720 3724ms, 화면 지연 2ms, 저장 241ms·불러오기 219ms, Steam mock |
| 장기 실행 10시즌 (시드 verify-1) | FAIL | 121 | 10시즌, 규칙 위반 4건, 마지막 시즌 저장 626ms·저장본 26.6MB, 불러오기 293ms, 현금 267억 → 410억 |
| 문서 정합성 | WARN | 0.2 | 실패 0건, 경고 1건, 임시 가정 34건 |
| 저장소 상태 | PASS | 0 | HEAD 5d24f77, 커밋되지 않은 변경 0개 |

## 상세

### 실행 환경 (PASS)

- Node 24.18.0, win32/x64

### 장기 실행 10시즌 (시드 verify-1) (FAIL)

- 2028시즌 시즌 진행 5.18s (경고 5s)
- 2030시즌 시즌 진행 5.51s (경고 5s)
- 2033시즌 규칙 위반 1건: 사전 등록 ② 위반: 핵심 능력 평균 48.61 → 52.16
- 2034시즌 규칙 위반 1건: 사전 등록 ② 위반: 핵심 능력 평균 48.61 → 52.44
- 2035시즌 규칙 위반 1건: 사전 등록 ② 위반: 핵심 능력 평균 48.61 → 52.69
- 2035시즌 타석당 홈런 0.0246: 시즌 목표 0.0225 대비 9.3%
- 2036시즌 규칙 위반 1건: 사전 등록 ② 위반: 핵심 능력 평균 48.61 → 53.18

로그: `verify-reports\logs\20261110-1353_4a\sim.log`

### 문서 정합성 (WARN)

- [경고] 실제 테스트 120개 > 문서 기록 118개. 이번 차수 결과가 06_progress.md에 아직 없을 수 있음

로그: `verify-reports\logs\20261110-1353_4a\docs.log`

## 문서상 개발 진행 (06_progress.md)

| 순서 | 묶음 | 상태 |
| --- | --- | --- |
| 2a | 시간·재무 기반 | 완료 표시 |
| 2b | 계약·FA | 완료 표시 |
| 2c | 조직·위임 | 완료 표시 |
| 2e | 결재 흐름·기록·업적 | 완료 표시 |
| 2f | 포스트시즌·실제 구단 역사 — 조건부(verify 미실행) | 미완료 |
| 2g | 명예의 전당 — 조건부(verify 미실행) | 미완료 |
| 2h | 두 번째 스토브리그·아마추어·드래프트 — 조건부(verify 미실행) | 미완료 |
| 2i | 3a 착수 전 정리(3a-pre) | 완료 표시 |
| 3a | 능력치 데이터·기준 모델 | 완료 표시 |
| 3b | 성적 혼합·경기 계산 | 완료 표시 |
| 3c | 선수 상세·통합 검증 | 완료 표시 |
| 3d | 선수 행동 영역·기존 기능 연결 | 완료 표시 |
| 2d | 개막 준비·수동 로스터 | 완료 표시 |
| 3e | 구단 선택·비교 | 완료 표시 |
| 4a | 성장·노화 | 미완료 |
| 4b | 훈련·건강 | 미완료 |

## 코드의 임시 가정 (ASSUMPTION)

결정 로그 ID가 없는 항목은 04_decisions.md에 기록해야 한다.

- `src/engine/amateur.ts:54` (D-084) ASSUMPTION(D-084): 풀 규모(07 문서 고교 450·대학 300)와 시즌 출전량
- `src/engine/config.ts:70` (D-087) ASSUMPTION(D-087): 선수 생성 분포. 능력치 목록은 D-087, 분포는 초기안(성장 모델이 구현되면 교체)
- `src/engine/config.ts:85` (D-093) ASSUMPTION(D-093): 경기 운영 설정(주자 진루·투구 수·투수 교체). 타석 결과 확률은 probabilityConfig(10a)에 있다.
- `src/engine/config.ts:114` (D-089) ASSUMPTION(D-089): 관찰(스카우트 평가) 오차. 3c 스카우트 추정 범위 구현 전 임시값
- `src/engine/config.ts:142` (D-095) ASSUMPTION(D-095): 마감일 있는 의무 안건(40인 초과 정리). 운영팀은 마감 actWindowDays일 전부터 정리안을 실행·상정한다.
- `src/engine/config.ts:148` (D-098) ASSUMPTION(D-098): 포지션 최소 인원. AI 구단·우리 운영팀의 드래프트·FA·외국인·방출 판단과 1군 편성이 함께 쓴다.
- `src/engine/config.ts:161` (D-098, D-099) ASSUMPTION(D-098): 국내 미계약 선수 풀 규모(새 게임 시작 때 1회 생성, 이후 공급은 D-099 미지명 졸업자)와 능력 평균 보정
- `src/engine/config.ts:180` (D-120) ASSUMPTION(D-120): 개막 뒤 1군에서 말소한 선수는 10일 뒤 재등록(KBO 원문 확인 필요)
- `src/engine/config.ts:182` (D-120) ASSUMPTION(D-120): 사용자 편성의 1군 포수 최소 인원(주전 + 백업)
- `src/engine/config.ts:190` (D-124) ASSUMPTION(D-124): 정점 전 연간 성장 = (잠재 − 현재) × growthShare × 계수
- `src/engine/config.ts:195` (D-124) ASSUMPTION(D-124): 하락 = (declineBase + declinePerYear × 정점+2 이후 연수) × 노화 계수 × 능력 배수
- `src/engine/config.ts:219` (D-120) ASSUMPTION(D-120): 시범경기 — 개막 16일 전 목요일~개막 4일 전 화요일, 월요일 휴식, 9회까지(연장 없음)
- `src/engine/contracts.ts:11` (D-075) FA 협상 설정 (ASSUMPTION, D-075)
- `src/engine/finance.ts:63` (D-038) 2026년 기준 금액 (17·21 문서, D-038). 직원 급여는 2c 조직 구현 전까지 임시 총액이다(ASSUMPTION).
- `src/engine/finance.ts:69` (D-112) broadcastRenewalBpAssumed: 1500, // ASSUMPTION(D-112): 관중 추세 모델 전까지 10~20%의 중간값
- `src/engine/gamesim.ts:4` (D-091) 첫 개발 단계의 단순화 (ASSUMPTION(D-091), 설정·후속 단계에서 확장). 타석 결과 확률은 probability.ts(10a):
- `src/engine/history.ts:18` (D-079) ASSUMPTION(D-079): 출전량 기준. 능력 47 안팎이 주전 경계다.
- `src/engine/probabilityConfig.ts:79` (D-107) defaultMorale: 기분(사기) 모델 전 임시값(ASSUMPTION(D-107)).
- `src/engine/scoutingConfig.ts:1` (D-113) ASSUMPTION(D-113): 스카우팅 정확도·비용·공개 기준의 밸런스 초안.
- `src/engine/staff.ts:101` (D-076) ASSUMPTION(D-076): 직급별 기준 연봉. 능력 평균 50 기준, 능력에 따라 ×0.6~×1.8
- `src/engine/staff.ts:255` (D-095) ASSUMPTION(D-095): 40인 초과 명단 정리안 준비
- `src/engine/staff.ts:274` (D-076) 해고 보상금: 남은 계약 연수 연봉의 50% (ASSUMPTION, D-076)
- `src/engine/standings.ts:3` (D-056) ASSUMPTION(D-056): 추첨 시드는 아직 정하지 않아 구단 ID 순서를 쓴다. 1위·5위 결정전은 포스트시즌 단계에서 구현한다.
- `src/engine/worldgen.ts:194` (D-075) 국내 선수 연봉 시세 (ASSUMPTION, D-075): 능력 40 ≈ 0.6억, 50 ≈ 1.7억, 60 ≈ 5억, 70 ≈ 15억, 75 ≈ 28억 안팎.
- `src/engine/worldgen.ts:402` (D-085) FA 자격 기준 연수 (ASSUMPTION(D-085): KBO 등록일수 규정 원문 확인 전 단순화)
- `src/game/achievements.ts:26` (D-080) ASSUMPTION(D-080): 업적 목록과 경험치
- `src/game/draft.ts:17` (D-085) ASSUMPTION(D-085): 라운드별 계약금, 신인 연봉
- `src/game/organization.ts:34` (D-076) ASSUMPTION(D-076): 행동력 비용. 직접 채용 2는 03 문서, 해고 1은 초기안
- `src/game/organization.ts:43` (D-076) ASSUMPTION(D-076): 기본 위임 정책. 운영·경영지원은 '제안 후 승인'으로 시작한다.
- `src/game/postseason.ts:49` (D-081) ASSUMPTION(D-081): 포스트시즌 연장 15회. 와일드카드 외 무승부는 재경기(시리즈 마지막 일정 다음 날)
- `src/game/records.ts:15` (D-079) ASSUMPTION(D-079): 시작 이전 기록의 규정 기준(144경기)
- `src/game/seasonClose.ts:20` (D-043, D-085) ASSUMPTION(D-043·D-085): 목표·해임·파산·은퇴 수치
- `src/game/seasonClose.ts:42` (D-085) ASSUMPTION(D-085): 파산 판정 적용 여부. 입장·스폰서·굿즈 등 사업 수입이 구현되기 전에는 모기업이 없는 구단이
- `src/game/service.ts:544` (D-056) ASSUMPTION(D-056, 임시): 포스트시즌·스토브리그 없이 다음 시즌 정규시즌을 시작한다. 장기 데이터 검증용. 건너뛴 기간의 수입·지출은 처리되지 않는다.

## 판정 기준

기준값은 `scripts/verify.mjs`의 BUDGET에 있다. 기준을 바꾸면 근거를 결정 로그에 남긴다.
