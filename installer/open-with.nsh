; Loom in "Open with" for text and code files.
;
; Installing adds Loom to the apps Windows offers for these file types (right-click, Open with).
; It never changes what a file type opens with by default: that stays the person's choice, and
; picking Loom there with "Always" is theirs to make. Uninstalling takes every entry out again.
; Entries go where the install does: for this user, or for everyone on the PC.

!ifndef LOOM_PROGID
  !define LOOM_PROGID "Loom.File"
!endif

!macro LoomOpensWith EXT
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\SupportedTypes" "${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${LOOM_PROGID}" ""
!macroend

!macro LoomForgets EXT
  DeleteRegValue SHCTX "Software\Classes\${EXT}\OpenWithProgids" "${LOOM_PROGID}"
  ; Keys that only existed for Loom's entry go too; anything else in them stays.
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\${EXT}"
!macroend

; The file types Loom opens as text. One list, used to add and to remove.
!macro LoomTypes ACTION
  !insertmacro ${ACTION} ".md"
  !insertmacro ${ACTION} ".markdown"
  !insertmacro ${ACTION} ".mdx"
  !insertmacro ${ACTION} ".txt"
  !insertmacro ${ACTION} ".log"
  !insertmacro ${ACTION} ".json"
  !insertmacro ${ACTION} ".jsonc"
  !insertmacro ${ACTION} ".yml"
  !insertmacro ${ACTION} ".yaml"
  !insertmacro ${ACTION} ".toml"
  !insertmacro ${ACTION} ".ini"
  !insertmacro ${ACTION} ".env"
  !insertmacro ${ACTION} ".csv"
  !insertmacro ${ACTION} ".xml"
  !insertmacro ${ACTION} ".svg"
  !insertmacro ${ACTION} ".html"
  !insertmacro ${ACTION} ".htm"
  !insertmacro ${ACTION} ".css"
  !insertmacro ${ACTION} ".scss"
  !insertmacro ${ACTION} ".less"
  !insertmacro ${ACTION} ".js"
  !insertmacro ${ACTION} ".mjs"
  !insertmacro ${ACTION} ".cjs"
  !insertmacro ${ACTION} ".jsx"
  !insertmacro ${ACTION} ".ts"
  !insertmacro ${ACTION} ".mts"
  !insertmacro ${ACTION} ".cts"
  !insertmacro ${ACTION} ".tsx"
  !insertmacro ${ACTION} ".vue"
  !insertmacro ${ACTION} ".svelte"
  !insertmacro ${ACTION} ".astro"
  !insertmacro ${ACTION} ".py"
  !insertmacro ${ACTION} ".rb"
  !insertmacro ${ACTION} ".php"
  !insertmacro ${ACTION} ".go"
  !insertmacro ${ACTION} ".rs"
  !insertmacro ${ACTION} ".java"
  !insertmacro ${ACTION} ".kt"
  !insertmacro ${ACTION} ".c"
  !insertmacro ${ACTION} ".h"
  !insertmacro ${ACTION} ".cpp"
  !insertmacro ${ACTION} ".cs"
  !insertmacro ${ACTION} ".sql"
  !insertmacro ${ACTION} ".sh"
  !insertmacro ${ACTION} ".ps1"
!macroend

!macro customInstall
  ; Loom as an app Windows knows how to start with a file
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}" "FriendlyAppName" "Loom"
  WriteRegStr SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\${LOOM_PROGID}\shell\open\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" "%1"'
  WriteRegStr SHCTX "Software\Classes\${LOOM_PROGID}\Application" "ApplicationName" "Loom"
  !insertmacro LoomTypes LoomOpensWith
  ; Tell File Explorer the list changed, so Loom shows without signing out
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\Applications\${APP_EXECUTABLE_FILENAME}"
  DeleteRegKey SHCTX "Software\Classes\${LOOM_PROGID}"
  !insertmacro LoomTypes LoomForgets
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
