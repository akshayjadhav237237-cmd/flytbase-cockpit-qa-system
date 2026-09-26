export type TestCaseType = 'feature-summary' | 'spec-file';

export interface TestCase {
  id: string;
  title: string;
  type: TestCaseType;
  description?: string;
  summary?: string;
  file?: string;
  grep?: string;
}

export const TEST_CASES: TestCase[] = [
  // 1. Feature Summaries (Autonomous Midscene Feature Testing)
  {
    id: 'feat-favorite-drone',
    title: 'Favorite drone toggle works',
    type: 'feature-summary',
    summary:
      'We added a favorite/star toggle button to each drone item in the devices panel. Clicking the star toggles between favorited and unfavorited state.',
    description:
      'We added a favorite/star toggle button to each drone item in the devices panel. Clicking the star toggles between favorited and unfavorited state.',
  },
  {
    id: 'feat-copy-device-id',
    title: 'Copy device ID works',
    type: 'feature-summary',
    summary:
      'We added a copy device ID button next to the device identifier in the telemetry panel. Clicking it copies the ID to the clipboard and shows a visible Copied confirmation.',
    description:
      'We added a copy device ID button next to the device identifier in the telemetry panel. Clicking it copies the ID to the clipboard and shows a visible Copied confirmation.',
  },
  {
    id: 'feat-mute-alerts',
    title: 'Mute alerts actually suppresses alerts',
    type: 'feature-summary',
    summary:
      'We added a Mute Alerts toggle control in the cockpit. When enabled, incoming alert banners should be suppressed and not displayed in the alerts panel.',
    description:
      'We added a Mute Alerts toggle control in the cockpit. When enabled, incoming alert banners should be suppressed and not displayed in the alerts panel.',
  },

  // 2. Real Playwright Spec Files
  // UX Agent Suite
  {
    id: 'spec-ux-agent-takeoff',
    title: 'Autonomous agent starts a drone flight',
    type: 'spec-file',
    description:
      'Autonomous agent navigates operator dashboard, identifies flight controls, and initiates takeoff without hardcoded selectors.',
    file: 'tests/ux-agent.spec.ts',
    grep: 'Autonomous agent starts a drone flight',
  },
  {
    id: 'spec-ux-agent-switch-drone',
    title: 'Autonomous agent switches which drone is being monitored',
    type: 'spec-file',
    description:
      'Autonomous agent locates the device roster and switches active telemetry monitoring to a different drone.',
    file: 'tests/ux-agent.spec.ts',
    grep: 'Autonomous agent switches which drone is being monitored',
  },

  // Geospatial Suite
  {
    id: 'spec-geospatial-marker-sync',
    title: 'Map marker position matches telemetry position',
    type: 'spec-file',
    description:
      'Validates that Cesium 3D map marker coordinates move synchronously with live drone telemetry during flight.',
    file: 'tests/geospatial.spec.ts',
    grep: 'Map marker position matches telemetry position',
  },
  {
    id: 'spec-geospatial-stale-position',
    title: "Stale position after sim-offline doesn't look current",
    type: 'spec-file',
    description:
      'Verifies that when simulator is offline, map position is clearly indicated as stale rather than fresh.',
    file: 'tests/geospatial.spec.ts',
    grep: "Stale position after sim-offline doesn't look current",
  },

  // Functional Honesty Suite
  {
    id: 'spec-functional-takeoff-socket-drop',
    title: 'Takeoff command during socket-drop shows false success',
    type: 'spec-file',
    description:
      'Checks whether the UI falsely acknowledges a flight command when websocket connectivity has been dropped.',
    file: 'tests/functional-honesty.spec.ts',
    grep: 'Takeoff command during socket-drop shows false success',
  },
  {
    id: 'spec-functional-add-drone-sim-offline',
    title: 'Add-drone command during sim-offline shows false success',
    type: 'spec-file',
    description:
      'Checks whether adding a drone while simulator is offline accurately reports failure or falsely claims success.',
    file: 'tests/functional-honesty.spec.ts',
    grep: 'Add-drone command during sim-offline shows false success',
  },

  // API Data Contract Suite
  {
    id: 'spec-api-state-refresh',
    title: 'State survives a page refresh',
    type: 'spec-file',
    description:
      'Verifies client UI restores accurate drone fleet state and telemetry after a browser reload.',
    file: 'tests/api-data-contract.spec.ts',
    grep: 'State survives a page refresh',
  },
  {
    id: 'spec-api-missing-field',
    title: 'Unexpected or missing telemetry field does not break rendering',
    type: 'spec-file',
    description:
      'Ensures resilient UI rendering when backend telemetry payloads omit fields or contain null values.',
    file: 'tests/api-data-contract.spec.ts',
    grep: 'Unexpected or missing telemetry field does not break rendering',
  },

  // Element Identification Suite
  {
    id: 'spec-element-id-takeoff',
    title: 'Semantic identification of take-off action',
    type: 'spec-file',
    description:
      'Verifies autonomous AI ability to identify and interact with takeoff controls across varied viewports.',
    file: 'tests/element-identification.spec.ts',
    grep: 'Semantic identification of take-off action',
  },
  {
    id: 'spec-element-id-land',
    title: 'Semantic identification of land action',
    type: 'spec-file',
    description:
      'Verifies autonomous AI ability to locate and trigger drone landing action controls.',
    file: 'tests/element-identification.spec.ts',
    grep: 'Semantic identification of land action',
  },

  // Freshness & Fault Injection Suite
  {
    id: 'spec-freshness-socket-drop',
    title: 'socket-drop at 30% for 20s on drone-1',
    type: 'spec-file',
    description:
      'Injects 30% packet drop and evaluates telemetry jitter, packet loss warnings, and UI recovery.',
    file: 'tests/freshness.spec.ts',
    grep: 'socket-drop at 30% for 20s on drone-1',
  },
  {
    id: 'spec-freshness-sim-offline',
    title: 'sim-offline for 15s',
    type: 'spec-file',
    description:
      'Simulates complete backend outage for 15s and verifies immediate UI disconnection alerts.',
    file: 'tests/freshness.spec.ts',
    grep: 'sim-offline for 15s',
  },

  // Identifier Security Suite
  {
    id: 'spec-identifier-state-isolation',
    title: 'Device state isolation by id',
    type: 'spec-file',
    description:
      'Verifies that state and telemetry mutations on drone-1 never leak into drone-2 state.',
    file: 'tests/identifier-security.spec.ts',
    grep: 'Device state isolation by id',
  },
  {
    id: 'spec-identifier-command-targeting',
    title: 'Command targeting isolation',
    type: 'spec-file',
    description:
      'Verifies flight control commands are strictly routed only to the target device ID.',
    file: 'tests/identifier-security.spec.ts',
    grep: 'Command targeting isolation',
  },

  // Performance & Load Suite
  {
    id: 'spec-perf-max-drones',
    title: 'UI stays responsive with maximum simulated drones',
    type: 'spec-file',
    description:
      'Stress-tests UI telemetry rendering, map marker plotting, and frame rates under maximum drone density.',
    file: 'tests/performance-load.spec.ts',
    grep: 'UI stays responsive with maximum simulated drones',
  },

  // Responsive Layout Suite
  {
    id: 'spec-responsive-flight-controls',
    title: 'Take-off/land controls reachable at phone width',
    type: 'spec-file',
    description:
      'Verifies critical flight control buttons remain visible, unclipped, and clickable on mobile screens (390x844).',
    file: 'tests/responsive.spec.ts',
    grep: 'Take-off/land controls reachable at phone width',
  },
  {
    id: 'spec-responsive-device-list',
    title: 'Device list usable at phone width',
    type: 'spec-file',
    description:
      'Verifies drone fleet selection panel collapses cleanly and remains usable on mobile viewports.',
    file: 'tests/responsive.spec.ts',
    grep: 'Device list usable at phone width',
  },

  // Security & Permissions Suite
  {
    id: 'spec-security-control-panel-reachability',
    title: 'Control panel reachability',
    type: 'spec-file',
    description:
      'Audits operator dashboard endpoint access control and unauthenticated exposure.',
    file: 'tests/security.spec.ts',
    grep: 'Control panel reachability',
  },
  {
    id: 'spec-security-unauth-command',
    title: 'Unauthenticated command execution',
    type: 'spec-file',
    description:
      'Tests whether flight commands can be executed without proper authorization or credentials.',
    file: 'tests/security.spec.ts',
    grep: 'Unauthenticated command execution',
  },

  // Video Integrity Suite
  {
    id: 'spec-video-switching-drones',
    title: 'Switching drones actually switches video content, not just the label',
    type: 'spec-file',
    description:
      'Verifies that switching active drones swaps the underlying WebRTC/video stream rather than merely changing the header.',
    file: 'tests/video-integrity.spec.ts',
    grep: 'Switching drones actually switches video content, not just the label',
  },
  {
    id: 'spec-video-degrade-fault',
    title: 'video-degrade fault is honestly reflected, not hidden',
    type: 'spec-file',
    description:
      'Verifies that video stream quality drops and faults are visibly surfaced in the cockpit video tile.',
    file: 'tests/video-integrity.spec.ts',
    grep: 'video-degrade fault is honestly reflected, not hidden',
  },

  // Visual Completeness Suite
  {
    id: 'spec-visual-primary-controls',
    title: 'All primary controls present and visible',
    type: 'spec-file',
    description:
      'Verifies telemetry dashboard, map canvas, video stream, and flight control panels are visually complete.',
    file: 'tests/visual-completeness.spec.ts',
    grep: 'All primary controls present and visible',
  },
  {
    id: 'spec-visual-button-consistency',
    title: 'Take-off and land button state consistency',
    type: 'spec-file',
    description:
      'Verifies takeoff/land button enabled/disabled states match the physical flight status of the selected drone.',
    file: 'tests/visual-completeness.spec.ts',
    grep: 'Take-off and land button state consistency',
  },
];
