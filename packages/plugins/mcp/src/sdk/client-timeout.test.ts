import { describe, expect, it } from "@effect/vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";

describe("MCP SDK callTool timeout", () => {
  it("uses a ten-minute timeout when the caller does not provide request options", async () => {
    const client = new Client({ name: "timeout-test", version: "0.0.0" });
    let requestOptions: unknown;

    Object.defineProperty(client, "request", {
      value: async (_request: unknown, _resultSchema: unknown, options: unknown) => {
        requestOptions = options;
        return { content: [] };
      },
    });

    await client.callTool({ name: "slow_tool", arguments: {} });

    expect(requestOptions).toEqual({ timeout: 10 * 60 * 1_000 });
  });
});
