# 검증 리포트: 3a-pre

- 일시: 2026. 11. 9. 오전 9:50:08
- 모드: 전체 (장기 실행 10시즌, 시드 verify-1)
- 환경: Node 24.18.0, win32/x64
- **종합 판정: 실패**

| 단계 | 판정 | 시간(초) | 요약 |
| --- | --- | --- | --- |
| 실행 환경 | PASS | 0 | 준비됨 |
| 타입 검사 | PASS | 0.9 | 오류 0건 |
| 계층 경계 검사 | PASS | 0.5 | 계층 경계 검사 통과 (69개 파일) |
| 자동 테스트 | PASS | 33.8 | 80/80개 통과 |
| 빌드 | PASS | 1.1 | 완료 |
| 실제 Electron 자체 점검 | PASS | 5.4 | 스토브리그 12주 660ms, 시즌 720/720 2158ms, 화면 지연 3ms, 저장 161ms·불러오기 160ms, Steam mock |
| 장기 실행 10시즌 (시드 verify-1) | FAIL | 105.5 | 10시즌, 규칙 위반 1건, 마지막 시즌 저장 1744ms·저장본 72.1MB, 불러오기 571ms, 현금 279억 → 602억 |
| 문서 정합성 | FAIL | 0.2 | 실패 27건, 경고 2건, 임시 가정 26건 |
| 저장소 상태 | WARN | 0 | HEAD 171f3cc, 커밋되지 않은 변경 2개 |

## 상세

### 실행 환경 (PASS)

- Node 24.18.0, win32/x64

### 장기 실행 10시즌 (시드 verify-1) (FAIL)

- 2034시즌 규칙 위반 1건: 인천 세일러스 1군 25명 ≠ 26

로그: `verify-reports\logs\20261109-0947_3a-pre\sim.log`

### 문서 정합성 (FAIL)

- [실패] 문서 링크 깨짐: Claude outputs\24_achievements.md:545 → 02_owner_level_and_ap.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements.md:546 → 05_statistics_and_comparison.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements.md:547 → 10_game_simulation.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements.md:548 → 18_dashboard_and_reports.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements.md:549 → 20_save_and_data_model.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:630 → 01_league_and_calendar.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:631 → 12_health_and_recovery.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:632 → 14_marketing_and_fans.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:633 → 15_merchandise_and_sales.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:634 → 08_contracts_and_free_agency.md
- [실패] 문서 링크 깨짐: Claude outputs\24_achievements_업적체계_추가분.md:635 → 23_brands_and_sponsors.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:137 → 01_league_and_calendar.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:138 → 02_owner_level_and_ap.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:139 → 03_staff_and_delegation.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:140 → 05_statistics_and_comparison.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:141 → 08_contracts_and_free_agency.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:142 → 09_trades_and_roster.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:143 → 10_game_simulation.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:143 → 10a_probability_model.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:144 → 12_health_and_recovery.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:145 → 14_marketing_and_fans.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:146 → 15_merchandise_and_sales.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:147 → 16_sponsorship_and_ticketing.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:148 → 19_ai_clubs_and_balance.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:149 → 21_clubs_and_difficulty.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:150 → 22_stove_league_flow.md
- [실패] 문서 링크 깨짐: Claude outputs\25_awards_and_allstar.md:151 → 23_brands_and_sponsors.md
- [경고] 결정 로그 ID가 없는 임시 가정 9건 (리포트의 '코드의 임시 가정' 참고)
- [경고] 실제 테스트 80개 > 문서 기록 76개. 이번 차수 결과가 06_progress.md에 아직 없을 수 있음

로그: `verify-reports\logs\20261109-0947_3a-pre\docs.log`

### 저장소 상태 (WARN)

- 차수 종료 후 검증을 통과한 상태로 커밋하세요.

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
- `src/engine/worldgen.ts:268` **(결정 ID 없음)** FA 자격 기준 연수 (ASSUMPTION: KBO 등록일수 규정 원문 확인 전 단순화)
- `src/game/achievements.ts:26` (D-080) ASSUMPTION(D-080): 업적 목록과 경험치
- `src/game/draft.ts:16` (D-085) ASSUMPTION(D-085): 라운드별 계약금, 신인 연봉
- `src/game/organization.ts:34` (D-076) ASSUMPTION(D-076): 행동력 비용. 직접 채용 2는 03 문서, 해고 1은 초기안
- `src/game/organization.ts:40` (D-076) ASSUMPTION(D-076): 기본 위임 정책. 운영·경영지원은 '제안 후 승인'으로 시작한다.
- `src/game/postseason.ts:49` (D-081) ASSUMPTION(D-081): 포스트시즌 연장 15회. 와일드카드 외 무승부는 재경기(시리즈 마지막 일정 다음 날)
- `src/game/records.ts:15` (D-079) ASSUMPTION(D-079): 시작 이전 기록의 규정 기준(144경기)
- `src/game/seasonClose.ts:19` (D-043, D-085) ASSUMPTION(D-043·D-085): 목표·해임·파산·은퇴 수치
- `src/game/seasonClose.ts:41` (D-085) ASSUMPTION(D-085): 파산 판정 적용 여부. 입장·스폰서·굿즈 등 사업 수입이 구현되기 전에는 모기업이 없는 구단이
- `src/game/service.ts:435` **(결정 ID 없음)** ASSUMPTION(임시): 포스트시즌·스토브리그 없이 다음 시즌 정규시즌을 시작한다. 장기 데이터 검증용. 건너뛴 기간의 수입·지출은 처리되지 않는다.

## 판정 기준

기준값은 `scripts/verify.mjs`의 BUDGET에 있다. 기준을 바꾸면 근거를 결정 로그에 남긴다.
