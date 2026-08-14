@echo off
echo Buscando proceso en el puerto 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    if not "%%a"=="0" (
        echo Matando proceso con PID %%a...
        taskkill /F /PID %%a
    )
)
echo Proceso finalizado. El puerto 3000 ahora deberia estar libre.
pause
