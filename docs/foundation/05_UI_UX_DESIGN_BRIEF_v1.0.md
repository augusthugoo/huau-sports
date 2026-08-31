# HUAU Sports - UI/UX Design Brief v1.0

**Estado:** Baseline visual y de interacción  
**Fecha:** 2026-08-29  
**Depende de:** PRD + App Flows  

---

## 1. Objetivo de diseño

HUAU debe sentirse como una plataforma deportiva premium y seria, no como una colección de dashboards genéricos.

La nueva interfaz conserva lo mejor de Tournament y Ref actuales:

- negro/blanco/grafito;
- alto contraste;
- jerarquía clara;
- información deportiva legible rápido;
- superficies sobrias;
- pocos acentos.

A la vez, debe corregir la sensación “muy hecha con IA” observada en interfaces web genéricas:

- menos tarjetas idénticas repetidas;
- menos redondeos exagerados;
- menos copy decorativo;
- menos gradientes/glows sin función;
- más estructura editorial;
- mejor tipografía;
- espacios y alineaciones intencionales;
- motion sólo donde agrega percepción de producto.

---

## 2. Personalidad visual

Palabras guía:

- deportiva;
- técnica;
- sobria;
- directa;
- premium;
- rápida;
- confiable;
- contemporánea.

No buscamos:

- gaming/neón;
- estética crypto;
- “glassmorphism” dominante;
- look infantil;
- dashboard corporativo azul genérico;
- marketing lleno de badges y gradientes;
- exceso de animación.

---

## 3. Arquitectura de experiencia

La misma marca tiene cuatro tonos de interfaz:

### 3.1 Public / Landing

Más expresiva y aspiracional.

- movimiento sutil;
- producto mostrado en contexto;
- pantallas reales;
- secciones visuales con aire;
- CTA claros;
- branding del club/evento cuando corresponda.

### 3.2 My HUAU / Club member

Más humana y cotidiana.

- mobile-first;
- “mi semana” como centro;
- próximas reservas/partidos/torneos;
- acciones rápidas;
- información escaneable.

### 3.3 Admin / Tournament

Más técnica y operacional.

- dense but calm;
- navegación constante;
- formularios claros;
- cambios destructivos muy explícitos;
- casi sin motion ornamental.

### 3.4 Ref

Máxima concentración.

- tablet landscape first;
- botones grandes;
- score dominante;
- estados inequívocos;
- nada decorativo durante partido.

---

## 4. Branding HUAU

### 4.1 Wordmark

El logo oficial HUAU es un asset. Nunca se recrea escribiendo “HUAU” con una tipografía parecida.

El wordmark principal permanece blanco/negro según superficie.

### 4.2 Color base

Del sistema de marca existente:

```text
HUAU Black   #050505
Carbon       #111111
Graphite     #1B1B1B
Steel        #686868
Fog          #BDBDBD
Off White    #F4F4F2
White        #FFFFFF
Sand         #A79F8B  (micro-acento opcional HUAU)
```

### 4.3 Club theming

La organización puede aportar:

- `--org-accent-primary`;
- `--org-accent-secondary`;
- logo;
- hero visual.

El accent puede aparecer en:

- selected state;
- pequeños highlights;
- tabs/chips relevantes;
- gráficas simples;
- CTA contextual del club.

No debe:

- convertir toda la interfaz al color del club;
- recolorear el wordmark HUAU;
- destruir contraste.

Fallback siempre HUAU neutral.

---

## 5. Tipografía

### 5.1 UI principal

Usar **Montserrat** como familia principal de producto, siguiendo la decisión adoptada en Resenda para alejarse del look web genérico y mantener una familia consistente en landing, acceso, paneles, forms y botones.

Jerarquía por peso/tamaño, no mezclando muchas familias.

### 5.2 Branding/display

El logo HUAU continúa siendo asset oficial. Los recursos existentes de marca no obligan a utilizar una tipografía display específica dentro de toda la aplicación.

Para V1:

- Montserrat en UI y marketing web;
- wordmark HUAU como imagen/SVG oficial;
- no recrear logo con texto.

### 5.3 Escala recomendada

```text
Display XL   56-72 / 0.95-1.05 line-height  (landing desktop)
Display L    40-52
H1           32-40
H2           24-30
H3           18-22
Body L       16-18
Body         14-16
Small        12-13
Data         12-14 medium/semibold
```

En Tournament/Ref, score y datos pueden romper la escala con tamaños específicos.

---

## 6. Spacing y geometría

### 6.1 Base spacing

Escala 4px:

```text
4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80
```

### 6.2 Border radius

Evitar el look “todo pill”.

- controles: 8-10px;
- cards: 12-16px;
- large marketing surfaces: hasta 20px cuando se justifique;
- chips/status: pill sólo por semántica.

### 6.3 Borders

Preferir:

- 1px neutral subtle;
- contraste de superficie;
- sombras mínimas.

No usar sombras pesadas como separación principal.

---

## 7. Layout responsive

### 7.1 Mobile-first para jugador

Diseñar primero a ~375-430px.

Prioridades:

- una columna;
- bottom nav o compact primary nav;
- acciones sticky sólo cuando aportan;
- cards convertibles a list rows;
- no tablas horizontales gigantes sin adaptación.

### 7.2 Desktop/tablet-first para administración

Admin target:

- 1024px+ óptimo;
- usable 768px tablet;
- móvil para tareas rápidas, no para construir formatos complejos cómodamente.

Patrón:

```text
Sidebar / rail
+ top context bar
+ content canvas
+ optional right inspector
```

### 7.3 Ref

Target principal:

- tablet 1024x768 landscape y superiores;
- score controls ocupan área central;
- modal/overlay táctil grande.

### 7.4 Live

Responsive modes:

- Mobile Live: tabs/sections y cards.
- Desktop Live: multi-column when space permits.
- TV Live: no nav chrome, letras grandes, auto-focused content.

---

## 8. Navegación

### 8.1 Una sola entrada

No separar “login de club” y “login jugador”.

Tras login:

- `Mi HUAU` default.
- context switcher muestra organizaciones/capabilities.

### 8.2 My HUAU navigation

Recomendado V1:

```text
Inicio
Reservas
Comunidad
Torneos
Perfil
```

Open Play/activities aparecen dentro de Inicio/Comunidad según IA final.

### 8.3 Organization Admin navigation

```text
Resumen
Miembros
Canchas & reservas
Comunidad
Actividades
Torneos
Pagos
Configuración
```

Analytics puede vivir en Resumen en V1.

### 8.4 Tournament workspace

No usar las mismas tabs planas para 15 áreas sin jerarquía.

Recomendación:

```text
SETUP
- General
- Inscripciones
- Participantes
- Categorías & formatos

COMPETENCIA
- Sorteo & grupos
- Cronograma
- Resultados
- Fase final

PUBLICACIÓN
- Live
- Compartir

SEGURIDAD
- Backups / recuperación
```

Durante evento, `Operar torneo` cambia a una vista simplificada.

---

## 9. Landing HUAU

### 9.1 Objetivo

Mostrar producto real, no explicar tecnología abstracta.

### 9.2 Storyline sugerido

1. Hero: “Tecnología para competir mejor.”
2. Producto real en pantalla.
3. Tournament: de inscripción a live.
4. Club: reserva y completa partidos.
5. Ref: arbitraje enfocado.
6. Caso real/credibilidad.
7. Modularidad.
8. CTA contacto/demo.

### 9.3 Motion

Tomar la línea validada en Resenda:

- reveal al entrar al viewport;
- pequeños desplazamientos verticales/horizontales;
- secuencias conectadas que expliquen flujo;
- no loop infinito decorativo;
- header compacto/fijo;
- `prefers-reduced-motion` respetado.

Duraciones orientativas:

```text
fast  120-180ms
base  200-280ms
slow  350-500ms (marketing only)
```

Easing natural; evitar bounce.

---

## 10. My HUAU home - “Mi semana”

El home no debe ser un dashboard lleno de KPIs.

Prioridad:

1. Qué tengo próximo.
2. Qué puedo hacer.
3. Qué cambió importante.

Ejemplo:

```text
Hola, Augusto

HOY
19:00  Partido abierto · Pickleball · Cancha 2

MIÉRCOLES
20:00  Reserva · Pádel · Cancha 1

ESTA SEMANA
Torneo Dobles B · Inscripción confirmada

[Reservar cancha] [Buscar partido]
```

Sin feed social infinito.

---

## 11. Reserva UX

### 11.1 Goal

Reservar en pocos pasos sin simular un calendario empresarial complejo.

### 11.2 Flow UI

- Sport segmented control.
- Date horizontal picker/calendar compact.
- Available times grouped by court or time.
- Duration selector only after start time.
- Private/Open choice near confirmation.

### 11.3 States

Color/status alone never enough; include text/icon.

```text
Disponible
Pendiente
Confirmada
Bloqueada
No disponible
```

### 11.4 Approval

After request:

```text
Solicitud enviada
Cancha 2 · 19:00-20:30
Esperando confirmación del club
```

No ambiguous spinner.

---

## 12. Open match UX

Card should answer instantly:

- when;
- where;
- sport/mode;
- level;
- how many missing.

Example:

```text
MIÉ 19:00
Pickleball · Dobles
Cancha 3
Nivel 3.0-3.5
3/4 jugadores

[Falta 1]             [Sumarme]
```

Avoid excessive user avatars if data doesn’t add value.

---

## 13. Open Play UX

Official activity visual distinction:

- organization badge/logo;
- “Actividad oficial” marker;
- capacity prominent;
- waitlist state clear.

No rotation UI.

---

## 14. Tournament admin UX redesign

### 14.1 Main issue to solve

Legacy Tournament works, but a third-party organizer must understand consequences before clicking.

### 14.2 Setup checklist

Tournament overview should show progress:

```text
1 General                ✓
2 Registration           ✓
3 Categories & format    ✓
4 Draw / groups          Pending
5 Schedule               Locked until groups
6 Publish                --
```

This reduces “where do I go now?”.

### 14.3 Simple vs advanced format configuration

Default view:

- presets/recommended options;
- match count/time estimate;
- short explanation.

Advanced drawer:

- wildcards;
- cross-group method;
- consolation;
- rematch policy;
- detailed medal rules.

The system remains configurable without presenting 15 selectors at once.

---

## 15. Format Explanation UX

At category setup:

```text
FORMATO
3 grupos: 4 / 4 / 3
Clasifican 2 por grupo
Comparación entre grupos: Normalizada

[Cómo se calcula]
```

Expanded:

```text
1. Se compara porcentaje de victorias.
2. En empate, diferencia de puntos promedio por partido.
3. Luego, puntos anotados promedio por partido.
4. Rating sólo como último desempate.
```

For Equalized, explain discarded extra opponents explicitly.

Always separate:

- official rules (locked text);
- organizer notes (editable).

---

## 16. Destructive action UX

Do not show generic:

> “¿Está seguro?”

Show impact:

```text
Cambiar la pareja de Juan afecta Dobles Mixto B.

Se regenerarán:
- Grupos de Dobles Mixto B
- 9 partidos de fase de grupos
- Cronograma de esta categoría

No se modificarán otras categorías.

Se guardará una copia automática antes del cambio.

[Cancelar] [Aplicar cambio]
```

For locked structure:

```text
Esta categoría está bloqueada porque el torneo ya comenzó.
[Volver] [Desbloquear estructura...]
```

---

## 17. Recovery UX

Normal admins should not see a scary database console.

```text
RECUPERACIÓN
Última copia segura
14:32 · Antes de modificar participantes

[Ver cambios] [Restaurar]
```

Older snapshots under secondary `Ver historial`.

Platform Admin can have deeper diagnostics.

---

## 18. Tournament operation mode

During event:

### Desktop/tablet

```text
TOP: tournament status / online-offline / sync

NOW
Court 1   A vs B   [Cargar resultado]
Court 2   C vs D   [Cargar resultado]
Court 3   E vs F   [Cargar resultado]

NEXT
...

SIDE
Category progress / alerts
```

Advanced settings hidden.

### Phone delegate

- court-filtered list;
- match card;
- result entry;
- save;
- next match.

This anticipates professional delegate workflows without requiring connected Ref.

---

## 19. Results UX

Result entry must be fast.

Single game:

```text
A [ 15 ]   [ 11 ] B
[Guardar resultado]
```

BO3:

```text
SET 1   11 - 8
SET 2   7  - 11
SET 3   11 - 6
```

No unnecessary modal chains.

Correction after final:

- explicit `Corregir resultado`;
- audit/snapshot rules;
- dependent bracket recalculated safely.

---

## 20. Team competition UX

### 20.1 Team format builder

Use a vertical ordered list, not a massive matrix.

```text
ENFRENTAMIENTO
1  Dobles Masculino      [Edit]
2  Dobles Femenino       [Edit]
3  Singles Masculino     [Edit]
4  Singles Femenino      [Edit]
5  Dobles Mixto          [Edit]

[+ Agregar partido]
```

Each row expands settings.

Drag reorder optional; up/down controls must also work accessibly.

### 20.2 Roster rules

Human language summary:

```text
Equipo: 4-6 jugadores
Mínimo: 2 hombres y 2 mujeres
Suplentes permitidos: Sí
```

### 20.3 Lineup

For each encounter:

```text
Team A                         Team B

Dobles Masculino
[Juan] [Pedro]           [Luis] [Martín]

Dobles Femenino
[Ana] [Sofía]            [Carla] [Mica]
...

[Guardar alineación] [Bloquear]
```

Invalid roster member is never selectable.

### 20.4 Live team score

```text
HUAU BLACK  2  -  1  HORNEROS

✓ MD   11-8
✓ WD   11-6
  MS   7-11
NOW WS
NEXT XD
```

---

## 21. Public Tournament Live UX

### Mobile

Header compact:

- tournament;
- LIVE chip;
- category switcher.

Sections:

```text
Ahora
Próximos
Resultados
Grupos
Cuadro
Formato
```

Avoid forcing users to horizontally scroll giant bracket when a round-based mobile presentation can work.

### TV

- no small controls;
- score/results and upcoming matches prioritized;
- large category state;
- automatic layout switching may be configurable, not mandatory animation.

### Last updated

If connection/event feed stale:

`Última actualización 14:37`

Never pretend live when it isn't.

---

## 22. HUAU Ref UX

Preserve current successful direction:

- black/white/gray;
- team colors only for differentiation;
- large score buttons;
- service info visible;
- undo/redo immediate;
- timeout/warning/correction as secondary actions;
- no admin navigation during active match.

### Active match hierarchy

1. Score.
2. Who serves / side / server number.
3. Tap targets to record rally.
4. Timeouts/warnings.
5. Undo/correct.

### Safety

A referee correction should state what changed before applying when multiple fields are modified.

---

## 23. Platform Admin UX

Must be utilitarian, not customer-facing marketing.

Key home:

- active organizations;
- modules;
- current incidents;
- integration health;
- support shortcuts;
- minimal usage metrics.

Support mode has unmistakable banner:

```text
MODO SOPORTE · Horneros
Estás actuando con permisos de soporte.
[Salir]
```

---

## 24. Forms

Rules:

- labels always visible;
- helper text only where needed;
- error next to field;
- preserve entered data after validation error;
- use sensible defaults;
- progressive disclosure;
- do not require users to memorize jargon.

Tournament jargon gets explanations/tooltips.

---

## 25. Tables

Admin tables may be dense, but:

- sticky headers for long lists;
- key column first;
- row actions grouped;
- status obvious;
- no 12 tiny icon buttons;
- mobile converts to cards/rows.

For sports standings, table structure is appropriate and should remain table-like.

---

## 26. Status system

Semantic status tokens, not arbitrary colors:

```text
neutral
info
success
warning
critical
live
```

Examples:

- Confirmed -> success.
- Pending approval -> warning/info.
- Offline -> warning.
- Failed sync -> critical.
- Live -> live/brand accent.

Always text + icon/shape, not color only.

---

## 27. Icons

- one line-icon family;
- simple;
- consistent stroke;
- labels for ambiguous admin actions;
- no emoji as core product iconography.

Sports visual assets can be photographic/brand imagery on landing.

---

## 28. Motion rules

### Allowed

- page/section reveal on public surfaces;
- drawer/modal transitions;
- selected state transitions;
- success confirmation subtle;
- live score update highlight (brief);
- reorder animation.

### Avoid

- looping floating cards;
- bouncing CTA;
- heavy parallax;
- animated backgrounds in admin;
- transitions that delay result entry.

### Reduced motion

Honor `prefers-reduced-motion` globally.

---

## 29. Accessibility

Target WCAG 2.2 AA where practical.

Mandatory:

- keyboard navigation admin;
- focus visible;
- semantic buttons/labels;
- adequate contrast;
- form errors announced;
- touch targets >= 44px where mobile/ref critical;
- no color-only meaning;
- reduced-motion support;
- tables readable by screen reader;
- drag/drop always has non-drag alternative.

---

## 30. PWA UX

Do not aggressively show “Install app” on first visit.

Use contextual install prompt after value is understood:

- member after reservation/return visit;
- tournament operator in setup checklist;
- referee after setup.

Offline state must be visible but not panic-inducing.

```text
● Online
● Sin conexión · 3 cambios pendientes
● Sincronizando...
● Requiere atención · conflicto
```

---

## 31. Empty states

Useful and action-oriented.

Bad:

> No hay datos.

Good:

> Todavía no hay partidos abiertos para hoy.  
> Podés reservar una cancha y abrir lugares a la comunidad.
> [Reservar cancha]

Admin empty states explain next dependency.

---

## 32. Content style

Spanish product copy:

- direct;
- short;
- no corporate filler;
- Rioplatense-neutral enough for internationalization;
- avoid jokes in critical operations.

English is not literal machine translation; maintain sports terminology.

Examples:

- `Cargar resultado` rather than `Procesar outcome`.
- `Bloquear estructura` rather than `Freeze configuration state`.
- `Partidos equiparados` explanation with plain-language detail.

---

## 33. Design system tokens

Suggested base:

```css
:root {
  --huau-bg: #050505;
  --huau-surface-1: #111111;
  --huau-surface-2: #1B1B1B;
  --huau-text: #FFFFFF;
  --huau-text-muted: #BDBDBD;
  --huau-text-subtle: #686868;
  --huau-offwhite: #F4F4F2;
  --huau-brand-detail: #A79F8B;

  --org-accent-primary: #A79F8B;
  --org-accent-secondary: #686868;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
}
```

Final token set should live in shared UI package.

---

## 34. Visual QA checklist

Before a surface ships:

- Does it still read as HUAU without club accent?
- Does club accent feel integrated, not recolored template?
- Is HUAU mark correct and untouched?
- Does mobile require horizontal scroll unexpectedly?
- Are primary actions obvious?
- Are destructive actions explicit?
- Are tables legible?
- Is motion purposeful?
- Does reduced motion work?
- Does dark mode contrast pass?
- Does the page avoid generic “AI dashboard” patterns?

---

## 35. Design deliverables before implementation of each module

For each major module create:

1. sitemap/screen inventory;
2. low-fi flow;
3. desktop/mobile key screens;
4. component states;
5. empty/error/offline states;
6. final visual spec;
7. responsive QA screenshots;
8. accessibility check.

Tournament P0 screens get priority over Club P2 surfaces.

