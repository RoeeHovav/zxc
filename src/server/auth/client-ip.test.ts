import { afterEach, describe, expect, it } from "vitest";
import { clientIp } from "./session";

const headers = (xff?: string, realIp?: string) => new Headers({ ...(xff ? { "x-forwarded-for": xff } : {}), ...(realIp ? { "x-real-ip": realIp } : {}) });

describe("clientIp", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("ignores forwarding headers unless running behind a trusted proxy", () => {
    expect(clientIp(headers("1.2.3.4", "5.6.7.8"))).toBeNull();
  });

  it("uses the proxy-appended (last) address, not the client-supplied first one", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientIp(headers("6.6.6.6, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(headers("203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(headers(undefined, "5.6.7.8"))).toBeNull();
  });
});
