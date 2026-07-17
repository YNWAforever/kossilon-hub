// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WhatsAppIntegrationStatus } from "./settings";

afterEach(cleanup);

describe("WhatsAppIntegrationStatus", () => {
  it("labels simulated delivery and hides live binding details", () => {
    render(
      <WhatsAppIntegrationStatus
        status={{
          deliveryMode: "simulated",
          missingLiveEnvVars: [
            "WOZTELL_API_BASE_URL",
            "WOZTELL_ACCESS_TOKEN",
            "WOZTELL_CHANNEL_ID",
            "WOZTELL_WEBHOOK_SECRET",
          ],
        }}
      />,
    );

    expect(screen.getByText("Demo simulation")).toBeTruthy();
    expect(screen.getByText("No external WhatsApp or email message is sent.")).toBeTruthy();
    expect(screen.queryByText(/Missing bindings:/)).toBeNull();
  });

  it("shows missing live bindings only when delivery is blocked", () => {
    render(
      <WhatsAppIntegrationStatus
        status={{
          deliveryMode: "blocked",
          missingLiveEnvVars: ["WOZTELL_API_BASE_URL", "WOZTELL_CHANNEL_ID"],
        }}
      />,
    );

    expect(screen.getByText("Blocked")).toBeTruthy();
    expect(
      screen.getByText("Missing bindings: WOZTELL_API_BASE_URL, WOZTELL_CHANNEL_ID"),
    ).toBeTruthy();
  });

  it("shows configured without a demo notice for live delivery", () => {
    render(<WhatsAppIntegrationStatus status={{ deliveryMode: "live", missingLiveEnvVars: [] }} />);

    expect(screen.getByText("Configured")).toBeTruthy();
    expect(screen.queryByText("Demo simulation")).toBeNull();
    expect(screen.queryByText(/Missing bindings:/)).toBeNull();
  });
});
