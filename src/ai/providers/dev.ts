import { ProviderUnavailableError, type AIProvider, type MessageResult, type StructuredResult } from "./types";

/**
 * DEVELOPMENT PROVIDER — makes no network calls.
 *
 * Every agent ships a deterministic heuristic; when this provider is active the agent
 * runtime uses that heuristic directly and records the run with provider "dev-heuristic".
 * This keeps the demo fully functional without an API key, and is clearly labelled in the UI.
 */
export class DevHeuristicProvider implements AIProvider {
  readonly id = "dev-heuristic";
  readonly live = false;

  generateStructuredObject<T>(): Promise<StructuredResult<T>> {
    return Promise.reject(new ProviderUnavailableError());
  }
  generateMessage(): Promise<MessageResult> {
    return Promise.reject(new ProviderUnavailableError());
  }
  summarize(): Promise<MessageResult> {
    return Promise.reject(new ProviderUnavailableError());
  }
}
