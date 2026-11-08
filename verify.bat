@echo off
rem 프런트 오피스 개발 차수 종료 검증
rem   verify.bat 2c            전체 검증 (차수 이름 2c)
rem   verify.bat 2c --quick    빠른 확인 (빌드·Electron 자체 점검·장기 실행 생략)
rem   verify.bat 2c --seasons 3
rem 결과: verify-reports\latest.md, verify-reports\날짜_차수.md
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
