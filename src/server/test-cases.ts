export type TestCaseType = 'feature-summary' | 'spec-file';

export interface TestCase {
  id: string;
  title: string;
  category?: string;
  type: TestCaseType;
  description: string;
  summary?: string;
  file?: string;
  grep?: string;
}

/**
 * 26 Verified Test Cases grouped explicitly around the Level 1 evaluation brief
 * categories and mutation examples.
 */
export const TEST_CASES: TestCase[] = [
  // =========================================================================
  // 1. Autonomous Feature Testing (Core planner -> executor pipeline)
  // =========================================================================
  {
    id: 'feat-favorite-drone',
    title: 'New feature: drone favoriting',
    category: 'Autonomous Feature Testing',
    type: 'feature-summary',
    summary:
      'We added a favorite/star toggle button to each drone item in the devices panel. Clicking the star toggles between favorited and unfavorited state.',
    description:
      'Simulates a developer submitting a one-line feature description with no test steps written by hand. The system plans its own scenarios and executes them autonomously.',
  },
  {
    id: 'feat-copy-device-id',
    title: 'New feature: copy device ID button',
    category: 'Autonomous Feature Testing',
    type: 'feature-summary',
    summary:
      'We added a copy device ID button next to the device identifier in the telemetry panel. Clicking it copies the ID to the clipboard and shows a visible Copied confirmation.',
    description:
      'Simulates a developer submitting a plain English feature description for one-click ID copying. The system autonomously determines verification goals and executes them end-to-end.',
  },
  {
    id: 'feat-mute-alerts',
    title: 'New feature: mute alert notifications',
    category: 'Autonomous Feature Testing',
    type: 'feature-summary',
    summary:
      'We added a Mute Alerts toggle control in the cockpit. When enabled, incoming alert banners should be suppressed and not displayed in the alerts panel.',
    description:
      'Simulates a developer describing an alert muting toggle. The system decides necessary test scenarios across UI state and suppression behaviors without hand-written scripts.',
  },

  // =========================================================================
  // 2. Visual UI (missing actions, clipped content, conflicting statuses)
  // =========================================================================
  {
    id: 'spec-visual-primary-controls',
    title: 'All primary controls present and visible',
    category: 'Visual UI',
    type: 'spec-file',
    description:
      'Checks whether required flight actions, telemetry panels, or status indicators could be missing, clipped, or contradictory on screen.',
    file: 'tests/visual-completeness.spec.ts',
    grep: 'All primary controls present and visible',
  },
  {
    id: 'spec-visual-button-consistency',
    title: 'Take-off and land button state consistency',
    category: 'Visual UI',
    type: 'spec-file',
    description:
      "Checks whether take-off and land action buttons reflect conflicting states or allow impossible actions for the selected drone's physical state.",
    file: 'tests/visual-completeness.spec.ts',
    grep: 'Take-off and land button state consistency',
  },

  // =========================================================================
  // 3. Responsive UI (workflow works on laptop but main action unusable on phone)
  // =========================================================================
  {
    id: 'spec-responsive-flight-controls',
    title: 'Take-off/land controls reachable at phone width',
    category: 'Responsive UI',
    type: 'spec-file',
    description:
      "Tests the brief's own example: does this workflow's main action remain unclipped, visible, and usable at phone width?",
    file: 'tests/responsive.spec.ts',
    grep: 'Take-off/land controls reachable at phone width',
  },
  {
    id: 'spec-responsive-device-list',
    title: 'Device list usable at phone width',
    category: 'Responsive UI',
    type: 'spec-file',
    description:
      'Tests whether critical drone fleet management and selection controls remain reachable on phone viewports or collapse into an unusable layout.',
    file: 'tests/responsive.spec.ts',
    grep: 'Device list usable at phone width',
  },

  // =========================================================================
  // 4. Functional UI (action shows success but produces incorrect result)
  // =========================================================================
  {
    id: 'spec-functional-takeoff-socket-drop',
    title: 'Takeoff command during socket-drop shows false success',
    category: 'Functional UI',
    type: 'spec-file',
    description:
      "Tests the brief's example: does the UI falsely show takeoff success when socket packet loss prevents the real command from executing?",
    file: 'tests/functional-honesty.spec.ts',
    grep: 'Takeoff command during socket-drop shows false success',
  },
  {
    id: 'spec-functional-add-drone-sim-offline',
    title: 'Add-drone command during sim-offline shows false success',
    category: 'Functional UI',
    type: 'spec-file',
    description:
      'Tests the brief\'s example: does adding a drone report false success when the backend simulator is offline and unable to register the device?',
    file: 'tests/functional-honesty.spec.ts',
    grep: 'Add-drone command during sim-offline shows false success',
  },

  // =========================================================================
  // 5. Live Data & Freshness (clear live/delayed/stale/disconnected status)
  // =========================================================================
  {
    id: 'spec-freshness-socket-drop',
    title: 'socket-drop at 30% for 20s on drone-1',
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      'Tests whether the UI honestly discloses degraded connectivity or hides packet loss while presenting stale data as live.',
    file: 'tests/freshness.spec.ts',
    grep: 'socket-drop at 30% for 20s on drone-1',
  },
  {
    id: 'spec-freshness-sim-offline',
    title: 'sim-offline for 15s',
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      "Tests the brief's literal mutation example: does the UI falsely show a drone as online when the simulator is completely offline?",
    file: 'tests/freshness.spec.ts',
    grep: 'sim-offline for 15s',
  },
  {
    id: 'spec-geospatial-stale-position',
    title: "Stale position after sim-offline doesn't look current",
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      'Verifies whether spatial map coordinates are explicitly flagged as stale after connection drop rather than masquerading as current real-time telemetry.',
    file: 'tests/geospatial.spec.ts',
    grep: "Stale position after sim-offline doesn't look current",
  },
  {
    id: 'spec-geospatial-marker-sync',
    title: 'Map marker position matches telemetry position',
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      'Ensures real-time geospatial honesty by verifying 3D map marker positioning strictly synchronizes with raw numerical coordinates.',
    file: 'tests/geospatial.spec.ts',
    grep: 'Map marker position matches telemetry position',
  },
  {
    id: 'spec-video-degrade-fault',
    title: 'video-degrade fault is honestly reflected, not hidden',
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      'Tests whether video pipeline faults are surfaced immediately to the operator rather than silently freezing or hiding stream degradation.',
    file: 'tests/video-integrity.spec.ts',
    grep: 'video-degrade fault is honestly reflected, not hidden',
  },
  {
    id: 'spec-video-switching-drones',
    title: 'Switching drones actually switches video content, not just the label',
    category: 'Live Data & Freshness',
    type: 'spec-file',
    description:
      'Verifies that switching active drones swaps the live video stream instead of dishonestly updating only the text label.',
    file: 'tests/video-integrity.spec.ts',
    grep: 'Switching drones actually switches video content, not just the label',
  },

  // =========================================================================
  // 6. Basic Security (basic security testing requirement from brief)
  // =========================================================================
  {
    id: 'spec-security-control-panel-reachability',
    title: 'Control panel reachability',
    category: 'Basic Security',
    type: 'spec-file',
    description:
      'Audits whether operator mission control dashboards and internal endpoints are exposed over the network without authentication.',
    file: 'tests/security.spec.ts',
    grep: 'Control panel reachability',
  },
  {
    id: 'spec-security-unauth-command',
    title: 'Unauthenticated command execution',
    category: 'Basic Security',
    type: 'spec-file',
    description:
      "Tests the brief's security requirement: can critical flight commands like takeoff or land be executed without proper authorization credentials?",
    file: 'tests/security.spec.ts',
    grep: 'Unauthenticated command execution',
  },
  {
    id: 'spec-identifier-state-isolation',
    title: 'Device state isolation by id',
    category: 'Basic Security',
    type: 'spec-file',
    description:
      'Ensures multi-tenant integrity: verifies telemetry and state modifications on one drone never bleed into or corrupt another drone.',
    file: 'tests/identifier-security.spec.ts',
    grep: 'Device state isolation by id',
  },
  {
    id: 'spec-identifier-command-targeting',
    title: 'Command targeting isolation',
    category: 'Basic Security',
    type: 'spec-file',
    description:
      'Verifies control commands dispatched to a specific drone ID are strictly quarantined from affecting any other fleet device.',
    file: 'tests/identifier-security.spec.ts',
    grep: 'Command targeting isolation',
  },

  // =========================================================================
  // 7. API & Data Contract (resilience to schema drift & refresh recovery)
  // =========================================================================
  {
    id: 'spec-api-state-refresh',
    title: 'State survives a page refresh',
    category: 'API & Data Contract',
    type: 'spec-file',
    description:
      'Verifies the client application accurately rehydrates active drone fleet telemetry and flight states after a browser refresh.',
    file: 'tests/api-data-contract.spec.ts',
    grep: 'State survives a page refresh',
  },
  {
    id: 'spec-api-missing-field',
    title: 'Unexpected or missing telemetry field does not break rendering',
    category: 'API & Data Contract',
    type: 'spec-file',
    description:
      'Validates defensive API contract handling: ensures unexpected nulls, missing fields, or schema drift do not crash UI rendering.',
    file: 'tests/api-data-contract.spec.ts',
    grep: 'Unexpected or missing telemetry field does not break rendering',
  },

  // =========================================================================
  // 8. Semantic Element Understanding (finding actions by intent, not selectors)
  // =========================================================================
  {
    id: 'spec-element-id-takeoff',
    title: 'Semantic identification of take-off action',
    category: 'Semantic Element Understanding',
    type: 'spec-file',
    description:
      'Tests finding action controls by semantic meaning and intent across varied viewports rather than brittle CSS or DOM selectors.',
    file: 'tests/element-identification.spec.ts',
    grep: 'Semantic identification of take-off action',
  },
  {
    id: 'spec-element-id-land',
    title: 'Semantic identification of land action',
    category: 'Semantic Element Understanding',
    type: 'spec-file',
    description:
      'Tests autonomous AI agent ability to discover and interact with landing controls purely through visual understanding.',
    file: 'tests/element-identification.spec.ts',
    grep: 'Semantic identification of land action',
  },

  // =========================================================================
  // 9. Autonomous Browser Agent (genuine agent, not pre-scripted steps)
  // =========================================================================
  {
    id: 'spec-ux-agent-takeoff',
    title: 'Autonomous agent starts a drone flight',
    category: 'Autonomous Browser Agent',
    type: 'spec-file',
    description:
      'An autonomous AI agent navigates the live cockpit, locates flight actuation controls, and commands takeoff without pre-scripted steps.',
    file: 'tests/ux-agent.spec.ts',
    grep: 'Autonomous agent starts a drone flight',
  },
  {
    id: 'spec-ux-agent-switch-drone',
    title: 'Autonomous agent switches which drone is being monitored',
    category: 'Autonomous Browser Agent',
    type: 'spec-file',
    description:
      'An autonomous AI agent dynamically locates the device fleet roster and switches telemetry monitoring to a different drone.',
    file: 'tests/ux-agent.spec.ts',
    grep: 'Autonomous agent switches which drone is being monitored',
  },

  // =========================================================================
  // 10. Performance Under Load (responsiveness under fleet stress)
  // =========================================================================
  {
    id: 'spec-perf-max-drones',
    title: 'UI stays responsive with maximum simulated drones',
    category: 'Performance Under Load',
    type: 'spec-file',
    description:
      'Stress-tests cockpit UI rendering, map marker plotting, and frame rates under maximum simulated drone fleet density.',
    file: 'tests/performance-load.spec.ts',
    grep: 'UI stays responsive with maximum simulated drones',
  },
];
