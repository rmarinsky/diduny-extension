<#
  Real OS input for the os-input e2e project (Windows only).

  Playwright's keyboard reaches the page, never Chrome's own shortcut handling,
  and it cannot touch Chrome's UI. This script finds the Chromium window whose
  title contains -Title, brings it to the foreground, and then:
    focus    only foregrounds the window
    keys     presses -Keys (for example "Alt+Shift+V") with real key events
    buttons  lists the buttons in that browser's windows (for diagnostics)
    press    invokes the button named -Name, waiting up to -TimeoutMs for it
  It prints one JSON object.
#>
param(
	[Parameter(Mandatory = $true)][ValidateSet("focus", "keys", "buttons", "press", "click")][string]$Action,
	[Parameter(Mandatory = $true)][string]$Title,
	[string]$Keys = "",
	[string]$Name = "",
	[int]$TimeoutMs = 10000,
	# keys: how many times to press the chord, with -GapMs between presses.
	[int]$Times = 1,
	[int]$GapMs = 80
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class DidunyOsInput {
	[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
	[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
	[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr window);
	[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
	[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
	[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, IntPtr processId);
	[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint attach, uint attachTo, bool on);
	[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
	[DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
	[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
	[DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, uint data, UIntPtr extra);

	public static void Click(int x, int y) {
		SetCursorPos(x, y);
		System.Threading.Thread.Sleep(50);
		mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
		System.Threading.Thread.Sleep(30);
		mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
	}

	public static bool Foreground(IntPtr window) {
		if (IsIconic(window)) ShowWindow(window, 9);
		uint current = GetCurrentThreadId();
		uint foreground = GetWindowThreadProcessId(GetForegroundWindow(), IntPtr.Zero);
		// Windows only lets the foreground thread hand focus over; borrow its input state.
		if (foreground != current) AttachThreadInput(current, foreground, true);
		BringWindowToTop(window);
		SetForegroundWindow(window);
		if (foreground != current) AttachThreadInput(current, foreground, false);
		return GetForegroundWindow() == window;
	}

	public static void Chord(byte[] keys) {
		foreach (byte key in keys) { keybd_event(key, 0, 0, UIntPtr.Zero); System.Threading.Thread.Sleep(15); }
		Array.Reverse(keys);
		foreach (byte key in keys) { keybd_event(key, 0, 2, UIntPtr.Zero); System.Threading.Thread.Sleep(15); }
	}
}
"@

function Write-Result($value) {
	$value | ConvertTo-Json -Compress -Depth 4
}

function Find-BrowserWindow {
	$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
	do {
		$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
			[System.Windows.Automation.TreeScope]::Children,
			[System.Windows.Automation.Condition]::TrueCondition)
		foreach ($window in $windows) {
			if ($window.Current.Name -like "*$Title*") { return $window }
		}
		Start-Sleep -Milliseconds 200
	} while ((Get-Date) -lt $deadline)
	throw "No window titled *$Title*"
}

function Get-BrowserButtons($browser) {
	# Prompts and bubbles are their own top-level windows owned by the same process.
	$processId = $browser.Current.ProcessId
	$windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
		[System.Windows.Automation.TreeScope]::Children,
		(New-Object System.Windows.Automation.PropertyCondition(
			[System.Windows.Automation.AutomationElement]::ProcessIdProperty, $processId)))
	$isButton = New-Object System.Windows.Automation.OrCondition(
		(New-Object System.Windows.Automation.PropertyCondition(
			[System.Windows.Automation.AutomationElement]::ControlTypeProperty,
			[System.Windows.Automation.ControlType]::Button)),
		(New-Object System.Windows.Automation.PropertyCondition(
			[System.Windows.Automation.AutomationElement]::ControlTypeProperty,
			[System.Windows.Automation.ControlType]::MenuItem)))
	foreach ($window in $windows) {
		$isMain = $window.Current.NativeWindowHandle -eq $browser.Current.NativeWindowHandle
		foreach ($button in $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $isButton)) {
			[pscustomobject]@{ element = $button; name = $button.Current.Name; main = $isMain }
		}
	}
}

$browser = Find-BrowserWindow
$handle = [IntPtr]$browser.Current.NativeWindowHandle
$focused = $false
for ($attempt = 0; $attempt -lt 5 -and -not $focused; $attempt++) {
	$focused = [DidunyOsInput]::Foreground($handle)
	if (-not $focused) { Start-Sleep -Milliseconds 200 }
}
if (-not $focused) { throw "Could not bring *$Title* to the foreground" }

switch ($Action) {
	"focus" { Write-Result @{ ok = $true } }
	"keys" {
		$codes = foreach ($part in $Keys.Split("+")) {
			switch ($part.Trim().ToLower()) {
				"alt" { 0x12 }
				"shift" { 0x10 }
				"ctrl" { 0x11 }
				"escape" { 0x1B }
				"enter" { 0x0D }
				"tab" { 0x09 }
				"space" { 0x20 }
				default {
					if ($part.Trim().Length -ne 1) { throw "Unsupported key $part" }
					[int][char]$part.Trim().ToUpper()
				}
			}
		}
		# With -Name, keyboard focus moves to that button first, e.g. into a prompt so Escape closes it.
		if ($Name) {
			$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
			do {
				$target = @(Get-BrowserButtons $browser) | Where-Object { ($_.name -split "`n")[0] -eq $Name } | Select-Object -First 1
				if (-not $target) { Start-Sleep -Milliseconds 250 }
			} while (-not $target -and (Get-Date) -lt $deadline)
			if (-not $target) { Write-Result @{ ok = $false; missing = $Name }; exit 1 }
			$target.element.SetFocus()
			Start-Sleep -Milliseconds 150
		}
		# One process for every press: starting PowerShell per press is slower than a multi-press window.
		for ($press = 0; $press -lt $Times; $press++) {
			if ($press -gt 0) { Start-Sleep -Milliseconds $GapMs }
			[DidunyOsInput]::Chord([byte[]]$codes)
		}
		Write-Result @{ ok = $true; keys = $Keys; times = $Times }
	}
	"buttons" {
		Write-Result @{ ok = $true; buttons = @(Get-BrowserButtons $browser | ForEach-Object { "$($_.name)$(if ($_.main) { '' } else { ' [popup]' })" }) }
	}
	{ $_ -in "press", "click" } {
		$deadline = (Get-Date).AddMilliseconds($TimeoutMs)
		do {
			$buttons = @(Get-BrowserButtons $browser)
			# Toolbar buttons add a second line ("Diduny`nHas access to this site"), so the first line counts.
			# "Close" is never pressed: in the main window it would close a tab or the browser.
			$match = $buttons | Where-Object { ($_.name -split "`n")[0] -eq $Name -and $Name -ne "Close" } | Select-Object -First 1
			if ($match -and $Action -eq "click") {
				# A real mouse click, for buttons that ignore UI Automation's Invoke (the toolbar's extension action).
				$box = $match.element.Current.BoundingRectangle
				[DidunyOsInput]::Click([int]($box.X + $box.Width / 2), [int]($box.Y + $box.Height / 2))
				Write-Result @{ ok = $true; clicked = $Name }
				exit 0
			}
			if ($match) {
				$pattern = $null
				if ($match.element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
					$pattern.Invoke()
				} else {
					$match.element.SetFocus()
					[DidunyOsInput]::Chord([byte[]]@(0x20))
				}
				Write-Result @{ ok = $true; pressed = $Name }
				exit 0
			}
			Start-Sleep -Milliseconds 250
		} while ((Get-Date) -lt $deadline)
		Write-Result @{ ok = $false; missing = $Name; buttons = @($buttons | ForEach-Object { $_.name }) }
		exit 1
	}
}
