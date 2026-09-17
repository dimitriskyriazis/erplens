@echo off
rem Elevates and runs the ERPLens deploy. Run from C:\erplens\scripts\iis on TelApp1.
rem The PowerShell window stays open (-NoExit) so the result can be read.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -NoExit -File C:\erplens\scripts\iis\deploy.ps1'"
