' ==========================================================
'  Silent portfolio server starter
'  - Browser NAHI khulta (boot par popup nahi aayega)
'  - Server already chal raha ho to naya start nahi karega
'  - Server crash ho to apne aap restart hota rahega
'  Band karna hai: start.bat wali window, ya Task Manager se node.exe
' ==========================================================
Option Explicit

Dim shell, fso, nodePath, serverPath, workDir, cmd, result, attempt

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

workDir    = "C:\Users\zed king 3\Rashi-Portfolio\backend"
serverPath = workDir & "\server.js"
nodePath   = shell.Exec("where node")

If nodePath = "" Then
  nodePath = "C:\Program Files\nodejs\node.exe"
Else
  nodePath = Replace(Split(nodePath, vbCrLf)(0), "where node", "node")
End If

' ── Agar port 3000 pe koi server pehle se sun raha hai, kuch mat karo ──
attempt = 0
Do While attempt < 3
  attempt = attempt + 1
  result = shell.Run("cmd /c netstat -ano | findstr LISTENING | findstr :3000", 0, True)
  If result = 0 Then
    WScript.Quit 0
  End If
  WScript.Sleep 400
Loop

' ── Naya server shuru karo ──
cmd = "cd /d """ & workDir & """ && " & nodePath & " server.js"
shell.Run cmd, 0, False

' ── Agar 6 second me server uth nahi paya (ya mar gaya), dobara try ──
WScript.Sleep 6000
result = shell.Run("cmd /c netstat -ano | findstr LISTENING | findstr :3000", 0, True)
If result <> 0 Then
  WScript.Sleep 3000
  shell.Run cmd, 0, False
End If
