# 검증 리포트: 3a-pre

- 일시: 2026. 11. 9. 오전 10:33:20
- 모드: 전체 (장기 실행 10시즌, 시드 verify-1)
- 환경: Node 24.18.0, win32/x64
- **종합 판정: 조건부 통과(경고 있음)**

| 단계 | 판정 | 시간(초) | 요약 |
| --- | --- | --- | --- |
| 실행 환경 | PASS | 0 | 준비됨 |
| 타입 검사 | PASS | 0.9 | 오류 0건 |
| 계층 경계 검사 | PASS | 0.6 | 계층 경계 검사 통과 (70개 파일) |
| 자동 테스트 | PASS | 37 | 85/85개 통과 |
| 빌드 | PASS | 1.2 | 완료 |
| 실제 Electron 자체 점검 | PASS | 6.6 | 스토브리그 12주 701ms, 시즌 720/720 2082ms, 화면 지연 2ms, 저장 185ms·불러오기 178ms, Steam mock |
| 장기 실행 10시즌 (시드 verify-1) | PASS | 98.9 | 10시즌, 규칙 위반 0건, 마지막 시즌 저장 1888ms·저장본 72.2MB, 불러오기 582ms, 현금 279억 → 700억 |
| 문서 정합성 | WARN | 0.2 | 실패 0건, 경고 2건, 임시 가정 28건 |
| 저장소 상태 | PASS | 0 | HEAD d13dfea, 커밋되지 않은 변경 0개 |

## 상세

### 실행 환경 (PASS)

- Node 24.18.0, win32/x64

### 문서 정합성 (WARN)

- [경고] 결정 로그 ID가 없는 임시 가정 9건 (리포트의 '코드의 임시 가정' 참고)
- [경고] 실제 테스트 85개 > 문서 기록 76개. 이번 차수 결과가 06_progress.md에 아직 없을 수 있음

로그: `verify-reports\logs\20261109-1030_3a-pre\docs.log`

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
| 2d | 개막 준비 | 미완료 |
| 3a | 능력치 데이터·기준 모델 | 미완료 |
| 3b | 성적 혼합·경기 계산 | 미완료 |
| 3c | 선수 상세·통합 검증 | 미완료 |

## 코드의 임시 가정 (ASSUMPTION)

결정 로그 ID가 없는 항목은 04_decisions.md에 기록해야 한다.

- `src/engine/amateur.ts:51` (D-084) ASSUMPTION(D-084): 풀 규모(07 문서 고교 450·대학 300)와 시즌 출전량
- `src/engine/config.ts:70` **(결정 ID 없음)** ASSUMPTION: 선수 생성 분포 (선수·성장 모델이 구현되면 교체)
- `src/engine/config.ts:84` **(결정 ID 없음)** ASSUMPTION: 타석 결과 기준 확률 (가상 리그 목표 밸런스, 10 문서: 실제 리그 재현이 아님)
- `src/engine/config.ts:135` **(결정 ID 없음)** ASSUMPTION: 관찰(스카우트 평가) 오차. 06 문서의 스카우트 모델 구현 전 임시값
- `src/engine/config.ts:168` (D-095) ASSUMPTION(D-095): 마감일 있는 의무 안건(40인 초과 정리). 운영팀은 마감 actWindowDays일 전부터 정리안을 실행·상정한다.
- `src/engine/config.ts:174` (D-098) ASSUMPTION(D-098): 포지션 최소 인원. AI 구단·우리 운영팀의 드래프트·FA·외국인·방출 판단과 1군 편성이 함께 쓴다.
- `src/engine/config.ts:177` (D-098) ASSUMPTION(D-098): 국내 미계약 선수 풀 규모(새 게임·시즌 마감마다 생성)와 능력 평균 보정
- `src/engine/contracts.ts:11` (D-075) FA 협상 설정 (ASSUMPTION, D-075)
- `src/engine/finance.ts:63` (D-038) 2026년 기준 금액 (17·21 문서, D-038). 직원 급여는 2c 조직 구현 전까지 임시 총액이다(ASSUMPTION).
- `src/engine/finance.ts:69` **(결정 ID 없음)** broadcastRenewalBpAssumed: 1500, // ASSUMPTION: 관중 추세 모델 전까지 10~20%의 중간값
- `src/engine/gamesim.ts:4` **(결정 ID 없음)** 첫 개발 단계의 단순화 (ASSUMPTION, 설정·후속 단계에서 확장):
- `src/engine/history.ts:18` (D-079) ASSUMPTION(D-079): 출전량 기준. 능력 47 안팎이 주전 경계다.
- `src/engine/staff.ts:101` (D-076) ASSUMPTION(D-076): 직급별 기준 연봉. 능력 평균 50 기준, 능력에 따라 ×0.6~×1.8
- `src/engine/staff.ts:255` (D-095) ASSUMPTION(D-095): 40인 초과 명단 정리안 준비
- `src/engine/staff.ts:274` (D-076) 해고 보상금: 남은 계약 연수 연봉의 50% (ASSUMPTION, D-076)
- `src/engine/standings.ts:3` **(결정 ID 없음)** ASSUMPTION: 추첨 시드는 아직 정하지 않아 구단 ID 순서를 쓴다. 1위·5위 결정전은 포스트시즌 단계에서 구현한다.
- `src/engine/worldgen.ts:2` **(결정 ID 없음)** 분포·연봉 시세는 config의 ASSUMPTION 값과 아래 상수를 따른다.
- `src/engine/worldgen.ts:81` (D-075) 국내 선수 연봉 시세 (ASSUMPTION, D-075): 능력 40 ≈ 0.6억, 50 ≈ 1.7억, 60 ≈ 5억, 70 ≈ 15억, 75 ≈ 28억 안팎.
- `src/engine/worldgen.ts:298` **(결정 ID 없음)** FA 자격 기준 연수 (ASSUMPTION: KBO 등록일수 규정 원문 확인 전 단순화)
- `src/game/achievements.ts:26` (D-080) ASSUMPTION(D-080): 업적 목록과 경험치
- `src/game/draft.ts:17` (D-085) ASSUMPTION(D-085): 라운드별 계약금, 신인 연봉
- `src/game/organization.ts:34` (D-076) ASSUMPTION(D-076): 행동력 비용. 직접 채용 2는 03 문서, 해고 1은 초기안
- `src/game/organization.ts:40` (D-076) ASSUMPTION(D-076): 기본 위임 정책. 운영·경영지원은 '제안 후 승인'으로 시작한다.
- `src/game/postseason.ts:49` (D-081) ASSUMPTION(D-081): 포스트시즌 연장 15회. 와일드카드 외 무승부는 재경기(시리즈 마지막 일정 다음 날)
- `src/game/records.ts:15` (D-079) ASSUMPTION(D-079): 시작 이전 기록의 규정 기준(144경기)
- `src/game/seasonClose.ts:19` (D-043, D-085) ASSUMPTION(D-043·D-085): 목표·해임·파산·은퇴 수치
- `src/game/seasonClose.ts:41` (D-085) ASSUMPTION(D-085): 파산 판정 적용 여부. 입장·스폰서·굿즈 등 사업 수입이 구현되기 전에는 모기업이 없는 구단이
- `src/game/service.ts:437` **(결정 ID 없음)** ASSUMPTION(임시): 포스트시즌·스토브리그 없이 다음 시즌 정규시즌을 시작한다. 장기 데이터 검증용. 건너뛴 기간의 수입·지출은 처리되지 않는다.

## 판정 기준

기준값은 `scripts/verify.mjs`의 BUDGET에 있다. 기준을 바꾸면 근거를 결정 로그에 남긴다.
