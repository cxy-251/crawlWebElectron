import type { IncomingMessage } from "node:http";

export type JsonRecord = Record<string, unknown>;

export type LocalApiRequest = {
  request: IncomingMessage;
  method: string;
  url: URL;
  readJson(request: IncomingMessage): Promise<JsonRecord>;
};

export type LocalApiRouteResult =
  | {
      handled: true;
      statusCode: number;
      payload: unknown;
    }
  | {
      handled: false;
    };

export function routeHandled(statusCode: number, payload: unknown): LocalApiRouteResult {
  return { handled: true, statusCode, payload };
}

export function routeNotHandled(): LocalApiRouteResult {
  return { handled: false };
}
