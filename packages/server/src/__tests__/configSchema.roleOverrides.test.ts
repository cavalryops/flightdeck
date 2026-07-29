import { describe, it, expect } from "vitest";
import { flightdeckConfigSchema } from "../config/configSchema.js";

describe("flightdeckConfigSchema — per-role backend overrides", () => {
  it("parses provider/envOverride/extraArgs under roles:", () => {
    const parsed = flightdeckConfigSchema.parse({
      provider: { id: "copilot" },
      roles: {
        developer: {
          provider: "copilot",
          envOverride: {
            COPILOT_PROVIDER_BASE_URL: "http://127.0.0.1:8090/v1",
            COPILOT_MODEL: "qwen3.6-35b-a3b",
          },
          extraArgs: ["--additional-mcp-config", "@/repo/.mcp.json"],
        },
        architect: { provider: "copilot" },
      },
    });
    expect(parsed.roles.developer.provider).toBe("copilot");
    expect(parsed.roles.developer.envOverride).toEqual({
      COPILOT_PROVIDER_BASE_URL: "http://127.0.0.1:8090/v1",
      COPILOT_MODEL: "qwen3.6-35b-a3b",
    });
    expect(parsed.roles.developer.extraArgs).toEqual(["--additional-mcp-config", "@/repo/.mcp.json"]);
    expect(parsed.roles.architect.envOverride).toBeUndefined();
  });
});
