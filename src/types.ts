export interface CapabilityExpectation {
  id: string;                  // e.g. "shared-dashboard.device-list"
  area: string;                // e.g. "Shared dashboard" (matches Product Brief areas)
  screen: string;              // e.g. "cockpit-main"
  description: string;         // human-readable expectation
  viewport: "desktop" | "mobile" | "both";
  checkType: "presence" | "visual-judgment" | "security" | "fault-response";
}

export interface ScenarioVerdict {
  scenarioId: string;
  title: string;
  description: string;
  approach: string;
  capabilityId: string;        // links back to CapabilityExpectation.id
  viewport: "desktop" | "mobile";
  result: "pass" | "fail" | "inconclusive";
  confidence: number;          // 0-1
  checkType?: "presence" | "visual-judgment" | "security" | "fault-response";
  evidence: {
    videoPath: string;
    screenshotPaths: string[];
    tracePath?: string;
  };
  reasoning: string;           // why the verdict was reached, for the judge's own transparency
  timestamp: string;
}
