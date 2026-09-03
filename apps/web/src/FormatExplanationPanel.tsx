import {
  explainStandardFormatConfig,
  explainTeamFormat,
  parseTeamFormat,
  type FormatExplanation,
} from "@huau/core";
import type { Locale } from "./i18n";

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

export function explanationForPersistedFormat(
  formatKind: string | null | undefined,
  formatConfig: unknown,
  locale: Locale,
): FormatExplanation | null {
  if (!formatKind || formatConfig === null || formatConfig === undefined) return null;
  try {
    if (formatKind === "team") return explainTeamFormat(parseTeamFormat(formatConfig), locale);
    if (formatKind === "standard") return explainStandardFormatConfig(formatConfig, locale);
  } catch {
    return null;
  }
  return null;
}

export function FormatExplanationPanel({
  explanation,
  locale,
  compact = false,
  title,
}: {
  explanation: FormatExplanation;
  locale: Locale;
  compact?: boolean;
  title?: string;
}) {
  return (
    <section className={`official-format-explanation${compact ? " compact" : ""}`}>
      <div className="official-format-explanation-head">
        <div>
          <div className="eyebrow">FORMAT EXPLANATION</div>
          <h3>{title ?? tr(locale, "Cómo se juega", "How it works")}</h3>
        </div>
        <span className="pill strong">{tr(locale, "OFICIAL · AUTO", "OFFICIAL · AUTO")}</span>
      </div>
      <div className="official-format-explanation-summary">
        {explanation.summary.map((paragraph, index) => <p key={`${explanation.kind}-summary-${index}`}>{paragraph}</p>)}
      </div>
      <details className="official-format-explanation-details">
        <summary>{tr(locale, "Ver criterios y reglas", "View criteria and rules")}</summary>
        <div className="official-format-explanation-sections">
          {explanation.sections.map((section) => (
            <article key={section.id}>
              <h4>{section.title}</h4>
              {section.paragraphs.map((paragraph, index) => <p key={`${section.id}-p-${index}`}>{paragraph}</p>)}
              {section.items.length > 0 && <ol>{section.items.map((item, index) => <li key={`${section.id}-i-${index}`}>{item}</li>)}</ol>}
            </article>
          ))}
        </div>
      </details>
      <small className="official-format-explanation-integrity">
        {tr(
          locale,
          "Este texto se genera desde la configuración competitiva guardada y no se edita manualmente.",
          "This text is generated from the saved competition configuration and is not manually edited.",
        )}
      </small>
    </section>
  );
}
