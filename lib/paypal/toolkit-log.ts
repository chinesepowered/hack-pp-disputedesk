/**
 * @paypal/agent-toolkit makes its own HTTP calls through the default axios instance. This
 * interceptor records them in the same call log as the SDK and REST calls, so tool calls made
 * by the agent also show up in the Under the hood drawer with their PayPal-Debug-Id.
 */
import path from "node:path";
import axiosImported from "axios";
import { displayPath, recordCall } from "./log";

let installed = false;

/**
 * axios ships two builds. The toolkit is CommonJS and loads the require() build; this app's
 * server bundle loads the import build. They are separate instances with separate
 * interceptors, so the logging goes on both.
 */
function axiosInstances(): any[] {
  const list: any[] = [axiosImported];
  try {
    // Reached through process.getBuiltinModule so the bundler leaves it as a real require().
    const nodeModule = (process as any).getBuiltinModule?.("node:module");
    if (!nodeModule) return list;
    const load = nodeModule.createRequire(path.join(process.cwd(), "package.json"));
    const required = load("axios");
    const instance = required?.default ?? required;
    if (instance?.interceptors && !list.includes(instance)) list.push(instance);
  } catch {
    // Only one build is installed: the import above is the one the toolkit uses.
  }
  return list;
}

export function installToolkitLogging(): void {
  if (installed) return;
  installed = true;
  for (const axios of axiosInstances()) attach(axios);
}

function attach(axios: any): void {
  axios.interceptors.request.use((config: any) => {
    config.__startedAt = Date.now();
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
    (res: any) => {
      log(res.config, res.status, res.headers);
      return res;
    },
    (err: any) => {
      log(err?.config, err?.response?.status ?? 0, err?.response?.headers);
      return Promise.reject(err);
    },
  );
}
