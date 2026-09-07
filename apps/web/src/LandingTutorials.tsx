import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type { Locale } from "./i18n";
import "./LandingTutorials.css";

const tr = (locale: Locale, es: string, en: string) => (locale === "es" ? es : en);

export type LandingTutorial = {
  id: string;
  titleEs: string;
  titleEn: string;
  videoUrl: string;
};

type AdminTutorial = {
  id: string;
  fixed: boolean;
  titleEs: string;
  titleEn: string;
  hasVideo: boolean;
  contentType: string | null;
  updatedAt: number;
};

type AdminResponse = {
  ok: true;
  tutorials: AdminTutorial[];
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as T & { code?: string };
  if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
  return payload;
}

function tutorialTitle(locale: Locale, tutorial: LandingTutorial) {
  return locale === "es"
    ? tutorial.titleEs || tutorial.titleEn || "Tutorial HUAU"
    : tutorial.titleEn || tutorial.titleEs || "HUAU tutorial";
}

export function LandingTutorialSection({
  locale,
  tutorials,
}: {
  locale: Locale;
  tutorials: LandingTutorial[];
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = useMemo(
    () => tutorials.find((tutorial) => tutorial.id === activeId) ?? null,
    [activeId, tutorials],
  );

  useEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActiveId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [active]);

  if (!tutorials.length) return null;

  return (
    <>
      <section className="landing-section landing-tutorial-section">
        <div className="landing-section-heading split-heading">
          <div>
            <span>HUAU GUIDE</span>
            <h2>{tr(locale, "Cómo usar HUAU", "How to use HUAU")}</h2>
          </div>
          <p>
            {tr(
              locale,
              "Guías rápidas para crear tu cuenta, inscribirte y gestionar tus torneos.",
              "Quick guides to create your account, register and manage your tournaments.",
            )}
          </p>
        </div>

        <div className="landing-tutorial-grid">
          {tutorials.map((tutorial, index) => (
            <button
              type="button"
              className="landing-tutorial-card"
              key={tutorial.id}
              onClick={() => setActiveId(tutorial.id)}
            >
              <div className="landing-tutorial-visual" aria-hidden="true">
                <img src="/huau-logo.png" alt="" />
                <span className="landing-tutorial-play">▶</span>
              </div>
              <div className="landing-tutorial-card-copy">
                <span>{tr(locale, "GUÍA", "GUIDE")} {String(index + 1).padStart(2, "0")}</span>
                <h3>{tutorialTitle(locale, tutorial)}</h3>
                <small>{tr(locale, "Ver video", "Watch video")} →</small>
              </div>
            </button>
          ))}
        </div>
      </section>

      {active && (
        <div
          className="landing-video-modal"
          role="dialog"
          aria-modal="true"
          aria-label={tutorialTitle(locale, active)}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setActiveId(null);
          }}
        >
          <div className="landing-video-modal-card">
            <div className="landing-video-modal-head">
              <div>
                <span>HUAU GUIDE</span>
                <h3>{tutorialTitle(locale, active)}</h3>
              </div>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                aria-label={tr(locale, "Cerrar video", "Close video")}
              >
                ×
              </button>
            </div>
            <video
              key={active.id}
              src={active.videoUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
            >
              {tr(
                locale,
                "Tu navegador no puede reproducir este video.",
                "Your browser cannot play this video.",
              )}
            </video>
          </div>
        </div>
      )}
    </>
  );
}

export function LandingTutorialAdmin({ locale }: { locale: Locale }) {
  const [tutorials, setTutorials] = useState<AdminTutorial[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { titleEs: string; titleEn: string }>>({});
  const [busyId, setBusyId] = useState("");
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<AdminResponse>("/api/platform/landing/tutorials");
      setTutorials(data.tutorials);
      setDrafts(
        Object.fromEntries(
          data.tutorials.map((tutorial) => [
            tutorial.id,
            { titleEs: tutorial.titleEs, titleEn: tutorial.titleEn },
          ]),
        ),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_ADMIN_LOAD_FAILED");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveTitles = async (tutorial: AdminTutorial) => {
    const draft = drafts[tutorial.id] ?? { titleEs: "", titleEn: "" };
    setBusyId(tutorial.id);
    setMessage("");
    try {
      await api(`/api/platform/landing/tutorials/${encodeURIComponent(tutorial.id)}`, {
        method: "PUT",
        body: JSON.stringify(draft),
      });
      await load();
      setMessage(tr(locale, "Título guardado.", "Title saved."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_TITLE_SAVE_FAILED");
    } finally {
      setBusyId("");
    }
  };

  const uploadVideo = async (
    tutorial: AdminTutorial,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusyId(tutorial.id);
    setMessage("");
    try {
      const response = await fetch(
        `/api/platform/landing/tutorials/${encodeURIComponent(tutorial.id)}/video`,
        {
          method: "PUT",
          headers: { "content-type": file.type || "application/octet-stream" },
          body: file,
        },
      );
      const payload = (await response.json()) as { ok?: boolean; code?: string };
      if (!response.ok) throw new Error(payload.code || `HTTP_${response.status}`);
      await load();
      setMessage(tr(locale, "Video actualizado.", "Video updated."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_VIDEO_UPLOAD_FAILED");
    } finally {
      input.value = "";
      setBusyId("");
    }
  };

  const clearVideo = async (tutorial: AdminTutorial) => {
    setBusyId(tutorial.id);
    setMessage("");
    try {
      await api(
        `/api/platform/landing/tutorials/${encodeURIComponent(tutorial.id)}/video`,
        { method: "DELETE", body: "{}" },
      );
      await load();
      setMessage(tr(locale, "Video eliminado.", "Video removed."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_VIDEO_DELETE_FAILED");
    } finally {
      setBusyId("");
    }
  };

  const addTutorial = async () => {
    setAdding(true);
    setMessage("");
    try {
      await api("/api/platform/landing/tutorials", { method: "POST", body: "{}" });
      await load();
      setMessage(tr(locale, "Nuevo bloque agregado.", "New block added."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_ADD_FAILED");
    } finally {
      setAdding(false);
    }
  };

  const removeTutorial = async (tutorial: AdminTutorial) => {
    if (tutorial.fixed) return;
    setBusyId(tutorial.id);
    setMessage("");
    try {
      await api(`/api/platform/landing/tutorials/${encodeURIComponent(tutorial.id)}`, {
        method: "DELETE",
        body: "{}",
      });
      await load();
      setMessage(tr(locale, "Bloque eliminado.", "Block removed."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "TUTORIAL_REMOVE_FAILED");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="landing-tutorial-admin">
      <div className="landing-tutorial-admin-head">
        <div>
          <h3>{tr(locale, "Videos: Cómo usar HUAU", "Videos: How to use HUAU")}</h3>
          <p className="muted">
            {tr(
              locale,
              "Los dos primeros bloques son fijos. Podés sumar más cuando quieras. Los videos viven en R2 y no usan D1.",
              "The first two blocks are fixed. You can add more whenever needed. Videos live in R2 and do not use D1.",
            )}
          </p>
        </div>
        <button
          type="button"
          className="light small"
          disabled={adding || Boolean(busyId)}
          onClick={() => void addTutorial()}
        >
          {adding ? "…" : tr(locale, "+ Agregar otro video", "+ Add another video")}
        </button>
      </div>

      <div className="landing-tutorial-admin-list">
        {tutorials.map((tutorial, index) => {
          const draft = drafts[tutorial.id] ?? { titleEs: "", titleEn: "" };
          const busy = busyId === tutorial.id;
          return (
            <article className="landing-tutorial-admin-card" key={tutorial.id}>
              <div className="landing-tutorial-admin-card-head">
                <div>
                  <span>{tutorial.fixed
                    ? tr(locale, `Bloque fijo ${index + 1}`, `Fixed block ${index + 1}`)
                    : tr(locale, `Video ${index + 1}`, `Video ${index + 1}`)}</span>
                  <strong>
                    {tutorial.hasVideo
                      ? tr(locale, "Video cargado", "Video uploaded")
                      : tr(locale, "Sin video", "No video")}
                  </strong>
                </div>
                {!tutorial.fixed && (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(busyId) || adding}
                    onClick={() => void removeTutorial(tutorial)}
                  >
                    {tr(locale, "Eliminar bloque", "Delete block")}
                  </button>
                )}
              </div>

              <div className="landing-tutorial-title-grid">
                <label>
                  <span>{tr(locale, "Título", "Title")} · ES</span>
                  <input
                    value={draft.titleEs}
                    maxLength={140}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [tutorial.id]: { ...draft, titleEs: event.target.value },
                      }))
                    }
                  />
                </label>
                <label>
                  <span>{tr(locale, "Título en inglés (opcional)", "English title (optional)")}</span>
                  <input
                    value={draft.titleEn}
                    maxLength={140}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [tutorial.id]: { ...draft, titleEn: event.target.value },
                      }))
                    }
                  />
                </label>
              </div>

              <div className="landing-tutorial-admin-actions">
                <button
                  type="button"
                  className="ghost small"
                  disabled={Boolean(busyId) || adding}
                  onClick={() => void saveTitles(tutorial)}
                >
                  {busy ? "…" : tr(locale, "Guardar título", "Save title")}
                </button>

                <label className={`ghost small${Boolean(busyId) || adding ? " disabled" : ""}`}>
                  {busy
                    ? "…"
                    : tutorial.hasVideo
                      ? tr(locale, "Reemplazar video", "Replace video")
                      : tr(locale, "Cargar video", "Upload video")}
                  <input
                    type="file"
                    accept="video/mp4,video/webm,video/quicktime"
                    disabled={Boolean(busyId) || adding}
                    onChange={(event) => void uploadVideo(tutorial, event)}
                  />
                </label>

                {tutorial.hasVideo && (
                  <button
                    type="button"
                    className="ghost small"
                    disabled={Boolean(busyId) || adding}
                    onClick={() => void clearVideo(tutorial)}
                  >
                    {tr(locale, "Quitar video", "Remove video")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <p className="muted landing-tutorial-admin-hint">
        {tr(
          locale,
          "Recomendado: MP4 H.264 comprimido. Máximo 60 MB por video.",
          "Recommended: compressed H.264 MP4. Maximum 60 MB per video.",
        )}
      </p>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}
