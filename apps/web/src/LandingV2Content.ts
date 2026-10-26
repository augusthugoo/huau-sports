export type LandingLocalizedText = { es: string; en: string };

export type LandingV2EditableContent = {
  nav: {
    tournaments: LandingLocalizedText;
    how: LandingLocalizedText;
    person: LandingLocalizedText;
    organize: LandingLocalizedText;
    help: LandingLocalizedText;
  };
  hero: {
    title: LandingLocalizedText;
    body: LandingLocalizedText;
    cta: LandingLocalizedText;
  };
  tournaments: {
    title: LandingLocalizedText;
    body: LandingLocalizedText;
    upcoming: LandingLocalizedText;
    results: LandingLocalizedText;
    emptyUpcoming: LandingLocalizedText;
    emptyResults: LandingLocalizedText;
  };
  metrics: {
    playersLabel: LandingLocalizedText;
    matchesLabel: LandingLocalizedText;
    suffix: string;
  };
  journey: {
    heading: LandingLocalizedText;
    keepScrolling: LandingLocalizedText;
    items: Array<{
      label: LandingLocalizedText;
      title: LandingLocalizedText;
      body: LandingLocalizedText;
    }>;
  };
  scene: {
    title: LandingLocalizedText;
    body: LandingLocalizedText;
  };
  person: {
    sectionTitle: LandingLocalizedText;
    kicker: LandingLocalizedText;
    headline: LandingLocalizedText;
    name: string;
    body: LandingLocalizedText;
    learnMore: LandingLocalizedText;
    close: LandingLocalizedText;
  };
  organize: {
    heading: LandingLocalizedText;
    body: LandingLocalizedText;
    messageLabel: LandingLocalizedText;
    submit: LandingLocalizedText;
    sent: LandingLocalizedText;
  };
  help: {
    title: LandingLocalizedText;
    body: LandingLocalizedText;
  };
  footer: {
    terms: LandingLocalizedText;
    privacy: LandingLocalizedText;
    tagline: string;
  };
  seo: {
    title: LandingLocalizedText;
    description: LandingLocalizedText;
  };
};

export const landingV2AssetIds = [
  "heroPoster",
  "heroVideoMobile",
  "heroVideoDesktop",
  "journey1",
  "journey2",
  "journey3",
  "journey4",
  "scenePoster",
  "sceneVideoMobile",
  "sceneVideoDesktop",
  "personPhoto",
] as const;

export type LandingV2AssetId = (typeof landingV2AssetIds)[number];
export type LandingV2AssetMode = "default" | "custom";
export type LandingV2AssetModes = Record<LandingV2AssetId, LandingV2AssetMode>;
export type LandingV2AssetUrls = Record<LandingV2AssetId, string>;

export type LandingV2Content = LandingV2EditableContent & {
  assets: LandingV2AssetUrls;
};

const t = (es: string, en: string): LandingLocalizedText => ({ es, en });

export const defaultLandingV2EditableContent: LandingV2EditableContent = {
  nav: {
    tournaments: t("Torneos", "Tournaments"),
    how: t("Cómo funciona", "How it works"),
    person: t("Quién está detrás", "Who is behind it"),
    organize: t("Organizar", "Organize"),
    help: t("Ayuda", "Help"),
  },
  hero: {
    title: t("Todo el torneo. En un solo lugar.", "The whole tournament. In one place."),
    body: t(
      "Encontrá torneos, inscribite y seguí cada etapa. Si organizás, manejá inscripciones, cronograma, competencia y resultados desde el mismo lugar.",
      "Find tournaments, register and follow every stage. If you organize, manage registration, schedule, competition and results from the same place.",
    ),
    cta: t("Explorar torneos", "Explore tournaments"),
  },
  tournaments: {
    title: t("Torneos.", "Tournaments."),
    body: t(
      "Lo que está por empezar, lo que se está jugando y lo que ya quedó en la historia.",
      "What is about to start, what is being played and what is already part of the history.",
    ),
    upcoming: t("Próximos", "Upcoming"),
    results: t("Resultados", "Results"),
    emptyUpcoming: t("Los próximos torneos van a aparecer acá.", "Upcoming tournaments will appear here."),
    emptyResults: t("Todavía no hay resultados recientes para mostrar.", "There are no recent results to show yet."),
  },
  metrics: {
    playersLabel: t("Jugadores", "Players"),
    matchesLabel: t("Partidos jugados", "Matches played"),
    suffix: "+",
  },
  journey: {
    heading: t("Todo el torneo, conectado.", "The whole tournament, connected."),
    keepScrolling: t("Seguí bajando", "Keep scrolling"),
    items: [
      {
        label: t("Antes de competir", "Before competing"),
        title: t("Inscripciones.", "Registration."),
        body: t(
          "Entrá al torneo, elegí tu categoría y seguí el estado de tu inscripción desde un mismo lugar.",
          "Enter the tournament, choose your category and follow your registration status from one place.",
        ),
      },
      {
        label: t("Todo en orden", "Everything in order"),
        title: t("Cronograma.", "Schedule."),
        body: t(
          "Horarios, canchas y orden del día quedan disponibles para saber cuándo y dónde jugás.",
          "Times, courts and the order of play stay available so you know when and where you play.",
        ),
      },
      {
        label: t("Mientras avanza", "As it unfolds"),
        title: t("Competencia.", "Competition."),
        body: t(
          "Grupos, cruces y cuadros acompañan el torneo mientras cada resultado mueve la competencia.",
          "Groups, matchups and brackets follow the tournament as each result moves the competition forward.",
        ),
      },
      {
        label: t("Cuando termina", "When it ends"),
        title: t("Resultados.", "Results."),
        body: t(
          "El torneo no desaparece al terminar: resultados y recorridos quedan disponibles para volver a verlos.",
          "The tournament does not disappear when it ends: results and paths remain available to revisit.",
        ),
      },
    ],
  },
  scene: {
    title: t("Mientras se juega, todo tiene que estar claro.", "While the tournament is being played, everything has to be clear."),
    body: t(
      "Horarios, cancha, rival, cuadro y resultados: la información importante aparece cuando importa.",
      "Times, court, opponent, bracket and results: the important information appears when it matters.",
    ),
  },
  person: {
    sectionTitle: t("Quién está detrás.", "Who is behind it."),
    kicker: t("Quién está detrás", "Who is behind it"),
    headline: t("Construido desde adentro de los torneos.", "Built from inside tournaments."),
    name: "Augusto",
    body: t(
      "Organizar, competir, mirar horarios y seguir resultados: la idea nace de vivir esos problemas en primera persona y convertirlos en una experiencia mucho más clara.",
      "Organizing, competing, checking times and following results: the idea comes from living those problems first-hand and turning them into a much clearer experience.",
    ),
    learnMore: t("Conocer más", "Learn more"),
    close: t("Cerrar", "Close"),
  },
  organize: {
    heading: t("Organizá con", "Organize with"),
    body: t(
      "Contanos qué querés organizar y cómo podemos ayudarte a llevarlo a cancha.",
      "Tell us what you want to organize and how we can help you bring it to the court.",
    ),
    messageLabel: t("Qué querés organizar", "What do you want to organize"),
    submit: t("Enviar consulta", "Send inquiry"),
    sent: t("Consulta enviada.", "Inquiry sent."),
  },
  help: {
    title: t("Ayuda.", "Help."),
    body: t("Guías rápidas para empezar y resolver lo más común.", "Quick guides to get started and solve the most common questions."),
  },
  footer: {
    terms: t("Términos y condiciones", "Terms and conditions"),
    privacy: t("Política de privacidad", "Privacy policy"),
    tagline: "Your Sports Ecosystem",
  },
  seo: {
    title: t("HUAU Sports", "HUAU Sports"),
    description: t(
      "Torneos, inscripciones, cronogramas, competencia y resultados en un solo lugar.",
      "Tournaments, registration, schedules, competition and results in one place.",
    ),
  },
};

export const defaultLandingV2AssetUrls: LandingV2AssetUrls = {
  heroPoster: "/landing-v2/poster-01.jpg",
  heroVideoMobile: "/landing-v2/sport-01-720.mp4",
  heroVideoDesktop: "/landing-v2/sport-01-1080.mp4",
  journey1: "/landing-v2/journey-01.jpg",
  journey2: "/landing-v2/journey-02.jpg",
  journey3: "/landing-v2/journey-03.jpg",
  journey4: "/landing-v2/journey-04.jpg",
  scenePoster: "/landing-v2/poster-02.jpg",
  sceneVideoMobile: "/landing-v2/sport-02-720.mp4",
  sceneVideoDesktop: "/landing-v2/sport-02-1080.mp4",
  personPhoto: "/landing-v2/person.jpg",
};

export const defaultLandingV2AssetModes: LandingV2AssetModes = Object.fromEntries(
  landingV2AssetIds.map((id) => [id, "default"]),
) as LandingV2AssetModes;
