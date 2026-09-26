# QA System — FlytBase Cockpit Automated UI Testing

This directory contains the automated UI testing and evaluation system for **FlytBase Cockpit**, a real-time drone and dock operations monitoring dashboard.

It provides the test runner configuration, capability specifications, evidence recording infrastructure, and environment configurations designed to run automated end-to-end scenarios with full video capture and trace artifacts.

---

## Prerequisites

- **Node.js**: v20 or higher
- **FlytBase Cockpit App**: The target application must be running. By default, the cockpit is deployed via Docker Compose from the sibling repository:
  - **Cockpit UI**: `http://localhost:4010`
  - **Control API & Backend**: `http://localhost:4000/api`
  - `COCKPIT_URL` must point at a running instance of the cockpit from the sibling repo (already running via `docker compose watch` on port 4010).

---

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Install Playwright browsers:**
   ```bash
   npx playwright install
   ```

3. **Configure environment (optional):**
   ```bash
   cp .env.example .env
   ```
   Customize variables such as `COCKPIT_URL` or `CONTROL_API_URL` if ports or hosts differ.

4. **Run tests:**
   ```bash
   npm test
   ```

---

## Directory Structure

```text
qa-system/
├── package.json               # Node.js project manifest & test scripts
├── tsconfig.json              # Strict TypeScript configuration (Node 20, ESNext)
├── playwright.config.ts       # Playwright runner config (desktop & mobile, video/trace enabled)
├── .env.example               # Environment variable templates
├── .gitignore                 # Ignores node_modules, runs output, and env secrets
├── README.md                  # This documentation
├── runs/                      # Output directory for test runs, videos, and trace artifacts
└── src/
    ├── config.ts              # Typed configuration and Control API endpoint constants
    ├── types.ts               # Core TypeScript interfaces (CapabilityExpectation, ScenarioVerdict)
    ├── spec/
    │   └── capability-spec.json # Seeded capabilities covering active Cockpit features
    ├── evidence/
    │   └── recorder.ts        # Evidence helper extracting video/trace/screenshot attachments
    └── report/                # Destination for generated test and verdict reports (placeholder)
```

---

## Key Configurations & Artifacts

- **Hard Artifact Guarantee**: Playwright is configured with `video: 'on'` and `trace: 'on'` across both projects (`desktop` at 1280x800 and `mobile` at 390x844). Every executed scenario records video evidence into `runs/{project}/{testname}/`.
- **Capability Specs**: Seeded expectations in `src/spec/capability-spec.json` define verifiable capabilities covering the socket connection, device list, Cesium map, numeric telemetry data, live video streaming, and takeoff/landing state transitions.
- **Control API Endpoints**: Defined in `src/config.ts` per `docs/reference.md` for orchestrating drone commands, simulator states, and fault injections.
