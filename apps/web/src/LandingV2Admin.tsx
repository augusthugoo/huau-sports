import { useCallback, useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Locale } from "./i18n";
import type {
  LandingLocalizedText,
  LandingV2AssetId,
  LandingV2AssetModes,
  LandingV2EditableContent,
} from "./LandingV2Content";
import { landingV2AssetIds } from "./LandingV2Content";
import "./LandingV2Admin.css";

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

type StoredLanding = {
  version: 1;
  content: LandingV2EditableContent;
  assets: LandingV2AssetModes;
  updatedAt: number;
  publishedAt?: number;
};

type AssetState = {
  mode: "default" | "custom";
  publishedMode: "default" | "custom";
  draftUploaded: boolean;
  publishedCustom: boolean;
  previewUrl: string;
  defaultUrl: string;
};

type AdminState = {
  ok: true;
  draft: StoredLanding;
  published: StoredLanding;
  assets: Record<LandingV2AssetId, AssetState>;
  dirty: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload;
}

function setLocalized(
  current: LandingV2EditableContent,
  path: string[],
  locale: "es" | "en",
  value: string,
): LandingV2EditableContent {
  const next = structuredClone(current);
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  const leaf = path[path.length - 1]!;
  const localized = target[leaf] as LandingLocalizedText;
  target[leaf] = { ...localized, [locale]: value };
  return next;
}

function setText(current: LandingV2EditableContent, path: string[], value: string): LandingV2EditableContent {
  const next = structuredClone(current);
  let target: Record<string, unknown> = next as unknown as Record<string, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string, unknown>;
  target[path[path.length - 1]!] = value;
  return next;
}

function L10nField({
  label,
  value,
  multiline = false,
  onChange,
}: {
  label: string;
  value: LandingLocalizedText;
  multiline?: boolean;
  onChange: (locale: "es" | "en", value: string) => void;
}) {
  return (
    <div className="lv2-admin-l10n">
      <label>
        <span>{label} · ES</span>
        {multiline ? (
          <textarea value={value.es} rows={3} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange("es", event.target.value)} />
        ) : (
          <input value={value.es} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange("es", event.target.value)} />
        )}
      </label>
      <label>
        <span>{label} · EN</span>
        {multiline ? (
          <textarea value={value.en} rows={3} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange("en", event.target.value)} />
        ) : (
          <input value={value.en} onChange={(event: ChangeEvent<HTMLInputElement>) => onChange("en", event.target.value)} />
        )}
      </label>
    </div>
  );
}

const assetLabels: Record<LandingV2AssetId, [string, string]> = {
  heroPoster: ["Poster del hero", "Hero poster"],
  heroVideoMobile: ["Video hero · mobile", "Hero video · mobile"],
  heroVideoDesktop: ["Video hero · desktop", "Hero video · desktop"],
  journey1: ["Imagen · Inscripciones", "Image · Registration"],
  journey2: ["Imagen · Cronograma", "Image · Schedule"],
  journey3: ["Imagen · Competencia", "Image · Competition"],
  journey4: ["Imagen · Resultados", "Image · Results"],
  scenePoster: ["Poster del segundo video", "Second video poster"],
  sceneVideoMobile: ["Segundo video · mobile", "Second video · mobile"],
  sceneVideoDesktop: ["Segundo video · desktop", "Second video · desktop"],
  personPhoto: ["Foto · Quién está detrás", "Photo · Who is behind it"],
};

const isVideo = (id: LandingV2AssetId) => id.includes("Video");

function CmsSection({ title, hint, children, open = false }: { title: string; hint?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="lv2-admin-section" open={open}>
      <summary>
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </summary>
      <div className="lv2-admin-section-body">{children}</div>
    </details>
  );
}

export function LandingV2Admin({ locale }: { locale: Locale }) {
  const [state, setState] = useState<AdminState | null>(null);
  const [draft, setDraft] = useState<LandingV2EditableContent | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const next = await api<AdminState>("/api/platform/landing/v2");
      setState(next);
      setDraft(next.draft.content);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_ADMIN_LOAD_FAILED");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const persistDraft = async (silent = false) => {
    if (!draft) return false;
    if (!silent) { setBusy("save"); setMessage(""); }
    try {
      await api("/api/platform/landing/v2/draft", {
        method: "PUT",
        body: JSON.stringify({ content: draft }),
      });
      if (!silent) {
        await load();
        setMessage(tr(locale, "Borrador guardado.", "Draft saved."));
      }
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_DRAFT_SAVE_FAILED");
      return false;
    } finally {
      if (!silent) setBusy("");
    }
  };

  const preview = async () => {
    const previewWindow = window.open("about:blank", "_blank");
    setBusy("preview");
    const saved = await persistDraft(true);
    setBusy("");
    if (!saved) {
      previewWindow?.close();
      return;
    }
    if (previewWindow) previewWindow.location.href = "/?landingDraft=1";
    else window.location.href = "/?landingDraft=1";
  };

  const publish = async () => {
    setBusy("publish");
    setMessage("");
    try {
      if (!(await persistDraft(true))) return;
      await api("/api/platform/landing/v2/publish", { method: "POST", body: "{}" });
      await load();
      setMessage(tr(locale, "Landing publicada.", "Landing published."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_PUBLISH_FAILED");
    } finally {
      setBusy("");
    }
  };

  const resetDraft = async () => {
    if (!window.confirm(tr(locale, "¿Descartar el borrador y volver a lo publicado?", "Discard the draft and restore the published version?"))) return;
    setBusy("reset");
    setMessage("");
    try {
      await api("/api/platform/landing/v2/reset", { method: "POST", body: "{}" });
      await load();
      setMessage(tr(locale, "Borrador descartado.", "Draft discarded."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_RESET_FAILED");
    } finally {
      setBusy("");
    }
  };

  const uploadAsset = async (id: LandingV2AssetId, event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file || !draft) return;
    setBusy(`asset:${id}`);
    setMessage("");
    try {
      if (!(await persistDraft(true))) return;
      const response = await fetch(`/api/platform/landing/v2/assets/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      const payload = await response.json() as { code?: string };
      if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
      await load();
      setMessage(tr(locale, "Asset cargado al borrador. Publicá para hacerlo visible.", "Asset uploaded to the draft. Publish to make it live."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_ASSET_UPLOAD_FAILED");
    } finally {
      input.value = "";
      setBusy("");
    }
  };

  const resetAsset = async (id: LandingV2AssetId) => {
    if (!draft) return;
    setBusy(`asset:${id}`);
    setMessage("");
    try {
      if (!(await persistDraft(true))) return;
      await api(`/api/platform/landing/v2/assets/${encodeURIComponent(id)}`, { method: "DELETE", body: "{}" });
      await load();
      setMessage(tr(locale, "Asset restaurado al original en el borrador.", "Asset restored to the original in the draft."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "LANDING_V2_ASSET_RESET_FAILED");
    } finally {
      setBusy("");
    }
  };

  if (!state || !draft) return <div className="lv2-admin-loading">{tr(locale, "Cargando CMS…", "Loading CMS…")}</div>;

  const updateL10n = (path: string[], lang: "es" | "en", value: string) => setDraft((current) => current ? setLocalized(current, path, lang, value) : current);
  const updateText = (path: string[], value: string) => setDraft((current) => current ? setText(current, path, value) : current);
  const localDirty = state.dirty || JSON.stringify(draft) !== JSON.stringify(state.published.content);

  return (
    <div className="lv2-admin-cms">
      <div className="lv2-admin-toolbar">
        <div>
          <div className="lv2-admin-kicker">LANDING V2</div>
          <h3>{tr(locale, "Contenido y medios", "Content and media")}</h3>
          <p>{tr(locale, "Editá el contenido sin tocar la estructura visual. Los cambios no llegan a producción hasta Publicar.", "Edit content without changing the visual structure. Changes do not go live until Publish.")}</p>
        </div>
        <div className="lv2-admin-toolbar-actions">
          <button type="button" className="ghost small" disabled={Boolean(busy)} onClick={() => void resetDraft()}>{tr(locale, "Descartar", "Discard")}</button>
          <button type="button" className="ghost small" disabled={Boolean(busy)} onClick={() => void preview()}>{busy === "preview" ? "…" : tr(locale, "Vista previa", "Preview")}</button>
          <button type="button" className="ghost small" disabled={Boolean(busy)} onClick={() => void persistDraft()}>{busy === "save" ? "…" : tr(locale, "Guardar borrador", "Save draft")}</button>
          <button type="button" className="light small" disabled={Boolean(busy)} onClick={() => void publish()}>{busy === "publish" ? "…" : tr(locale, "Publicar", "Publish")}</button>
        </div>
      </div>

      <div className="lv2-admin-status">
        <span>{localDirty ? tr(locale, "Hay cambios en borrador", "Draft has unpublished changes") : tr(locale, "Borrador alineado con producción", "Draft matches production")}</span>
        {state.published.publishedAt && <small>{tr(locale, "Última publicación", "Last published")}: {new Intl.DateTimeFormat(locale === "es" ? "es-UY" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.published.publishedAt))}</small>}
      </div>

      <CmsSection title="Hero" hint={tr(locale, "Texto, videos y poster", "Copy, videos and poster")} open>
        <L10nField label={tr(locale, "Título", "Title")} value={draft.hero.title} onChange={(lang, value) => updateL10n(["hero", "title"], lang, value)} />
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.hero.body} multiline onChange={(lang, value) => updateL10n(["hero", "body"], lang, value)} />
        <L10nField label="CTA" value={draft.hero.cta} onChange={(lang, value) => updateL10n(["hero", "cta"], lang, value)} />
        <AssetGrid ids={["heroPoster", "heroVideoMobile", "heroVideoDesktop"]} locale={locale} state={state} busy={busy} onUpload={uploadAsset} onReset={resetAsset} />
      </CmsSection>

      <CmsSection title={tr(locale, "Torneos", "Tournaments")}>
        <L10nField label={tr(locale, "Título", "Title")} value={draft.tournaments.title} onChange={(lang, value) => updateL10n(["tournaments", "title"], lang, value)} />
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.tournaments.body} multiline onChange={(lang, value) => updateL10n(["tournaments", "body"], lang, value)} />
        <L10nField label={tr(locale, "Pestaña próximos", "Upcoming tab")} value={draft.tournaments.upcoming} onChange={(lang, value) => updateL10n(["tournaments", "upcoming"], lang, value)} />
        <L10nField label={tr(locale, "Pestaña resultados", "Results tab")} value={draft.tournaments.results} onChange={(lang, value) => updateL10n(["tournaments", "results"], lang, value)} />
        <L10nField label={tr(locale, "Vacío próximos", "Upcoming empty state")} value={draft.tournaments.emptyUpcoming} onChange={(lang, value) => updateL10n(["tournaments", "emptyUpcoming"], lang, value)} />
        <L10nField label={tr(locale, "Vacío resultados", "Results empty state")} value={draft.tournaments.emptyResults} onChange={(lang, value) => updateL10n(["tournaments", "emptyResults"], lang, value)} />
      </CmsSection>

      <CmsSection title={tr(locale, "Contadores", "Counters")} hint={tr(locale, "Los valores numéricos se editan más abajo", "Numeric values are edited below")}>
        <L10nField label={tr(locale, "Etiqueta jugadores", "Players label")} value={draft.metrics.playersLabel} onChange={(lang, value) => updateL10n(["metrics", "playersLabel"], lang, value)} />
        <L10nField label={tr(locale, "Etiqueta partidos", "Matches label")} value={draft.metrics.matchesLabel} onChange={(lang, value) => updateL10n(["metrics", "matchesLabel"], lang, value)} />
        <label><span>{tr(locale, "Sufijo", "Suffix")}</span><input value={draft.metrics.suffix} maxLength={4} onChange={(event: ChangeEvent<HTMLInputElement>) => updateText(["metrics", "suffix"], event.target.value)} /></label>
      </CmsSection>

      <CmsSection title={tr(locale, "Cómo funciona", "How it works")} hint={tr(locale, "Las cuatro escenas del sticky", "The four sticky scenes")}>
        <L10nField label={tr(locale, "Título mobile", "Mobile heading")} value={draft.journey.heading} onChange={(lang, value) => updateL10n(["journey", "heading"], lang, value)} />
        <L10nField label={tr(locale, "Indicador de scroll", "Scroll hint")} value={draft.journey.keepScrolling} onChange={(lang, value) => updateL10n(["journey", "keepScrolling"], lang, value)} />
        {draft.journey.items.map((item, index) => (
          <div className="lv2-admin-journey-item" key={index}>
            <strong>{String(index + 1).padStart(2, "0")}</strong>
            <L10nField label={tr(locale, "Etiqueta", "Label")} value={item.label} onChange={(lang, value) => updateL10n(["journey", "items", String(index), "label"], lang, value)} />
            <L10nField label={tr(locale, "Título", "Title")} value={item.title} onChange={(lang, value) => updateL10n(["journey", "items", String(index), "title"], lang, value)} />
            <L10nField label={tr(locale, "Texto", "Body")} value={item.body} multiline onChange={(lang, value) => updateL10n(["journey", "items", String(index), "body"], lang, value)} />
          </div>
        ))}
        <AssetGrid ids={["journey1", "journey2", "journey3", "journey4"]} locale={locale} state={state} busy={busy} onUpload={uploadAsset} onReset={resetAsset} />
      </CmsSection>

      <CmsSection title={tr(locale, "Segundo video", "Second video")}>
        <L10nField label={tr(locale, "Título", "Title")} value={draft.scene.title} onChange={(lang, value) => updateL10n(["scene", "title"], lang, value)} />
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.scene.body} multiline onChange={(lang, value) => updateL10n(["scene", "body"], lang, value)} />
        <AssetGrid ids={["scenePoster", "sceneVideoMobile", "sceneVideoDesktop"]} locale={locale} state={state} busy={busy} onUpload={uploadAsset} onReset={resetAsset} />
      </CmsSection>

      <CmsSection title={tr(locale, "Quién está detrás", "Who is behind it")}>
        <L10nField label={tr(locale, "Título de sección", "Section title")} value={draft.person.sectionTitle} onChange={(lang, value) => updateL10n(["person", "sectionTitle"], lang, value)} />
        <L10nField label={tr(locale, "Etiqueta desktop", "Desktop kicker")} value={draft.person.kicker} onChange={(lang, value) => updateL10n(["person", "kicker"], lang, value)} />
        <L10nField label={tr(locale, "Título", "Headline")} value={draft.person.headline} onChange={(lang, value) => updateL10n(["person", "headline"], lang, value)} />
        <label><span>{tr(locale, "Nombre", "Name")}</span><input value={draft.person.name} onChange={(event: ChangeEvent<HTMLInputElement>) => updateText(["person", "name"], event.target.value)} /></label>
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.person.body} multiline onChange={(lang, value) => updateL10n(["person", "body"], lang, value)} />
        <L10nField label={tr(locale, "Conocer más", "Learn more")} value={draft.person.learnMore} onChange={(lang, value) => updateL10n(["person", "learnMore"], lang, value)} />
        <L10nField label={tr(locale, "Cerrar", "Close")} value={draft.person.close} onChange={(lang, value) => updateL10n(["person", "close"], lang, value)} />
        <AssetGrid ids={["personPhoto"]} locale={locale} state={state} busy={busy} onUpload={uploadAsset} onReset={resetAsset} />
      </CmsSection>

      <CmsSection title={tr(locale, "Organizadores", "Organizers")}>
        <L10nField label={tr(locale, "Título antes del logo", "Title before logo")} value={draft.organize.heading} onChange={(lang, value) => updateL10n(["organize", "heading"], lang, value)} />
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.organize.body} multiline onChange={(lang, value) => updateL10n(["organize", "body"], lang, value)} />
        <L10nField label={tr(locale, "Etiqueta del mensaje", "Message label")} value={draft.organize.messageLabel} onChange={(lang, value) => updateL10n(["organize", "messageLabel"], lang, value)} />
        <L10nField label={tr(locale, "Botón enviar", "Submit button")} value={draft.organize.submit} onChange={(lang, value) => updateL10n(["organize", "submit"], lang, value)} />
        <L10nField label={tr(locale, "Mensaje enviado", "Success message")} value={draft.organize.sent} onChange={(lang, value) => updateL10n(["organize", "sent"], lang, value)} />
      </CmsSection>

      <CmsSection title={tr(locale, "Ayuda", "Help")} hint={tr(locale, "Los videos se administran en el bloque de tutoriales", "Videos are managed in the tutorials block")}>
        <L10nField label={tr(locale, "Título", "Title")} value={draft.help.title} onChange={(lang, value) => updateL10n(["help", "title"], lang, value)} />
        <L10nField label={tr(locale, "Texto", "Body")} value={draft.help.body} multiline onChange={(lang, value) => updateL10n(["help", "body"], lang, value)} />
      </CmsSection>

      <CmsSection title={tr(locale, "Navegación y footer", "Navigation and footer")}>
        <L10nField label={tr(locale, "Torneos", "Tournaments")} value={draft.nav.tournaments} onChange={(lang, value) => updateL10n(["nav", "tournaments"], lang, value)} />
        <L10nField label={tr(locale, "Cómo funciona", "How it works")} value={draft.nav.how} onChange={(lang, value) => updateL10n(["nav", "how"], lang, value)} />
        <L10nField label={tr(locale, "Quién está detrás", "Who is behind it")} value={draft.nav.person} onChange={(lang, value) => updateL10n(["nav", "person"], lang, value)} />
        <L10nField label={tr(locale, "Organizar", "Organize")} value={draft.nav.organize} onChange={(lang, value) => updateL10n(["nav", "organize"], lang, value)} />
        <L10nField label={tr(locale, "Ayuda", "Help")} value={draft.nav.help} onChange={(lang, value) => updateL10n(["nav", "help"], lang, value)} />
        <L10nField label={tr(locale, "Términos", "Terms")} value={draft.footer.terms} onChange={(lang, value) => updateL10n(["footer", "terms"], lang, value)} />
        <L10nField label={tr(locale, "Privacidad", "Privacy")} value={draft.footer.privacy} onChange={(lang, value) => updateL10n(["footer", "privacy"], lang, value)} />
        <label><span>Tagline</span><input value={draft.footer.tagline} onChange={(event: ChangeEvent<HTMLInputElement>) => updateText(["footer", "tagline"], event.target.value)} /></label>
      </CmsSection>

      <CmsSection title="SEO">
        <L10nField label={tr(locale, "Título del sitio", "Site title")} value={draft.seo.title} onChange={(lang, value) => updateL10n(["seo", "title"], lang, value)} />
        <L10nField label="Description" value={draft.seo.description} multiline onChange={(lang, value) => updateL10n(["seo", "description"], lang, value)} />
      </CmsSection>

      {message && <p className="lv2-admin-message">{message}</p>}
    </div>
  );
}

function AssetGrid({
  ids,
  locale,
  state,
  busy,
  onUpload,
  onReset,
}: {
  ids: LandingV2AssetId[];
  locale: Locale;
  state: AdminState;
  busy: string;
  onUpload: (id: LandingV2AssetId, event: ChangeEvent<HTMLInputElement>) => void;
  onReset: (id: LandingV2AssetId) => void;
}) {
  return (
    <div className="lv2-admin-assets">
      {ids.map((id) => {
        const asset = state.assets[id];
        const locked = Boolean(busy);
        return (
          <article key={id} className="lv2-admin-asset">
            <div className="lv2-admin-asset-preview">
              {isVideo(id) ? (
                <video key={asset.previewUrl} src={`${asset.previewUrl}?v=${state.draft.updatedAt}`} muted playsInline controls preload="metadata" />
              ) : (
                <img key={asset.previewUrl} src={`${asset.previewUrl}?v=${state.draft.updatedAt}`} alt="" />
              )}
            </div>
            <strong>{tr(locale, assetLabels[id][0], assetLabels[id][1])}</strong>
            <small>{asset.mode === "custom" ? tr(locale, "Personalizado", "Custom") : tr(locale, "Original", "Original")}</small>
            <div className="lv2-admin-asset-actions">
              <label className={`ghost small${locked ? " disabled" : ""}`}>
                {busy === `asset:${id}` ? "…" : tr(locale, "Reemplazar", "Replace")}
                <input
                  type="file"
                  accept={isVideo(id) ? "video/mp4" : "image/jpeg,image/png,image/webp,image/avif"}
                  disabled={locked}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => void onUpload(id, event)}
                />
              </label>
              {asset.mode === "custom" && (
                <button type="button" className="ghost small" disabled={locked} onClick={() => void onReset(id)}>
                  {tr(locale, "Usar original", "Use original")}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
