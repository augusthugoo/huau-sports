import { useEffect, useState } from "react";
import { HUAU_FOUNDATION_VERSION } from "@huau/core";

type Health = {
  ok: boolean;
  env?: string;
  version?: string;
};

export function App() {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then(async (response) => (await response.json()) as Health)
      .then((data) => {
        if (active) setHealth(data);
      })
      .catch(() => {
        if (active) setHealth({ ok: false });
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <section className="hero">
        <div className="eyebrow">Foundation / Phase 0</div>
        <h1>HUAU Sports</h1>
        <p>
          Base técnica del ecosistema HUAU: Club, Tournament y Ref sobre una identidad y una
          arquitectura Cloudflare-first.
        </p>
        <div className="status-row">
          <span className="status-dot" data-online={health?.ok === true} />
          <span data-testid="api-health">
            {health === null ? "API checking" : health.ok ? "API online" : "API unavailable"}
          </span>
        </div>
      </section>

      <section className="grid" aria-label="Foundation modules">
        <article>
          <span>01</span>
          <h2>Club</h2>
          <p>Membership, courts, reservations, community and open matches.</p>
        </article>
        <article>
          <span>02</span>
          <h2>Tournament</h2>
          <p>Configurable competition engine, teams, registrations and live operations.</p>
        </article>
        <article>
          <span>03</span>
          <h2>Ref</h2>
          <p>Dedicated, resilient court-side scoring experience inside Tournament.</p>
        </article>
      </section>

      <footer>
        <span>{HUAU_FOUNDATION_VERSION}</span>
        <span>{health?.env ?? "local"}</span>
      </footer>
    </main>
  );
}
