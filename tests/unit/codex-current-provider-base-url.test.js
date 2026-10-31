import { describe, expect, it } from "vitest";
import { getCurrentCodexProviderBaseUrl, getCurrentCodexProviderSettings } from "../../src/app/(dashboard)/dashboard/cli-tools/components/codexConfig.js";

describe("Codex current provider base URL", () => {
  it("uses the base URL from the configured model provider, not an earlier provider", () => {
    const config = `model = "gpt-5"
model_provider = "kyorouter"

[model_providers.omniroute]
base_url = "https://omniroute.example/v1"

[model_providers.kyorouter]
base_url = "http://127.0.0.1:20128/v1"
`;

    expect(getCurrentCodexProviderBaseUrl(config)).toBe("http://127.0.0.1:20128/v1");
  });

  it("reads the active provider URL and bearer key when another provider appears first", () => {
    const config = `model_provider = "kyorouter"

[model_providers.omniroute]
base_url = "https://omniroute.example/v1"

[model_providers.omniroute.http_headers]
Authorization = "Bearer placeholder-omniroute-key"

[model_providers.kyorouter]
base_url = "https://kyorouter.example/v1/"

[model_providers.kyorouter.http_headers]
Authorization = "Bearer placeholder-kyorouter-key"
`;

    expect(getCurrentCodexProviderSettings(config)).toEqual({
      baseUrl: "https://kyorouter.example/v1/",
      apiKey: "placeholder-kyorouter-key",
    });
  });

  it("returns empty settings when no active provider is configured", () => {
    expect(getCurrentCodexProviderSettings("model = \"gpt-5\"\n")).toEqual({ baseUrl: "", apiKey: "" });
  });
});
