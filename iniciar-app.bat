@echo off
setlocal
cd /d "%~dp0"

set PORT=5510

echo.
echo ========================================
echo   LIBRO - version actualizada
echo   Carpeta: %CD%
echo   URL: http://localhost:%PORT%
echo ========================================
echo.

echo Iniciando servidor local...
start "Servidor libro" py -m http.server %PORT% --directory "%CD%"

timeout /t 2 /nobreak >nul

echo Abriendo el navegador...
start "" http://localhost:%PORT%/?v=actualizado

echo.
echo Deja abierta la ventana del servidor mientras uses la app.
echo.
pause
