# HUAU Sports - Open Decisions & ADR Register v1.0

**Estado:** Activo  
**Fecha:** 2026-08-29  
**Propósito:** registrar lo que todavía no está cerrado, evitar decisiones implícitas y gobernar cambios posteriores a la baseline.

---

## 1. Cómo usar este documento

No todo lo que permanece abierto bloquea desarrollo.

Cada item tiene:
- **Prioridad:** P0 / P1 / P2.
- **Estado:** OPEN / PROPOSED / ACCEPTED / SUPERSEDED.
- **Deadline:** momento en que debe resolverse, no necesariamente una fecha exacta.
- **Owner:** quién decide.
- **Impacto:** documentos/código afectados.

Reglas:
1. Un P0 debe resolverse antes del gate que lo necesita.
2. Una decisión aceptada que cambie arquitectura se convierte en ADR numerado.
3. No cambiar PRD/TRD por chat o código sin actualizar el ADR/documento canónico.
4. Preferir configuración frente a reglas inventadas del club piloto.
5. No bloquear P0 por decisiones P2.

---

# PARTE I - OPEN DECISIONS

## OD-001 - Reglas exactas del clasificatorio por equipos de septiembre

**Prioridad:** P0  
**Estado:** OPEN  
**Deadline:** antes de cerrar Team Engine acceptance fixtures  
**Owner:** Product / organizador del clasificatorio

### Ya definido
Orden base comunicado:
1. Men’s Doubles.
2. Women’s Doubles.
3. Men’s Singles.
4. Women’s Singles.
5. Mixed Doubles.

### Falta confirmar
- ¿el Mixed Doubles se juega siempre o sólo si la serie llega 2-2?;
- regla exacta de victoria de encounter;
- roster exacto permitido (4/6 u otra regla para ese evento);
- suplentes y sustituciones;
- cuándo se congela una alineación;
- si una persona puede jugar múltiples rubbers y con qué restricciones;
- sistema de grupos/liga/playoff del evento;
- criterios oficiales de standings de equipos;
- scoring exacto de cada rubber;
- tratamiento de retiro/WO/incomparecencia.

### Decisión de arquitectura ya cerrada
Ninguna de estas reglas se hardcodea. Se expresan en configuración de Team Format.

---

## OD-002 - Better Auth: adapter final y schema ownership

**Prioridad:** P0  
**Estado:** PROPOSED  
**Propuesta:** Better Auth + Drizzle sobre D1  
**Deadline:** Phase 1 / AUTH-001  
**Owner:** Engineering

Evaluar:
- esquema generado por Better Auth;
- migraciones auth junto al app schema;
- compatibilidad con Workers/D1;
- strategy de sesión;
- account linking futuro.

Criterio: menor lock-in y schema reproducible en CI/staging.

---

## OD-003 - Dominio definitivo

**Prioridad:** P0 comercial / no bloquea engine  
**Estado:** OPEN  
**Owner:** Product

Candidatos mencionados:
- `huau.uy`;
- `huau.com.uy`;
- otro dominio internacional si se adquiere.

La arquitectura no debe depender del dominio final.

---

## OD-004 - Mercado Pago OAuth / conexión de receptor

**Prioridad:** P0  
**Estado:** PROPOSED  
**Deadline:** PAY-001  
**Owner:** Engineering + Product

### Requisito funcional fijo
El dinero va directamente al receptor configurado del torneo, nunca a la cuenta HUAU en V1.

### Propuesta
- HUAU registra una aplicación de plataforma/marketplace;
- receptor conecta Mercado Pago por OAuth;
- HUAU guarda credenciales/tokens server-side;
- cada tournament referencia un `payment_account`;
- order se crea por registration;
- webhook confirmado actualiza pago.

### Falta cerrar
- onboarding exacto disponible para Uruguay;
- permisos/scopes requeridos;
- token refresh/rotation;
- encryption at rest strategy para seller tokens;
- sandbox/test account setup.

---

## OD-005 - Fee comercial HUAU Tournament

**Prioridad:** P1 comercial  
**Estado:** OPEN  
**Owner:** Product

Opciones futuras:
- por inscripción;
- fee por evento;
- mensualidad;
- híbrido.

Baseline V1:
- no retención automática;
- HUAU puede medir inscripciones facturables;
- cobro a organización ocurre por fuera.

Referencia de discovery: competidor reportado ~USD 3/inscripto. No constituye precio recomendado.

---

## OD-006 - Política de notificaciones

**Prioridad:** P1  
**Estado:** OPEN  
**Owner:** Product

Principio ya aceptado:
- email sólo para eventos importantes;
- evitar ruido;
- in-app para actividad ordinaria;
- push diferido.

Antes de habilitar email, aprobar matriz evento -> canal -> destinatario.

Candidatos críticos:
- verificación/recuperación;
- inscripción confirmada;
- pago confirmado/fallido relevante;
- cambio/cancelación crítica de torneo;
- reserva aprobada/rechazada/cancelada cuando Club llegue.

---

## OD-007 - Menores de edad

**Prioridad:** P2 / legal antes de rollout amplio  
**Estado:** OPEN  
**Owner:** Product + legal/local counsel cuando corresponda

Preguntas:
- cuenta propia vs perfil dependiente;
- edad mínima;
- guardian account;
- consentimiento;
- emails/telefono del responsable;
- exposición pública del nombre/foto;
- pagos.

P0 Tournament puede seguir usando participantes manuales para menores sin activar un flujo de self-service específico.

---

## OD-008 - Reglas exactas de membresía del club piloto

**Prioridad:** P1 Club  
**Estado:** OPEN  
**Owner:** club piloto + Product

Ya conocido:
- Pickleball;
- Pádel;
- Tenis;
- General;
- acceso a reservas sin pagar cada cancha.

Preguntar antes de Club pilot:
- vigencia/renovación;
- límites por día/semana;
- anticipación;
- invitados;
- horas consecutivas;
- cancelación;
- diferencia entre membresía general y acumulación de deportes;
- excepciones de staff/coach.

No inventar reglas en código; usar booking/membership policies.

---

## OD-009 - Política exacta de reserva

**Prioridad:** P1 Club  
**Estado:** OPEN

Confirmar con club:
- slot base;
- duración mínima/máxima;
- extensiones de 30 min;
- lead time;
- cantidad máxima de futuras;
- expiración de solicitud pendiente;
- cancelación;
- aprobación automática vs manual;
- bloqueo provisional;
- no-member/guest handling.

---

## OD-010 - Open Match cutoff

**Prioridad:** P1 Club  
**Estado:** OPEN

Definir como policy configurable:
- X horas antes de la reserva;
- mínimo de participantes para mantener;
- quién puede cancelar;
- qué sucede con waitlist;
- si la cancha se libera automáticamente.

No usar “3-4 horas” como hardcode.

---

## OD-011 - Coach creation/approval flow

**Prioridad:** P2  
**Estado:** OPEN

Opciones:
1. admin crea toda actividad;
2. coach crea draft y admin aprueba;
3. coach autorizado publica directamente.

Data model debe permitir las tres; UI inicial puede implementar sólo 1.

---

## OD-012 - Team standings por defecto

**Prioridad:** P0 engine  
**Estado:** PROPOSED

Propuesta genérica para formats que no declaren otra cosa:
1. encounter win percentage;
2. rubber differential por encounter o total normalizado según format;
3. point differential normalizado;
4. direct encounter/head-to-head donde aplique;
5. explicit fallback.

**Importante:** el torneo de septiembre debe seguir su reglamento oficial aunque difiera.

El engine debe aceptar ordered tie-break criteria como config.

---

## OD-013 - Team lineup lock

**Prioridad:** P0 teams  
**Estado:** OPEN

Necesitamos policy:
- editable hasta X momento;
- lock al comenzar encounter;
- sustituciones después de lock;
- rol autorizado;
- impacto de WO/injury.

Diseño recomendado: `draft -> submitted -> locked`, con override administrativo auditado.

---

## OD-014 - Public participant visibility

**Prioridad:** P0 privacy  
**Estado:** PROPOSED

Default recomendado:
- nombre deportivo/entry: visible cuando tournament publica participantes;
- email, teléfono, DOB, pago: jamás públicos;
- rating sólo si tournament config lo publica;
- perfiles de menores: policy especial futura.

Organization Admin puede ocultar participant list hasta draw.

---

## OD-015 - Result correction authority

**Prioridad:** P0 Tournament  
**Estado:** PROPOSED

Propuesta V1:
- Organization Admin/delegate autorizado puede corregir;
- corrección crea audit event y recalcula derivados;
- si afecta fase posterior ya iniciada, bloquear y exigir resolution flow;
- jugador nunca edita score oficial.

---

## OD-016 - Delegate/operator capability

**Prioridad:** P1/P0 según evento  
**Estado:** OPEN

El usuario simplificó jerarquía a Platform Admin / Organization Admin / User. Sin embargo, eventos grandes pueden necesitar personas que sólo carguen resultados.

Propuesta:
- no crear nueva jerarquía global;
- añadir capability contextual `tournament_operator` asignada por evento;
- UI reducida: próximos matches + resultado;
- sin acceso a format/config/payment.

No necesaria para primer pilot si una sola persona opera.

---

## OD-017 - Realtime conflict UX

**Prioridad:** P0 technical  
**Estado:** PROPOSED

No construir colaboración estilo Google Docs.

Propuesta:
- revision en entidades estructurales;
- optimistic concurrency;
- si revision cambió, servidor rechaza con conflict;
- cliente refresca y explica “el torneo cambió en otro dispositivo”.

Resultados usan mutation IDs e idempotencia.

---

## OD-018 - R2 use in P0

**Prioridad:** P1  
**Estado:** PROPOSED

P0 usa R2 sólo cuando haya archivo real:
- logos;
- imágenes/assets subidos.

No almacenar comprobantes de transferencia en V1; usar WhatsApp/manual validation.

---

## OD-019 - Native mobile path

**Prioridad:** P2  
**Estado:** OPEN

V1 = PWA.

Cuando exista evidencia de necesidad iOS/Android:
- evaluar Capacitor vs React Native/Expo vs wrappers;
- engines/domain deben ser reutilizables independientemente de decisión.

No condicionar P0 al stack nativo.

---

## OD-020 - Más idiomas

**Prioridad:** P2
**Estado:** OPEN

V1 release quality:
- Spanish;
- English.

Arquitectura permite locales adicionales. Antes de añadir un idioma, traducciones de reglas competitivas deben tener revisión humana; no depender de traducción automática runtime para criterios oficiales.

---

# PARTE II - ADRs ACEPTADOS EN BASELINE

## ADR-001 - Una plataforma, identidad global, módulos separados

**Estado:** ACCEPTED  
**Fecha:** 2026-08-29

### Decisión
Una cuenta HUAU global; módulos Club/Tournament; Ref como capability de Tournament.

### Consecuencia
No duplicar usuarios entre productos. Roles/capabilities son contextuales a organización/evento.

---

## ADR-002 - Organization como tenant raíz

**Estado:** ACCEPTED

### Decisión
La entidad raíz es `organization`, no `club`.

### Razón
HUAU debe servir club, complejo, academia, comunidad, organizador, liga o federación.

### Consecuencia
`venue`, tournament organizer y payment receiver pueden ser entidades distintas.

---

## ADR-003 - Cloudflare-first V1

**Estado:** ACCEPTED BASELINE, revisable sólo con evidencia

### Decisión
- Workers + Static Assets;
- D1;
- R2;
- Durable Objects/WebSockets;
- Better Auth;
- Resend;
- Mercado Pago.

### Razón
Coste inicial bajo, stack suficiente y despliegue integrado.

### Guardrail
No acoplar domain engines a Cloudflare APIs.

---

## ADR-004 - Tournament offline-resilient

**Estado:** ACCEPTED

### Decisión
Operación crítica de resultados debe guardar localmente y continuar ante pérdida de Internet.

### Consecuencia
IndexedDB + mutation outbox + revisions + reconciliation forman parte de P0, no “mejora futura”.

---

## ADR-005 - D1 no reemplaza autorización

**Estado:** ACCEPTED

### Decisión
Todo acceso tenant-scoped se valida server-side en Worker/service layer. No existe RLS implícita como defensa.

### Consecuencia
Tests de aislamiento multi-tenant son blocker de release.

---

## ADR-006 - Encounter + atomic matches

**Estado:** ACCEPTED

### Decisión
El torneo trabaja con `competition_encounter` de alto nivel y `match` atómico.

### Razón
Un encounter individual/pareja suele tener 1 match; un team encounter puede tener N rubbers.

### Consecuencia
Teams reutiliza grupos/league/playoff en vez de crear un segundo motor.

---

## ADR-007 - Team format es config-driven

**Estado:** ACCEPTED

### Decisión
No hardcodear MLP ni clasificatorio septiembre.

Formato define roster, composición, rubbers, orden, condiciones y series winner rule.

---

## ADR-008 - Explicación de formato determinista

**Estado:** ACCEPTED

### Decisión
Las explicaciones oficiales se generan desde reglas/configuración mediante bloques i18n revisados, no mediante texto AI runtime.

### Consecuencia
El texto matemático oficial no es editable; organizer puede agregar nota separada.

---

## ADR-009 - Pago directo al receptor

**Estado:** ACCEPTED

### Decisión
HUAU V1 no cobra primero para redistribuir. Tournament referencia `payment_account` del receptor.

### Consecuencia
Mercado Pago se conecta por receptor; HUAU fee se factura fuera inicialmente.

---

## ADR-010 - Payment confirmation es server-authoritative

**Estado:** ACCEPTED

### Decisión
Redirect del browser no confirma pago. Estado `paid` automático requiere webhook/API verificado.

Manual transfer/cash se marca por admin.

---

## ADR-011 - Public Live es una proyección única responsive

**Estado:** ACCEPTED

### Decisión
TV y móvil consumen los mismos datos públicos con layouts responsive.

### Consecuencia
No mantener un estado TV separado del public state.

---

## ADR-012 - Safe structural mutations

**Estado:** ACCEPTED

### Decisión
Cambios estructurales requieren scope/impact, snapshot y confirmación; cosmetics no invalidan competencia.

### Consecuencia
La regresión legacy de “editar nombre borra categorías” es un blocker automático.

---

## ADR-013 - Critical audit, no enterprise logging UI

**Estado:** ACCEPTED

### Decisión
Registrar mutaciones críticas para soporte y recovery, sin convertir el producto en un panel de auditoría empresarial.

Mínimo:
- actor;
- organization/tournament;
- action;
- entity;
- before/after summary o references;
- timestamp;
- support-mode flag.

---

## ADR-014 - Soporte de plataforma explícito

**Estado:** ACCEPTED

### Decisión
HUAU Platform Admin puede abrir contexto de una organización para soporte, pero:
- acceso requiere acción explícita;
- writes se auditan;
- UI distingue support mode;
- no “impersonation” invisible.

---

## ADR-015 - PWA primero, native después

**Estado:** ACCEPTED

### Decisión
V1 es web/PWA instalable. Apps nativas se evalúan luego.

### Consecuencia
Responsive/offline/installability deben ser de calidad de producto, no demo.

---

## ADR-016 - UI typography Montserrat; logo como asset

**Estado:** ACCEPTED

### Decisión
Montserrat para interfaz/product UI. El wordmark/logo oficial HUAU se usa como asset y no se recrea tipográficamente.

### Consecuencia
La nueva UI se distancia del aspecto genérico/AI manteniendo identidad deportiva.

---

## ADR-017 - Open Match requiere cancha

**Estado:** ACCEPTED

### Decisión
No existen posts genéricos “busco jugadores” sin reserva/solicitud de cancha asociada.

### Consecuencia
Community y booking comparten un único objeto operativo.

---

## ADR-018 - Open Play simple

**Estado:** ACCEPTED

### Decisión
Open Play V1 gestiona actividad, canchas, cupos, nivel y waitlist. No genera rotaciones, asistencia ni sanciones.

---

## ADR-019 - Membership billing fuera de V1

**Estado:** ACCEPTED

### Decisión
HUAU almacena estado/entitlement de membresía; el club cobra por sus canales actuales.

---

## ADR-020 - Deportes V1 limitados

**Estado:** ACCEPTED

### Decisión
Pickleball, pádel y tenis. No optimizar dominio ahora para fútbol/básquet/etc.

---

## ADR-021 - Capabilities configurables sin jerarquía de clientes

**Estado:** ACCEPTED

### Decisión
La jerarquía visible V1 sigue siendo Platform Admin / Organization Admin / User. Capacidades adicionales como coach u operador pueden recibir permisos simples configurables por organización, sin introducir roles administrativos escalonados.

### Consecuencia
El backend modela capability policies, pero la UI V1 sólo expone toggles que tengan una necesidad real.

---

# PARTE III - CHANGE CONTROL

## 2. Cuándo crear un ADR nuevo

Crear ADR cuando se cambie cualquiera de estos:
- tenant model;
- auth provider;
- database/storage;
- offline/realtime strategy;
- payment ownership;
- public/private data boundary;
- competition abstractions;
- team format model;
- destructive mutation/recovery model;
- i18n strategy;
- deployment topology;
- scope P0 que comprometa el evento real.

No hace falta ADR para:
- copy;
- spacing;
- iconos;
- bugfix que restaura el comportamiento documentado;
- componente visual que no cambia contrato.

---

## 3. Template ADR

```md
## ADR-XXX - Título

**Estado:** PROPOSED | ACCEPTED | SUPERSEDED
**Fecha:** YYYY-MM-DD

### Contexto
...

### Decisión
...

### Alternativas consideradas
1. ...
2. ...

### Consecuencias
- positivas;
- negativas;
- migración.

### Documentos afectados
- PRD;
- TRD;
- Data Model;
- etc.
```

---

## 4. Baseline freeze rule

A partir de v1.0:

> Una idea nueva no entra automáticamente porque “sería lindo tenerla”.

Debe clasificarse:
- required for current acceptance criteria;
- P1/P2 roadmap;
- explicit scope change.

Cualquier scope change antes del clasificatorio de septiembre debe demostrar que reduce riesgo o es requerido por el evento. Si no, se difiere.

---

## 5. Open Decisions que bloquean el inicio del desarrollo

**Ninguna.**

El scaffolding, auth, tenancy, Tournament Engine extraction, scheduler fix y Team Engine schema pueden comenzar con la baseline actual.

Los items P0 deben resolverse antes de sus gates específicos:
- OD-001 antes del fixture final de septiembre;
- OD-002 antes de auth production schema;
- OD-004 antes de payment production;
- OD-012/013 antes de Team Engine sign-off;
- OD-014/015/017 antes de public/result production sign-off.

---

## 6. Definition of Done del discovery

Discovery v1.0 puede considerarse terminado porque:
- propuesta de producto y módulos están definidos;
- actores y permisos principales están definidos;
- Club MVP está acotado;
- Tournament P0 está acotado;
- Teams tiene abstracción configurable;
- Ref tiene rol claro;
- pagos tienen ownership claro;
- seguridad/recovery tienen requisitos claros;
- stack baseline está elegido;
- las incertidumbres restantes están visibles y tienen gate.

El siguiente trabajo es implementación y validación, no continuar agregando features al PRD.
