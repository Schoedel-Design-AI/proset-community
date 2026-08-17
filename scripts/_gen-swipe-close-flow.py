#!/usr/bin/env python3
"""Generate the logout-on-swipe Maestro flow with credentials embedded.

Usage:
    python3 scripts/_gen-swipe-close-flow.py EMAIL PASSWORD > /tmp/proset-swipe.yaml
    maestro test /tmp/proset-swipe.yaml --device <serial>

The test (the 4d313bb fix): login -> land home -> force-close via stopApp
(the swipe-away equivalent) -> relaunch -> dismiss any onboarding modals ->
assert STILL on home, NOT logged out. Fails pre-fix (login screen after
relaunch), passes post-fix.

Modal handling: RN Modals hide everything behind them from Maestro's matcher,
so onboarding modals (paywall, choose-plan) must be dismissed BEFORE any home
assertion, and they can re-appear asynchronously — the dismissal chain runs
multiple times (runFlow-when never hard-fails when an element is absent).
"""
import sys

if len(sys.argv) < 3:
    raise SystemExit("Usage: _gen-swipe-close-flow.py EMAIL PASSWORD")

email, password = sys.argv[1], sys.argv[2]

DISMISS = """- runFlow:
    when:
      visible:
        id: "paywall-dismiss"
    commands:
      - tapOn:
          id: "paywall-dismiss"
- runFlow:
    when:
      visible:
        id: "select-plan-free"
    commands:
      - tapOn:
          id: "select-plan-free"
- runFlow:
    when:
      visible:
        id: "paywall-dismiss"
    commands:
      - tapOn:
          id: "paywall-dismiss"
"""

flow = f"""appId: ms.aifor.app
---
# --- Phase 1: sign in (only if not already logged in) and reach home ---
- launchApp
- runFlow:
    when:
      visible:
        id: "email-input"
    commands:
      - tapOn:
          id: "email-input"
      - inputText: {email}
      - tapOn:
          id: "password-input"
      - inputText: {password}
      - hideKeyboard
      - tapOn:
          id: "submit-button"
      - waitForAnimationToEnd
{DISMISS}
- extendedWaitUntil:
    visible:
      id: "home-slide-track"
    timeout: 20000
{DISMISS}
- extendedWaitUntil:
    visible:
      id: "home-slide-track"
    timeout: 10000
- assertVisible:
    id: "home-slide-track"
# --- Phase 2: THE FIX TEST — force-close (swipe away) and relaunch ---
- stopApp
- launchApp
- waitForAnimationToEnd
{DISMISS}
- extendedWaitUntil:
    visible:
      id: "home-slide-track"
    timeout: 20000
{DISMISS}
- extendedWaitUntil:
    visible:
      id: "home-slide-track"
    timeout: 10000
# THE assertions: still logged in (home, not the login screen)
- assertVisible:
    id: "home-slide-track"
- assertNotVisible:
    id: "email-input"
- takeScreenshot: StillLoggedInAfterSwipeClose
"""
print(flow)
