/**
 * @paypal/agent-toolkit makes its own HTTP calls through the default axios instance. This
 * interceptor records them in the same call log as the SDK and REST calls, so tool calls made
 * by the agent also show up in the Under the hood drawer with their PayPal-Debug-Id.
 */
import axios from "axios";
import { displayPath, recordCall } from "./log";

let installed = false;

export function installToolkitLogging(): void {
  if (installed) return;
  installed = true;
  axios.interceptors.request.use((config) => {
    (config as any).__startedAt = Date.now();
    return config;
  });
  const log = (config: any, status: number, headers: any) => {
    const url = String(config?.url ?? "");
    if (!/paypal\.com/.test(url)) return;
    recordCall({
      method: String(config?.method ?? "get").toUpperCase(),
      path: displayPath(url),
      status,
      debugId: headers?.["paypal-debug-id"] ?? null,
      ms: Date.now() - (config?.__startedAt ?? Date.now()),
      via: "toolkit",
      feature: /oauth2\/token/.test(url) ? "OAuth token (agent toolkit)" : undefined,
    });
  };
  axios.interceptors.response.use(
    (res) => {
      log(res.config, res.status, res.headers);
      return res;
    },
    (err) => {
      log(err?.config, err?.response?.status ?? 0, err?.response?.headers);
      return Promise.reject(err);
    },
  );
}
