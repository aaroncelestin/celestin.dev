import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { CONTACT_LIMITS, SERVICE_OPTIONS } from "./contact-options.js";
import TurnstileWidget from "./TurnstileWidget.jsx";

const EMPTY_FORM = Object.freeze({
  name: "",
  company: "",
  email: "",
  service: "",
  message: "",
  website: "",
});

const GENERIC_ERROR = "We could not send your request. Please try again later.";

export default function ContactForm({
  fetchImpl = fetch,
  siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [resetSignal, setResetSignal] = useState(0);
  const [status, setStatus] = useState({ phase: "idle", message: "" });

  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (status.phase === "submitting") {
      return;
    }
    if (!turnstileToken) {
      setStatus({ phase: "error", message: "Please verify that you are human and try again." });
      return;
    }

    setStatus({ phase: "submitting", message: "Sending your request…" });
    try {
      const response = await fetchImpl("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken }),
      });

      let responseBody = {};
      try {
        responseBody = await response.json();
      } catch {
        responseBody = {};
      }

      if (!response.ok || responseBody.ok !== true) {
        throw new Error(typeof responseBody.error === "string" ? responseBody.error : GENERIC_ERROR);
      }

      setForm(EMPTY_FORM);
      setTurnstileToken("");
      setResetSignal((value) => value + 1);
      setStatus({
        phase: "success",
        message: "Your request was sent. We’ll be in touch soon.",
      });
    } catch (error) {
      setTurnstileToken("");
      setResetSignal((value) => value + 1);
      setStatus({
        phase: "error",
        message: error instanceof Error && error.message ? error.message : GENERIC_ERROR,
      });
    }
  };

  const disabled = status.phase === "submitting";

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="field-row">
        <label>
          Name
          <input required maxLength={CONTACT_LIMITS.name} name="name" value={form.name} onChange={updateField} placeholder="Your name" disabled={disabled} />
        </label>
        <label>
          Company
          <input maxLength={CONTACT_LIMITS.company} name="company" value={form.company} onChange={updateField} placeholder="Company name" disabled={disabled} />
        </label>
      </div>
      <label>
        Email
        <input required maxLength={CONTACT_LIMITS.email} type="email" name="email" value={form.email} onChange={updateField} placeholder="you@company.com" disabled={disabled} />
      </label>
      <label>
        What can we help with?
        <select required name="service" value={form.service} onChange={updateField} disabled={disabled}>
          <option value="" disabled>Select a service</option>
          {SERVICE_OPTIONS.map((service) => <option key={service}>{service}</option>)}
        </select>
      </label>
      <label>
        Message
        <textarea required maxLength={CONTACT_LIMITS.message} name="message" rows="5" value={form.message} onChange={updateField} placeholder="Tell us about your environment or project." disabled={disabled} />
      </label>
      <label className="honeypot-field" aria-hidden="true">
        Website
        <input maxLength={CONTACT_LIMITS.website} name="website" value={form.website} onChange={updateField} tabIndex={-1} autoComplete="off" />
      </label>
      <TurnstileWidget siteKey={siteKey} onToken={setTurnstileToken} resetSignal={resetSignal} />
      <button className="button primary submit-button" type="submit" disabled={disabled}>
        {disabled ? "Sending…" : "Send Request"}
        {!disabled && <ArrowRight size={18} />}
      </button>
      {status.message && (
        <p
          className={`form-status ${status.phase}`}
          role={status.phase === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {status.message}
        </p>
      )}
      <small className="form-note">Your information is used only to respond to this request.</small>
    </form>
  );
}
