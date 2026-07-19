import type { Request } from "express";

export function requestPath(req: Pick<Request, "baseUrl" | "path">): string {
  const path = req.path || "/";
  if (!req.baseUrl) return path;
  return path === "/" ? req.baseUrl : `${req.baseUrl}${path}`;
}

export function normalizedRequestEndpoint(
  req: Pick<Request, "baseUrl" | "path" | "route">
): string {
  const routePath = req.route?.path;
  if (typeof routePath !== "string") return requestPath(req);
  if (req.baseUrl) return routePath === "/" ? req.baseUrl : `${req.baseUrl}${routePath}`;

  // Express restores baseUrl while unwinding an errored mounted router, but leaves
  // req.route behind. Reconstruct the mount prefix by replacing the matching number of
  // concrete path segments with the parameterized route segments.
  const pathSegments = requestPath(req).split("/").filter(Boolean);
  const routeSegments = routePath.split("/").filter(Boolean);
  if (!routeSegments.length || pathSegments.length < routeSegments.length) return requestPath(req);
  const mountSegments = pathSegments.slice(0, pathSegments.length - routeSegments.length);
  return `/${[...mountSegments, ...routeSegments].join("/")}`;
}

export function stripQueryString(value: string): string {
  const queryIndex = value.indexOf("?");
  return queryIndex === -1 ? value : value.slice(0, queryIndex);
}
