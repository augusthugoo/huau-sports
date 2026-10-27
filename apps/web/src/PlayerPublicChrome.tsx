import { useEffect, useRef, useState } from "react";
import type { Locale } from "./i18n";

type Go = (path: string) => void;
const tr = (locale: Locale, es: string, en: string) => locale === "es" ? es : en;

export function PlayerAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "H";

  return (
    <span className={`player-avatar player-avatar-${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}

export function PlayerPublicHeader({
  locale,
  go,
  authenticated = false,
  onLogin,
  onSignOut,
  platformAdmin = false,
}: {
  locale: Locale;
  go: Go;
  authenticated?: boolean;
  onLogin?: (() => void) | undefined;
  onSignOut?: (() => void | Promise<void>) | undefined;
  platformAdmin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const close = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const navigate = (path: string) => {
    setOpen(false);
    go(path);
  };

  const switchLanguage = () => {
    localStorage.setItem("huau.locale", locale === "es" ? "en" : "es");
    window.location.reload();
  };

  return (
    <header className="player-public-header">
      <button
        type="button"
        className="player-public-logo"
        onClick={() => go("/")}
        aria-label="HUAU"
      >
        <img src="/huau-logo.png" alt="HUAU" />
      </button>

      {!authenticated ? (
        <button
          type="button"
          className="player-public-login"
          onClick={() => onLogin ? onLogin() : go("/login")}
        >
          {tr(locale, "Iniciar sesión", "Sign in")}
        </button>
      ) : (
        <div className="player-public-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`player-public-menu-button${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-label={open ? tr(locale, "Cerrar menú", "Close menu") : tr(locale, "Abrir menú", "Open menu")}
            onClick={() => setOpen((value) => !value)}
          >
            <span />
            <span />
            <span />
          </button>

          {open && (
            <div className="player-public-menu">
              <button type="button" onClick={() => navigate("/")}>
                {tr(locale, "Explorar torneos", "Explore tournaments")}
              </button>
              <button type="button" onClick={() => navigate("/app")}>
                {tr(locale, "Mi perfil", "My profile")}
              </button>
              <button type="button" onClick={() => navigate("/app/registrations")}>
                {tr(locale, "Mis inscripciones", "My registrations")}
              </button>

              {platformAdmin && (
                <button type="button" onClick={() => navigate("/platform")}>
                  {tr(locale, "Administración", "Administration")}
                </button>
              )}

              <div className="player-public-menu-rule" />

              <button type="button" onClick={switchLanguage}>
                {locale === "es" ? "English" : "Español"}
              </button>

              {onSignOut && (
                <button
                  type="button"
                  className="player-public-signout"
                  onClick={() => {
                    setOpen(false);
                    void onSignOut();
                  }}
                >
                  {tr(locale, "Cerrar sesión", "Sign out")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
