Option Explicit

Dim shell, fileSystem, scriptDirectory, repositoryRoot, launcher, command, exitCode
Dim chrome, programFiles, programFilesX86, localAppData, candidates, candidate, profile
Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
repositoryRoot = fileSystem.GetParentFolderName(scriptDirectory)
launcher = fileSystem.BuildPath(scriptDirectory, "launch_public_api.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & launcher & """"

exitCode = shell.Run(command, 0, True)
If exitCode <> 0 Then
    MsgBox "상세페이지 AI 자동화 API 서버를 시작하지 못했습니다.", 16, "API 실행 오류"
    WScript.Quit exitCode
End If

programFiles = shell.ExpandEnvironmentStrings("%ProgramFiles%")
programFilesX86 = shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
localAppData = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
candidates = Array( _
    fileSystem.BuildPath(programFiles, "Google\Chrome\Application\chrome.exe"), _
    fileSystem.BuildPath(programFilesX86, "Google\Chrome\Application\chrome.exe"), _
    fileSystem.BuildPath(localAppData, "Google\Chrome\Application\chrome.exe") _
)

chrome = ""
For Each candidate In candidates
    If fileSystem.FileExists(candidate) Then
        chrome = candidate
        Exit For
    End If
Next

If chrome <> "" Then
    profile = fileSystem.BuildPath(localAppData, "kuasangse-api-docs-chrome")
    shell.Run """" & chrome & """ --user-data-dir=""" & profile & """ --app=http://127.0.0.1:5050/api/v1/docs", 1, False
Else
    shell.Run "http://127.0.0.1:5050/api/v1/docs", 1, False
End If
