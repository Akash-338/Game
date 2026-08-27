import { describe, expect, it, vi } from "vitest";
import { configureProductionStaticRouting } from "./productionStaticRouting.js";

function appDouble() {
  return { use: vi.fn(), get: vi.fn() };
}

describe("configureProductionStaticRouting", () => {
  it("serves the SPA only when the generated frontend bundle exists", () => {
    const app = appDouble();
    const staticMiddleware = vi.fn(() => "static-middleware");
    configureProductionStaticRouting(app, {
      projectRoot: "/project",
      staticMiddleware,
      fileExists: vi.fn(() => true)
    });

    expect(staticMiddleware).toHaveBeenCalledWith("/project/dist/public");
    expect(app.use).toHaveBeenCalledWith("static-middleware");
    const sendFile = vi.fn();
    app.get.mock.calls[0][1]({}, { sendFile });
    expect(sendFile).toHaveBeenCalledWith("/project/dist/public/index.html");
  });

  it("returns an intentional backend-only response when no frontend bundle is deployed", () => {
    const app = appDouble();
    const staticMiddleware = vi.fn();
    const result = configureProductionStaticRouting(app, {
      projectRoot: "/project",
      staticMiddleware,
      fileExists: vi.fn(() => false)
    });

    expect(result.frontendAvailable).toBe(false);
    expect(staticMiddleware).not.toHaveBeenCalled();
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    app.get.mock.calls[0][1]({}, { status });
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ok: false, error: expect.stringContaining("realtime backend") }));
  });
});
