# System Design
> **Evaluation Deliverable Links & Live Demo Note:**
> - **Public Static Results Dashboard (Permanent)**: [https://deploy-dashboard-pi.vercel.app](https://deploy-dashboard-pi.vercel.app) — A permanent, always-available record of all 45 scenario verification results with embedded video evidence recordings, viewable anytime by judges with no local server or browser runtime dependencies.
> - **Live Interactive Control Panel (Live Demo)**: The local control panel (`http://localhost:4500`) provides a real-time, interactive testing interface with streaming execution logs and a live visual browser viewport feed. It is best demonstrated live (in person or via screen share) rather than deployed as a static web link, as it requires a local Playwright/Chromium engine and an active FlytBase Cockpit container running on the host machine.

[placeholder: "TODO: describe testing system architecture here"]

# Scenarios

## Findings
### 1. socket-drop at 30% for 20s on drone-1
**Description:** Checks telemetry panel and connection indicators when 30% socket drop fault is injected on drone-1.
**Approach:** POST /control/fault with socket-drop, wait 6s, inspect DOM and query Midscene aiBoolean to check if degradation is surfaced.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\desktop\tests-freshness-Freshness--cfa1a-op-at-30-for-20s-on-drone-1-desktop\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [FAULT INJECTION: socket-drop (30% dropped packets for 20s on drone-1)]
Ground Truth (Control API): active fault={"kind":"socket-drop","until":1790408533040,"value":30}, dropping 30% of telemetry updates.
Baseline DOM: socket-status="socket connected", battery="35 %", alt="0.0 m", speed="0.0 m/s".
Fault-Active DOM: socket-status="socket connected", battery="35 %", alt="0.0 m", speed="0.0 m/s".
Midscene aiBoolean evaluation: indicatesDegraded=false.
Assessment: Despite 30% of drone telemetry packets being dropped by the backend, the UI continues displaying a healthy "socket connected" badge and presents telemetry values without any packet loss warning, staleness indicator, or link quality alert. The UI does not honestly reflect the degraded connection state.
Verdict: FAIL

### 2. socket-delay at 2000ms for 20s
**Description:** Checks whether Cockpit UI visually surfaces high socket latency when 2000ms delay is injected.
**Approach:** POST /control/fault with socket-delay, wait 6s, inspect DOM and query Midscene aiBoolean to check if latency/delay is communicated.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\desktop\tests-freshness-Freshness--3a60c-ket-delay-at-2000ms-for-20s-desktop\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [FAULT INJECTION: socket-delay (2000ms delay + jitter for 20s)]
Ground Truth (Control API): active fault={"kind":"socket-delay","until":1790408553084,"value":2000}, delaying telemetry packets by 2000-3000ms.
Baseline DOM: socket-status="socket connected", battery="35 %", alt="0.0 m".
Fault-Active DOM: socket-status="socket connected", battery="35 %", alt="0.0 m".
Midscene aiBoolean evaluation: indicatesDegraded=false.
Assessment: Telemetry data is delayed by 2 to 3 seconds, but the UI shows no latency metric, lag warning, or stale data badge. The header badge continues to say "socket connected", misleading operators into assuming values are real-time.
Verdict: FAIL

### 3. sim-offline for 15s simulator disconnect honesty
**Description:** Checks whether Cockpit UI alerts operators when simulator goes offline versus silently showing last-known telemetry as current.
**Approach:** POST /control/fault with sim-offline, verify GET /health returns simulator: disconnected, wait 6s, and inspect UI and Midscene aiBoolean.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\desktop\tests-freshness-Freshness--98290-Cockpit-sim-offline-for-15s-desktop\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [FAULT INJECTION: sim-offline (15s simulator disconnection)]
Ground Truth (Control API /health): simulator="disconnected" (objectively offline).
Baseline DOM: socket-status="socket connected", battery="35 %", alt="0.0 m".
Fault-Active DOM: socket-status="socket connected", battery="35 %", alt="0.0 m".
Midscene aiBoolean evaluation: indicatesDegraded=false.
Assessment: GET /health objectively confirms simulator is disconnected. However, because the WebSocket between browser and backend remains connected, the UI still displays a green "socket connected" badge and silently retains last-known telemetry values as if they are fresh. The cockpit fails to warn operators that the data source is offline.
Verdict: FAIL

### 4. Map and video tile layout at phone width
**Description:** Confirms the map and video tile do not overlap each other or get pushed off-screen, and verifies whether switching between view modes works.
**Approach:** Measure bounding boxes of map canvas, video tile, and 2D/3D toggle controls, test click interaction on view toggle, and evaluate visual collision with Midscene aiBoolean.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\mobile\tests-responsive-Responsiv-086fe--tile-layout-at-phone-width-mobile\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [RESPONSIVE EVALUATION: Map and video tile layout at 390x844]
Map canvas boundingBox: {"x":0,"y":268,"width":390,"height":576}.
Video tile boundingBox: {"x":12,"y":688.828125,"width":200,"height":143.171875}.
View toggle (2D/3D) boundingBox: {"x":150,"y":801.203125,"width":90,"height":30.796875}.
Video tile pushed off-screen: false.
Video tile overlaps map-view-toggle: true.
Toggle click blocked or intercepted: true (toggle functional: false).
Midscene aiBoolean (video tile overlaps/obscures toggle or pushed off-screen): false.
Assessment: Layout defect detected: Video tile (200px wide) overlaps the centered 2D/3D map toggle controls at bottom of mobile screen.
Verdict: FAIL

### 5. video-degrade fault is honestly reflected, not hidden
**Description:** Checks whether Cockpit honestly reflects video degradation (re-encoded at 320x180, 80 kbit/s) via quality indicators or badges rather than hiding it under a generic live label.
**Approach:** Inject video-degrade fault on drone-1, confirm active via GET /control/fault, wait for degraded frames, query Midscene aiBoolean on visible degradation, inspect video-state label for quality indicators, clean up fault.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\desktop\tests-video-integrity-Vide-f4280-nestly-reflected-not-hidden-desktop\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [FAULT RESPONSE: VIDEO-DEGRADE HONESTY AUDIT]
Ground Truth (Control API): Active fault={"kind":"video-degrade","deviceId":"drone-1","until":1790415165977}. Stream objectively re-encoded at 320x180, 80 kbit/s.
Baseline DOM Label: "live".
Fault-Active DOM Label: "live" (simply "live" without quality indicator: true).
Midscene aiBoolean ("Does the video in the video tile appear visibly degraded or lower quality?"): false.
Assessment: DISHONEST STATE PRESENTATION DETECTED. While the video stream was objectively degraded by backend fault injection to 320x180 at 80 kbit/s, the Cockpit UI continued presenting an unqualified "live" badge with zero quality degradation indicator, bitrate warning, or low-resolution warning. Operators are misled into believing full-fidelity video is streaming.
Verdict: FAIL

### 6. Unauthenticated command execution
**Description:** Verifies whether flight control commands (/control/command) can be executed without authentication.
**Approach:** Direct HTTP POST to /control/command with takeoff command without auth headers or cookies.
**Video:** [TODO: upload  and paste shareable link here]
**Result:** fail (confidence: 1)
**Reasoning:** [SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]
Unauthenticated flight control command execution succeeded with HTTP 200 without any authentication, authorization, or session validation.
Request: POST http://localhost:4000/api/control/command with payload {"deviceId":"drone-1","type":"takeoff"} (no auth headers, no cookies).
Response: HTTP 200 {"ok":true}.
Cleanup Request: POST http://localhost:4000/api/control/command with payload {"deviceId":"drone-1","type":"land"}.
Cleanup Response: HTTP 200 {"ok":true}.
Real-world impact: Any device or actor on the network can force active drones to take off, alter flight states, or force landings during live missions. Without authentication or caller logging, rogue or accidental commands cannot be prevented or audited.

### 7. Unauthenticated fault injection
**Description:** Verifies whether system fault injection (/control/fault) can be performed without authentication.
**Approach:** Direct HTTP POST to /control/fault with sim-offline payload without auth headers or cookies.
**Video:** [TODO: upload  and paste shareable link here]
**Result:** fail (confidence: 1)
**Reasoning:** [SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]
Unauthenticated fault injection succeeded with HTTP 200 without any authentication or credentials.
Request: POST http://localhost:4000/api/control/fault with payload {"kind":"sim-offline","seconds":5} (no auth headers, no cookies).
Response: HTTP 200 {"faults":[{"kind":"sim-offline","until":1790408683859}]}.
Cleanup Request: DELETE http://localhost:4000/api/control/fault.
Cleanup Response: HTTP 200 {"faults":[]}.
Real-world impact: Any entity on the network can inject simulated hardware dropouts, sensor failures, or network freezes during live operations. This can blind operators, trigger unneeded emergency procedures, or mask actual hardware anomalies with zero audit attribution.

### 8. Unauthenticated destructive action
**Description:** Verifies whether fleet entities (/control/drones) can be created and deleted without administrative authentication.
**Approach:** Direct HTTP POST to create drone and DELETE to remove drone with no auth headers or cookies.
**Video:** [TODO: upload  and paste shareable link here]
**Result:** fail (confidence: 1)
**Reasoning:** [SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]
Unauthenticated destructive fleet modification succeeded with HTTP 200 without any administrative credentials.
Creation Request: POST http://localhost:4000/api/control/drones with payload {"name":"SecTestDrone"} (no credentials).
Creation Response: HTTP 200 {"drone":{"id":"drone-9","type":"drone","name":"SecTestDrone","dockId":"dock-9"},"dock":{"id":"dock-9","type":"dock","name":"Dock 9","droneId":"drone-9"}}.
Deletion Request: DELETE http://localhost:4000/api/control/drones/drone-9 (no credentials).
Deletion Response: HTTP 200 {"ok":true}.
Real-world impact: Any actor on the network can arbitrarily add phantom drones to the fleet or delete registered drones and docks. Removing operational drones eliminates telemetry and control visibility, while rogue entries can disrupt airspace management and deceive human operators.

### 9. Control panel reachability
**Description:** Verifies whether the operator dashboard (/dashboard) is exposed on the network without authentication.
**Approach:** Direct HTTP GET to /dashboard without cookies or authorization headers.
**Video:** [TODO: upload  and paste shareable link here]
**Result:** fail (confidence: 1)
**Reasoning:** [SECURITY AUDIT FINDING: VULNERABILITY CONFIRMED]
Control panel operator interface (/dashboard) is reachable over the network without any authentication challenge.
Request: GET http://localhost:4000/dashboard (no auth headers, no cookies, no active session).
Response: HTTP 200 Content-Type: "text/html; charset=UTF-8" (Length: 15347 bytes, Preview: "<!doctype html> <html lang="en"> <head> <meta charset="utf-8" /> <meta name="viewport" content="width=device-width, initial-scale=1" /> <title>Cockpit...").
Real-world impact: Anyone on the local network or routed subnet can access the mission control dashboard directly. The interface provides unauthenticated access to flight telemetry, status displays, and control triggers without requiring a login, SSO credential, or session verification.

### 10. Take-off/land controls reachable at phone width
**Description:** Verifies whether take-off/land actions and control dashboard links are visible and accessible without requiring horizontal scroll at 390px width.
**Approach:** Load cockpit at 390x844, select drone, evaluate main page and control dashboard with boundingBox checks and Midscene aiBoolean neutral query.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\mobile\tests-responsive-Responsiv-ac674-ls-reachable-at-phone-width-mobile\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [RESPONSIVE EVALUATION: Take-off/land controls at 390x844]
Cockpit Main UI (http://localhost:4010):
  - Document scrollWidth: 390px (clientWidth: 390px). Horizontal overflow: false.
  - Dashboard link visible: true, boundingBox={"x":283.5625,"y":15.09375,"width":90.4375,"height":16.796875}.
  - Midscene evaluation (cut off / pushed outside / horizontal scroll on main): true.
Control Panel Dashboard (http://localhost:4000/dashboard):
  - Document scrollWidth: 534px (clientWidth: 390px). Horizontal overflow: true.
  - Takeoff button visible: true, boundingBox: {"x":435.21875,"y":534.515625,"width":73.96875,"height":33.59375}.
  - Land button visible: true, boundingBox: {"x":435.21875,"y":576.109375,"width":55.890625,"height":33.59375}.
  - Takeoff button pushed outside 390px viewport: true.
  - Midscene evaluation (cut off / pushed outside / horizontal scroll on dashboard): true.
Finding: Flight action controls (Take off / Land) on the Control Dashboard overflow the 390px viewport (scrollWidth=534px) and require horizontal scrolling to reach/actuate.
Verdict: FAIL

### 11. Stale position after sim-offline doesn't look current
**Description:** Verifies whether the Cesium map surfaces staleness when simulator goes offline while a drone is in flight, or misleadingly presents a frozen position as live and current.
**Approach:** Take off drone-1, inject sim-offline fault, confirm simulator disconnection via GET /health, wait 4s, and evaluate the map view with Midscene aiBoolean.
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\desktop\tests-geospatial-Map-and-G-1600b-ffline-doesn-t-look-current-desktop\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [GEOSPATIAL FAULT TEST: Stale position after sim-offline doesn't look current]
Ground Truth (Control API /health): simulator="disconnected" (confirmed disconnected).
Fault Injected: sim-offline for 12 seconds while drone-1 was in active flight.
Cesium Entity during fault: label="Drone 1 in_flight", lat=18.561607, lon=73.694747.
Midscene aiBoolean evaluation: mapGivesStalenessIndication=false.
Assessment: When the simulator disconnected, telemetry updates ceased and the drone position froze in place. However, the Cesium map continues rendering the 3D drone model in full saturated color with the label "Drone 1 in_flight" and no staleness warning icon, badge, or timestamp. The map presents an outdated, frozen position as completely live and current, directly violating geospatial freshness honesty.
Verdict: FAIL

### 12. Drone position marker remains visible in 3D mode
**Description:** Autonomous agent goal: Navigate to the cockpit at http://localhost:4010, select a drone to ensure its position marker is visible on the map, and then click the toggle to switch the map into 3D mode.
**Approach:** Agent received natural-language instruction without pre-scripted steps, planned action sequence autonomously via Midscene aiAct(), and outcome was verified via aiBoolean().
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\feature-agent\feature-agent.drone-marker-visible-in-3d\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [AUTONOMOUS UX TEST AGENT: Drone position marker remains visible in 3D mode]
Goal ID: feature-agent.drone-marker-visible-in-3d
Natural-Language Instruction: "Navigate to the cockpit at http://localhost:4010, select a drone to ensure its position marker is visible on the map, and then click the toggle to switch the map into 3D mode."
Agent Execution Outcome: Successfully navigated to the cockpit, selected a drone, and switched the map into 3D mode.
Agent Action Trail (captured from Midscene execution tasks):
  1. Planning:
  2. Action Space:
Midscene Execution Report: D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\midscene_run\report\playwright-2026-09-26_14-56-18-87513e1e.html
Verification Query: "The selected drone's position marker remains visible and correctly placed on the map in 3D rendering mode."
Semantic AI Verification Result: NEGATIVE / UNMET (false)
Autonomy Confirmation: Zero hardcoded selectors or locators used in execution step. Decision, element discovery, and actuation were determined dynamically by the AI agent.
Verdict: FAIL

### 13. Map 2D/3D toggle functionality on mobile viewport
**Description:** Autonomous agent goal: Open the cockpit at http://localhost:4010 using a mobile viewport, locate the map panel, and interact with the 2D/3D map mode toggle.
**Approach:** Agent received natural-language instruction without pre-scripted steps, planned action sequence autonomously via Midscene aiAct(), and outcome was verified via aiBoolean().
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\feature-agent\feature-agent.mobile-map-toggle\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [AUTONOMOUS UX TEST AGENT: Map 2D/3D toggle functionality on mobile viewport]
Goal ID: feature-agent.mobile-map-toggle
Natural-Language Instruction: "Open the cockpit at http://localhost:4010 using a mobile viewport, locate the map panel, and interact with the 2D/3D map mode toggle."
Agent Execution Outcome: The cockpit was opened, the map panel was located, and the 2D/3D map mode toggle was successfully interacted with.
Agent Action Trail (captured from Midscene execution tasks):
  1. Planning:
  2. Action Space:
Midscene Execution Report: D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\midscene_run\report\playwright-2026-09-26_14-56-53-e6a82499.html
Verification Query: "The toggle responds properly on mobile screens, successfully changing the map view without breaking the layout or hiding the selected drone marker."
Semantic AI Verification Result: NEGATIVE / UNMET (false)
Autonomy Confirmation: Zero hardcoded selectors or locators used in execution step. Decision, element discovery, and actuation were determined dynamically by the AI agent.
Verdict: FAIL

### 14. Toggle drone favorite state in devices panel on mobile
**Description:** Autonomous agent goal: Open the cockpit application on mobile. Open the devices panel if collapsed, locate a drone item, and tap the star/favorite button.
**Approach:** Agent received natural-language instruction without pre-scripted steps, planned action sequence autonomously via Midscene aiAct(), and outcome was verified via aiBoolean().
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\feature-agent\feature-agent.toggle-favorite-mobile\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [AUTONOMOUS UX TEST AGENT: Toggle drone favorite state in devices panel on mobile]
Goal ID: feature-agent.toggle-favorite-mobile
Natural-Language Instruction: "Open the cockpit application on mobile. Open the devices panel if collapsed, locate a drone item, and tap the star/favorite button."
Agent Execution Outcome: The cockpit application is open, the devices panel is expanded, and the star/favorite button for Drone 1 has been successfully tapped.
Agent Action Trail (captured from Midscene execution tasks):
  1. Planning:
  2. Action Space:
Midscene Execution Report: D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\midscene_run\report\playwright-2026-09-26_15-49-58-2a6c5f0a.html
Verification Query: "The star button correctly registers the tap, transitioning smoothly between favorited and unfavorited visual states on the mobile interface."
Semantic AI Verification Result: NEGATIVE / UNMET (false)
Autonomy Confirmation: Zero hardcoded selectors or locators used in execution step. Decision, element discovery, and actuation were determined dynamically by the AI agent.
Verdict: FAIL

### 15. Favorite multiple drones independently
**Description:** Autonomous agent goal: Open the devices panel on desktop. Click the favorite star button on at least two different drone items in the list. Verify that each drone maintains its own independent favorite state.
**Approach:** Agent received natural-language instruction without pre-scripted steps, planned action sequence autonomously via Midscene aiAct(), and outcome was verified via aiBoolean().
**Video:** [TODO: upload D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\runs\feature-agent\feature-agent.multiple-favorites-persistence\video.webm and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [AUTONOMOUS UX TEST AGENT: Favorite multiple drones independently]
Goal ID: feature-agent.multiple-favorites-persistence
Natural-Language Instruction: "Open the devices panel on desktop. Click the favorite star button on at least two different drone items in the list. Verify that each drone maintains its own independent favorite state."
Agent Execution Outcome: The devices panel is open, favorite star buttons were clicked on Drone 1 and Drone 2, and their independent favorite states are verified.
Agent Action Trail (captured from Midscene execution tasks):
  1. Planning:
  2. Action Space:
Midscene Execution Report: D:\Akshay final folder\Antigravity\FlytBase Hackathon\qa-system\midscene_run\report\playwright-2026-09-26_15-50-14-1b452f10.html
Verification Query: "Both selected drones show active favorited states while unselected drones remain unfavorited, confirming independent state management per drone item."
Semantic AI Verification Result: NEGATIVE / UNMET (false)
Autonomy Confirmation: Zero hardcoded selectors or locators used in execution step. Decision, element discovery, and actuation were determined dynamically by the AI agent.
Verdict: FAIL

### 16. Mute alerts toggle suppresses alert notifications
**Description:** Autonomous feature verification: Open the cockpit application, locate the 'Mute alerts' toggle button in the Drone Telemetry panel, and turn it On. When an alert is triggered (e.g. drone takeoff), verify whether alert notifications are suppressed.
**Approach:** Toggle Mute alerts to On ('🔕 Mute alerts: On'), dispatch drone takeoff command to emit an alert, and verify whether alert toasts are suppressed from the screen.
**Video:** [TODO: upload  and paste shareable link here]
**Result:** fail (confidence: 0.95)
**Reasoning:** [AUTONOMOUS FEATURE TEST / INTENTIONAL BUG VERIFICATION: Mute alerts toggle]
Goal ID: feature-agent.mute-alerts-suppression
Natural-Language Instruction: "Open the cockpit application, locate the Mute alerts toggle in the Drone Telemetry panel, and turn it On. When an alert is triggered, verify whether alert notifications are suppressed."
Agent Execution Outcome: The 'Mute alerts' toggle was located and activated to '🔕 Mute alerts: On'. A takeoff command was issued to drone-1, triggering an info alert (TAKEOFF: 'Drone 1 taking off').
Verification Query: "When Mute alerts is enabled, alert toasts and notifications are suppressed and do not appear on screen."
Semantic AI Verification Result: NEGATIVE / UNMET (false)
Assessment: The alert toast ('drone-1 Drone 1 taking off') visibly appeared in the top-right toast notification container (.toast[role="status"]) despite the 'Mute alerts: On' state being active. The control visually toggles to active state but fails to suppress alert rendering, confirming the defect.
Verdict: FAIL

## Also verified
- socket-kick socket badge flip, recovery, and telemetry staleness during gap (cockpit.freshness.socket-kick)
- Device list usable at phone width (cockpit.mobile.device-list-usability)
- All primary controls present and visible (cockpit.visual.primary-controls-present)
- No conflicting status indicators (cockpit.visual.no-conflicting-status)
- Semantic identification of device selector in device list (cockpit.semantic.device-selector)
- Semantic identification of socket health indicator (cockpit.semantic.socket-health-indicator)
- Autonomous agent switches which drone is being monitored (ux-agent.switch-drone)
- UI stays responsive with maximum simulated drones (cockpit.performance.max-drones-responsiveness)
- Telemetry panel readability at phone width (cockpit.mobile.telemetry-readability)
- Rapid fault toggling doesn't break UI state tracking (cockpit.performance.rapid-fault-recovery)
- video-freeze on drone-1 for 10s video state transition (cockpit.freshness.video-freeze)
- Semantic identification of video status indicator (cockpit.semantic.video-status-indicator)
- Autonomous agent determines whether video is currently live (ux-agent.check-video-live)
- Switching drones actually switches video content, not just the label (cockpit.video.source-switch-integrity)
- Take-off and land button state consistency (cockpit.visual.takeoff-land-button-consistency)
- Semantic identification of take-off action (cockpit.semantic.takeoff-action)
- Semantic identification of land action (cockpit.semantic.land-action)
- Autonomous agent starts a drone's flight (ux-agent.takeoff)
- Autonomous agent attempts to reach the flight control at mobile width (ux-agent.reach-flight-control-mobile)
- Device state isolation by id (security.identifier.device-state-isolation)
- Command targeting isolation (security.identifier.command-targeting-isolation)
- Takeoff command during socket-drop shows false success (cockpit.functional.takeoff-socket-drop-honesty)
- Add-drone command during sim-offline shows false success (cockpit.functional.add-drone-sim-offline-honesty)
- State survives a page refresh (cockpit.api-data.state-refresh-persistence)
- Unexpected or missing telemetry field does not break rendering (cockpit.api-data.fault-resilience-rendering)
- Map marker position matches telemetry position (cockpit.geospatial.marker-telemetry-sync)
- Toggle map between 2D and 3D modes (feature-agent.toggle-map-2d-3d)
- Drone position marker remains visible when switching back to 2D mode (feature-agent.drone-marker-visible-in-2d)
- Toggle drone favorite state in devices panel on desktop (feature-agent.toggle-favorite-desktop)
