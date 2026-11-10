@echo off
rem 프런트 오피스 개발 검증
rem   verify.bat 2c                     차수 종료 검증 (차수 이름 2c, Electron 자체 점검 + 장기 실행 2시즌)
rem   verify.bat 2c --stage dev         작업 중 확인 (타입·경계·바뀐 파일 관련 테스트)
rem   verify.bat 2c --stage milestone   최종 마일스톤 검증 (장기 실행 10시즌, 모든 기능 차수 완료 후)
rem   verify.bat 2c --quick             --stage dev와 같음
rem   verify.bat 2c --seasons 3         장기 실행 시즌 수 지정
rem 결과: verify-reports\latest.md, verify-reports\날짜_차수_단계.md (dev는 verify-reports\latest-dev.md)
rem 종료 코드: 0 = 통과(경고 포함), 1 = 실패
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [실패] Node.js를 찾을 수 없습니다. Node 22 이상을 설치하세요.
  set FO_EXIT=1
  goto end
)

set "FO_FIRST=%~1"
if "%FO_FIRST%"=="" (
  node scripts\verify.mjs --label unlabeled
) else if "%FO_FIRST:~0,2%"=="--" (
  node scripts\verify.mjs --label unlabeled %*
) else (
  node scripts\verify.mjs --label %*
)
set FO_EXIT=%errorlevel%

:end
rem 탐색기에서 더블클릭으로 실행한 경우 창이 바로 닫히지 않게 한다
echo %cmdcmdline% | find /i "%~0" >nul
if not errorlevel 1 pause
endlocal & exit /b %FO_EXIT%
