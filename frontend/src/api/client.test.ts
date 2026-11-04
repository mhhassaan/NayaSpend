import { describe, expect, test } from "vitest";
import { apiClient } from "./client";

describe("apiClient", () => {
  test("is constructed with routes from the backend's AppType", () => {
    expect(apiClient).toBeDefined();
    expect(apiClient.transactions).toBeDefined();
  });
});
