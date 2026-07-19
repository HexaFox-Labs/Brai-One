import { describe, expect, it } from "vitest";

import { parseGuestProbeOutput } from "../src/trusted-provisioning-host.js";

describe("trusted provisioning host guest-probe protocol", () => {
  it("accepts only the known read-only PATH alias warning before one JSON line", () => {
    expect(
      parseGuestProbeOutput(
        [
          "WARNING: proceeding, even though we could not create PATH aliases: Read-only file system (os error 30)\r",
          '{"persistenceRoot":"/data"}\r',
          "",
        ].join("\n"),
      ),
    ).toEqual({ persistenceRoot: "/data" });
  });

  it("rejects any other prefix or extra output", () => {
    expect(() =>
      parseGuestProbeOutput(
        'unexpected warning\n{"persistenceRoot":"/data"}\n',
      ),
    ).toThrow("guest runtime probe did not return valid JSON");
    expect(() =>
      parseGuestProbeOutput(
        [
          "WARNING: proceeding, even though we could not create PATH aliases: Read-only file system (os error 30)",
          '{"persistenceRoot":"/data"}',
          "extra",
        ].join("\n"),
      ),
    ).toThrow("guest runtime probe did not return valid JSON");
  });
});
