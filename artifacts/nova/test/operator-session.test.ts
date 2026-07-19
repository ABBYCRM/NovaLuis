import { beforeEach, describe, expect, it, vi } from "vitest";

function responseDouble() {
  const state: {
    status: number;
    body: unknown;
    cookie: { name: string; value: string; options: Record<string, unknown> } | null;
  } = { status: 200, body: null, cookie: null };

  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
    cookie(name: string, value: string, options: Record<string, unknown>) {
      state.cookie = { name, value, options };
      return response;
    },
    clearCookie() {
      return response;
    },
  };
  return { response, state };
}

describe("operator workspace session", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NODE_ENV = "test";
    process.env.SESSION_SECRET = "test-session-secret-that-is-not-public";
    process.env.NOVA_WORK_TREE_PIN = "22";
    process.env.NOVA_API_TOKEN = "test-server-token";
  });

  it("issues an HttpOnly cookie and accepts it on protected API middleware", async () => {
    const session = await import("../../api-server/src/lib/operator-session");
    const auth = await import("../../api-server/src/lib/api-auth");
    const { response, state } = responseDouble();

    session.handleOperatorUnlock(
      {
        body: { pin: "22" },
        ip: "127.0.0.1",
        socket: { remoteAddress: "127.0.0.1" },
        headers: {},
      } as never,
      response as never,
    );

    expect(state.status).toBe(200);
    expect(state.cookie?.name).toBe("nova_operator_session");
    expect(state.cookie?.options.httpOnly).toBe(true);
    expect(state.cookie?.options.path).toBe("/api");
    expect(state.cookie?.value).toMatch(/^\d+\.[a-f0-9]{64}$/);

    const next = vi.fn();
    const protectedResponse = responseDouble();
    auth.requireApiAuth(
      {
        headers: { cookie: `nova_operator_session=${state.cookie?.value}` },
        query: {},
      } as never,
      protectedResponse.response as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(protectedResponse.state.body).toBeNull();
  });

  it("preserves token query authentication for existing image elements", async () => {
    const auth = await import("../../api-server/src/lib/api-auth");
    const next = vi.fn();
    const { response, state } = responseDouble();

    auth.requireApiAuth(
      {
        headers: {},
        query: { token: "test-server-token" },
      } as never,
      response as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(state.body).toBeNull();
  });

  it("rejects a wrong PIN without creating a session", async () => {
    const session = await import("../../api-server/src/lib/operator-session");
    const { response, state } = responseDouble();

    session.handleOperatorUnlock(
      {
        body: { pin: "wrong" },
        ip: "127.0.0.2",
        socket: { remoteAddress: "127.0.0.2" },
        headers: {},
      } as never,
      response as never,
    );

    expect(state.status).toBe(403);
    expect(state.cookie).toBeNull();
    expect(state.body).toEqual({ error: "wrong PIN" });
  });
});
