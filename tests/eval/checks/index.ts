import type { CheckHandler, CheckType } from "../lib/types";
import { fileExistsCheck, fileNotExistsCheck } from "./file-exists";
import {
  contentMatchesCheck,
  contentMatchesGlobCheck,
  contentNotMatchesCheck,
  contentNotMatchesGlobCheck,
} from "./content-matches";
import { buildSucceedsCheck } from "./build-succeeds";
import { lintPassesCheck } from "./lint-passes";
import { typeCheckPassesCheck } from "./type-check-passes";
import { httpRequestCheck } from "./http-response";
import { browserVisibleCheck } from "./browser-check";
import { browserInteractionCheck } from "./browser-interaction";

const registry = new Map<CheckType, CheckHandler>();

function register(handler: CheckHandler) {
  registry.set(handler.type, handler);
}

register(fileExistsCheck);
register(fileNotExistsCheck);
register(contentMatchesCheck);
register(contentNotMatchesCheck);
register(contentMatchesGlobCheck);
register(contentNotMatchesGlobCheck);
register(buildSucceedsCheck);
register(lintPassesCheck);
register(typeCheckPassesCheck);
register(httpRequestCheck);
register(browserVisibleCheck);
register(browserInteractionCheck);

export function getCheckHandler(type: CheckType): CheckHandler | undefined {
  return registry.get(type);
}

export function getRegisteredTypes(): CheckType[] {
  return [...registry.keys()];
}
