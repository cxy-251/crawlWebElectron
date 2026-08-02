on replaceText(findText, replacementText, sourceText)
    set oldDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to findText
    set textItems to text items of sourceText
    set AppleScript's text item delimiters to replacementText
    set outputText to textItems as text
    set AppleScript's text item delimiters to oldDelimiters
    return outputText
end replaceText

on jsonString(rawValue)
    if rawValue is missing value then return "\"\""
    set valueText to rawValue as text
    set valueText to my replaceText("\\", "\\\\", valueText)
    set valueText to my replaceText("\"", "\\\"", valueText)
    set valueText to my replaceText(return, "\\n", valueText)
    set valueText to my replaceText(linefeed, "\\n", valueText)
    set valueText to my replaceText(tab, "\\t", valueText)
    return "\"" & valueText & "\""
end jsonString

on joinList(valuesList, delimiterText)
    set oldDelimiters to AppleScript's text item delimiters
    set AppleScript's text item delimiters to delimiterText
    set outputText to valuesList as text
    set AppleScript's text item delimiters to oldDelimiters
    return outputText
end joinList

on run argv
    if (count of argv) is 0 then error "Missing bridge command"
    set commandName to item 1 of argv

    if commandName is "inspect" then
        tell application "Safari"
            set windowParts to {}
            repeat with windowIndex from 1 to count of windows
                set browserWindow to window windowIndex
                set browserWindowId to id of browserWindow
                set tabParts to {}
                repeat with tabIndex from 1 to count of tabs of browserWindow
                    set browserTab to item tabIndex of tabs of browserWindow
                    set tabUrl to ""
                    set tabTitle to ""
                    try
                        set tabUrl to URL of browserTab
                    end try
                    try
                        set tabTitle to name of browserTab
                    end try
                    set currentJson to "false"
                    try
                        if browserTab is current tab of browserWindow then set currentJson to "true"
                    end try
                    set end of tabParts to "{\"tab_index\":" & tabIndex & ",\"url\":" & my jsonString(tabUrl) & ",\"title\":" & my jsonString(tabTitle) & ",\"is_current\":" & currentJson & "}"
                end repeat
                set end of windowParts to "{\"window_id\":" & browserWindowId & ",\"index\":" & windowIndex & ",\"tabs\":[" & my joinList(tabParts, ",") & "]}"
            end repeat
            return "[" & my joinList(windowParts, ",") & "]"
        end tell
    end if

    if commandName is "create_window" then
        set targetUrl to item 2 of argv
        tell application "Safari"
            activate
            make new document with properties {URL:targetUrl}
            return id of window 1 as text
        end tell
    end if

    if commandName is "front_app" then
        tell application "System Events"
            set frontProcesses to application processes whose frontmost is true
            if (count of frontProcesses) is 0 then return ""
            return name of item 1 of frontProcesses as text
        end tell
    end if

    if commandName is "activate_app" then
        set appName to item 2 of argv
        if appName is "" then return "ok"
        tell application "System Events"
            try
                set frontmost of process appName to true
            on error
                tell application appName to activate
            end try
        end tell
        return "ok"
    end if

    if commandName is "system_click" then
        set clickX to (item 2 of argv) as integer
        set clickY to (item 3 of argv) as integer
        tell application "Safari"
            activate
        end tell
        delay 0.05
        tell application "System Events"
            click at {clickX, clickY}
        end tell
        return "ok"
    end if

    set requestedWindowId to (item 2 of argv) as integer
    tell application "Safari"
        set targetWindow to missing value
        repeat with browserWindow in windows
            if (id of browserWindow) is requestedWindowId then
                set targetWindow to browserWindow
                exit repeat
            end if
        end repeat
        if targetWindow is missing value then error "Safari window not found: " & requestedWindowId

        if commandName is "create_tab" then
            set targetUrl to item 3 of argv
            set newTab to make new tab at end of tabs of targetWindow with properties {URL:targetUrl}
            set index of targetWindow to 1
            activate
            return count of tabs of targetWindow as text
        end if

        set requestedTabIndex to (item 3 of argv) as integer
        if requestedTabIndex < 1 or requestedTabIndex > (count of tabs of targetWindow) then error "Safari tab not found: " & requestedTabIndex
        set targetTab to item requestedTabIndex of tabs of targetWindow

        if commandName is "activate" then
            set index of targetWindow to 1
            set current tab of window 1 to item requestedTabIndex of tabs of window 1
            activate
            return "ok"
        end if

        if commandName is "navigate" then
            set URL of targetTab to item 4 of argv
            return "ok"
        end if

        if commandName is "eval" then
            set javascriptSource to item 4 of argv
            return do JavaScript javascriptSource in targetTab
        end if

        if commandName is "close_tab" then
            close targetTab
            return "ok"
        end if
    end tell

    error "Unknown bridge command: " & commandName
end run
