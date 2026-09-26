import dotenv from 'dotenv';

// Load environment variables from .env
dotenv.config();

export interface Config {
  cockpitUrl: string;
  controlApiUrl: string;
}

/**
 * Global configuration loaded from process.env with sensible defaults
 * matching .env.example
 */
export const config: Config = {
  cockpitUrl: process.env.COCKPIT_URL || 'http://localhost:4010',
  controlApiUrl: process.env.CONTROL_API_URL || 'http://localhost:4000/api',
};

/**
 * Base URL for the Cockpit Control API
 */
export const CONTROL_API_BASE_URL = config.controlApiUrl;

/**
 * Control API endpoint paths per docs/reference.md:
 * - GET /health
 * - GET /devices
 * - GET /control/state
 * - POST /control/sim
 * - POST /control/command
 * - POST /control/drones
 * - DELETE /control/drones/:id
 * - POST /control/video
 * - GET /control/fault
 * - POST /control/fault
 * - DELETE /control/fault
 * - DELETE /control/fault/:kind
 */
export const ENDPOINT_HEALTH = '/health';
export const ENDPOINT_DEVICES = '/devices';
export const ENDPOINT_CONTROL_STATE = '/control/state';
export const ENDPOINT_CONTROL_SIM = '/control/sim';
export const ENDPOINT_CONTROL_COMMAND = '/control/command';
export const ENDPOINT_CONTROL_DRONES = '/control/drones';
export const ENDPOINT_CONTROL_DRONE_BY_ID = '/control/drones/:id';
export const ENDPOINT_CONTROL_VIDEO = '/control/video';
export const ENDPOINT_CONTROL_FAULT = '/control/fault';
export const ENDPOINT_CONTROL_FAULT_BY_KIND = '/control/fault/:kind';

export const CONTROL_API_ENDPOINTS = {
  HEALTH: ENDPOINT_HEALTH,
  DEVICES: ENDPOINT_DEVICES,
  CONTROL_STATE: ENDPOINT_CONTROL_STATE,
  CONTROL_SIM: ENDPOINT_CONTROL_SIM,
  CONTROL_COMMAND: ENDPOINT_CONTROL_COMMAND,
  CONTROL_DRONES: ENDPOINT_CONTROL_DRONES,
  CONTROL_DRONE_BY_ID: ENDPOINT_CONTROL_DRONE_BY_ID,
  CONTROL_VIDEO: ENDPOINT_CONTROL_VIDEO,
  CONTROL_FAULT: ENDPOINT_CONTROL_FAULT,
  CONTROL_FAULT_BY_KIND: ENDPOINT_CONTROL_FAULT_BY_KIND,
} as const;

/**
 * Dynamic path generators for parameterized routes
 */
export const getDroneEndpoint = (id: string): string => `/control/drones/${id}`;
export const getFaultEndpoint = (kind: string): string => `/control/fault/${kind}`;

export interface MidsceneEnv {
  MIDSCENE_MODEL_API_KEY: string | undefined;
  MIDSCENE_MODEL_BASE_URL: string;
  MIDSCENE_MODEL_NAME: string;
  MIDSCENE_MODEL_FAMILY: string;
}

/**
 * Reads Midscene-related environment variables from process.env and returns
 * them as a typed object. Midscene uses these directly from process.env.
 * Note: MIDSCENE_MODEL_API_KEY has no default and is undefined if missing.
 */
export function midsceneEnv(): MidsceneEnv {
  return {
    MIDSCENE_MODEL_API_KEY: process.env.MIDSCENE_MODEL_API_KEY || undefined,
    MIDSCENE_MODEL_BASE_URL:
      process.env.MIDSCENE_MODEL_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    MIDSCENE_MODEL_NAME: process.env.MIDSCENE_MODEL_NAME || 'gemini-3.5-flash-lite',
    MIDSCENE_MODEL_FAMILY: process.env.MIDSCENE_MODEL_FAMILY || 'gemini',
  };
}
