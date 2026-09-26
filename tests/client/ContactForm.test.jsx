// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactForm from "../../src/ContactForm.jsx";

let turnstileOptions;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function fillValidForm(user) {
  await user.type(screen.getByLabelText(/^name/i), "Jane Smith");
  await user.type(screen.getByLabelText(/^company/i), "Example Co");
  await user.type(screen.getByLabelText(/^email/i), "jane@example.com");
  await user.selectOptions(screen.getByLabelText(/what can we help with/i), "Cloud Security");
  await user.type(screen.getByLabelText(/^message/i), "Please review our AWS environment.");
}

function solveCaptcha(token = "captcha-token") {
  act(() => turnstileOptions.callback(token));
}

describe("ContactForm", () => {
  beforeEach(() => {
    turnstileOptions = undefined;
    window.turnstile = {
      render: vi.fn((_element, options) => {
        turnstileOptions = options;
        return "widget-1";
      }),
      reset: vi.fn(),
      remove: vi.fn(),
    };
  });

  afterEach(() => {
    cleanup();
    delete window.turnstile;
  });

  it("submits exact JSON and disables duplicate submission", async () => {
    const pending = deferred();
    const fetchImpl = vi.fn(() => pending.promise);
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);
    solveCaptcha();

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/contact");
    expect(options).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(options.body)).toEqual({
      name: "Jane Smith",
      company: "Example Co",
      email: "jane@example.com",
      service: "Cloud Security",
      message: "Please review our AWS environment.",
      website: "",
      turnstileToken: "captcha-token",
    });
    expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /sending/i }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    pending.resolve({ ok: true, json: async () => ({ ok: true }) });
    await screen.findByText(/request was sent/i);
  });

  it("blocks submission until CAPTCHA is complete", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/verify that you are human/i);
  });

  it("preserves values and shows an accessible error after HTTP failure", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      json: async () => ({ ok: false, error: "Too many requests. Please try again later." }),
    }));
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);
    solveCaptcha();
    const resetsBeforeSubmit = window.turnstile.reset.mock.calls.length;

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many requests");
    expect(screen.getByLabelText(/^name/i)).toHaveValue("Jane Smith");
    expect(screen.getByLabelText(/^message/i)).toHaveValue("Please review our AWS environment.");
    await waitFor(() => {
      expect(window.turnstile.reset.mock.calls.length).toBeGreaterThan(resetsBeforeSubmit);
    });
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses a generic error when the response is malformed", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => { throw new Error("bad json"); } }));
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);
    solveCaptcha();

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not send your request/i);
  });

  it("resets fields and invalidates the CAPTCHA token after success", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);
    solveCaptcha();
    const resetsBeforeSubmit = window.turnstile.reset.mock.calls.length;

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByText(/request was sent/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name/i)).toHaveValue("");
    expect(screen.getByLabelText(/^company/i)).toHaveValue("");
    expect(screen.getByLabelText(/^email/i)).toHaveValue("");
    expect(screen.getByLabelText(/^message/i)).toHaveValue("");
    await waitFor(() => {
      expect(window.turnstile.reset.mock.calls.length).toBeGreaterThan(resetsBeforeSubmit);
    });
  });

  it("clears an expired or failed CAPTCHA token", async () => {
    const fetchImpl = vi.fn();
    const user = userEvent.setup();
    render(<ContactForm fetchImpl={fetchImpl} siteKey="site-key" />);
    await fillValidForm(user);
    solveCaptcha();
    act(() => turnstileOptions["expired-callback"]());

    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/verify that you are human/i);
  });
});
