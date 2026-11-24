import { DSH_WEB_HOST, DSH_WEB_PORT } from "./constants.ts";

/** Test whether a URL targets the local DSH Web endpoint. */
export function isLocalServiceEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      url.hostname === DSH_WEB_HOST &&
      url.port === String(DSH_WEB_PORT) &&
      (url.pathname === "" || url.pathname === "/");
  } catch {
    return false;
  }
}

/** Test whether the local-service profile should follow a newly authenticated URL. */
export function shouldSyncLocalServiceUrl(currentUrl: string, latestUrl: string): boolean {
  return isLocalServiceEndpoint(currentUrl) &&
    isLocalServiceEndpoint(latestUrl) &&
    currentUrl !== latestUrl;
}
