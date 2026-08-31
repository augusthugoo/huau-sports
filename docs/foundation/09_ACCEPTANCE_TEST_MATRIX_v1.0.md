# HUAU Sports - Acceptance & Release Test Matrix v1.0

**Estado:** Baseline QA  
**Fecha:** 2026-08-29  
**Objetivo:** convertir PRD/TRD en pruebas verificables antes de usar HUAU en producción real.

---

## 1. Principio

HUAU no se considera listo porque “la pantalla funciona”. Cada flujo crítico debe demostrar:

1. resultado funcional correcto;
2. persistencia correcta;
3. permisos correctos;
4. comportamiento offline/retry cuando corresponda;
5. ausencia de pérdida de datos;
6. explicación clara al operador;
7. regresión cubierta por test automatizado cuando sea lógica determinista.

---

## 2. Severidad

- **BLOCKER:** impide usar HUAU en un evento real.
- **CRITICAL:** puede causar resultado, pago, privacidad o datos incorrectos.
- **MAJOR:** operación posible pero con fricción/función importante incompleta.
- **MINOR:** estética/copy sin impacto operativo.

No hay release para torneo real con BLOCKER conocido.

---

## 3. Gates

### Gate A - Foundation
- app deploya en staging;
- lint/typecheck/tests pasan;
- migrations reproducibles;
- auth funciona;
- tenant isolation tests pasan.

### Gate B - Tournament Engine parity
- fixtures legacy pasan;
- standings correctos;
- normalized/equalized correctos;
- bracket/byes/progression correctos;
- scheduler two-round fix probado.

### Gate C - Teams
- builder configurable;
- roster/lineup validator;
- encounter/rubbers;
- winner/standings;
- fixture septiembre.

### Gate D - Registration + Payments
- user registration;
- entry invitations;
- waitlist;
- Mercado Pago test webhook;
- manual payment;
- no false-positive paid state.

### Gate E - Public/Live + Offline
- public projection privacy;
- live invalidation;
- IndexedDB/outbox;
- reconnect;
- restore;
- PWA.

### Gate F - Event rehearsal
- torneo completo end-to-end;
- dispositivos reales;
- network failure;
- final/bronze/team winner;
- backup export;
- fallback plan.

---

# PARTE I - AUTH / ORGANIZATIONS

## AUTH-AT-001 - Registro de usuario
**Severidad:** CRITICAL

Given email no existente  
When usuario registra nombre/apellido/email/password válido  
Then se crea identidad HUAU y sesión válida  
And no se asigna automáticamente a organizaciones.

## AUTH-AT-002 - Email duplicado
**Severidad:** MAJOR

No se crean dos cuentas para el mismo identity email normalizado.

## AUTH-AT-003 - Multi-organization
**Severidad:** CRITICAL

Un usuario aprobado en Org A y Org B puede cambiar de contexto sin duplicar su cuenta.

## TENANT-AT-001 - Aislamiento lectura
**Severidad:** BLOCKER

Un Organization Admin de A no puede consultar members, payments, tournaments privados ni reservations de B modificando URL/IDs/API params.

## TENANT-AT-002 - Aislamiento escritura
**Severidad:** BLOCKER

Un token/session de A no puede mutar ninguna entidad tenant-owned de B.

## SUPPORT-AT-001 - Platform support mode
**Severidad:** CRITICAL

Platform Admin puede abrir contexto de soporte; UI indica support mode; todo write crítico registra actor real y support flag.

---

# PARTE II - TOURNAMENT LEGACY PARITY

## TENG-AT-001 - Grupo de 3, 1 vuelta
**Severidad:** CRITICAL

3 entries producen exactamente 3 encounters de grupo sin duplicados.

## TENG-AT-002 - Grupo de 4, 2 vueltas
**Severidad:** BLOCKER

4 entries producen 12 encounters de grupo.  
El schedule coloca todos los encuentros de round/leg 1 antes de cualquier rematch de leg 2.

## TENG-AT-003 - Two-round rotation
**Severidad:** CRITICAL

Dentro de cada vuelta, el scheduler evita back-to-back del mismo entry siempre que exista otro match elegible y respeta rest policy configurable.

## TENG-AT-004 - Day 2 regression
**Severidad:** BLOCKER

Una categoría asignada a segundo día programa todos sus matches, no sólo el primero.

## STAND-AT-001 - Two-way tie
**Severidad:** CRITICAL

El head-to-head se aplica donde la regla declarada corresponde.

## STAND-AT-002 - Multi-way tie
**Severidad:** CRITICAL

Mini-table y siguientes tiebreakers se aplican en orden documentado.

## CROSS-AT-001 - Uneven normalized
**Severidad:** BLOCKER

Para grupos 3/4/4:
- win percentage no usa raw wins como comparador primario;
- diff se divide por matches computados;
- points scored se normaliza por match;
- output incluye stats usados para explicación.

## CROSS-AT-002 - Uneven equalized
**Severidad:** BLOCKER

Para grupos 3/4/4, ranking cruzado de grupos de 4 usa sólo la cantidad de rivales equivalente al grupo mínimo según regla; standings internos siguen incluyendo todos los partidos.

## QUAL-AT-001 - Fixed qualifiers
**Severidad:** CRITICAL

N por grupo produce cantidad correcta y seed pool correcto.

## QUAL-AT-002 - Wildcard
**Severidad:** CRITICAL

Cupo extra por rendimiento se selecciona usando cross-group method activo.

## BRKT-AT-001 - Byes
**Severidad:** BLOCKER

Bracket de tamaño superior a qualifiers asigna byes y auto-advance sin crear ganador equivocado.

## BRKT-AT-002 - Avoid group rematch
**Severidad:** MAJOR

Cuando existe asignación válida, primera fase evita enfrentar nuevamente miembros del mismo grupo según policy.

## BRKT-AT-003 - Bronze
**Severidad:** CRITICAL

Perdedores de semifinal alimentan bronze correctamente cuando está habilitado.

## BO3-AT-001 - Medal BO3
**Severidad:** BLOCKER

Final/bronce BO3 determina ganador con 2 sets y no exige tercer set en 2-0.

## SAFE-AT-001 - Cosmetic player edit
**Severidad:** BLOCKER

Cambiar nombre/contacto de persona con grupo/schedule/resultados existentes no borra ni regenera estructura.

## SAFE-AT-002 - Structural edit impact
**Severidad:** BLOCKER

Cambiar composición/categoría informa exactamente qué estructura será afectada, crea snapshot y requiere confirmación.

## SAFE-AT-003 - Structure lock
**Severidad:** BLOCKER

Con categoría bloqueada, mutaciones estructurales ordinarias son rechazadas hasta explicit unlock/override autorizado.

## SAFE-AT-004 - Restore snapshot
**Severidad:** BLOCKER

Después de mutación estructural, restore recupera grupos, schedule, matches/resultados dentro del scope versionado esperado.

---

# PARTE III - TEAM COMPETITION

## TEAM-AT-001 - Configurable roster
**Severidad:** BLOCKER

Organizador puede crear team format con roster size/composition configurables y el validator rechaza alineación inválida.

## TEAM-AT-002 - Ordered rubbers
**Severidad:** BLOCKER

Encounter respeta orden configurado de rubbers y no asume hardcoded MLP.

## TEAM-AT-003 - September fixture
**Severidad:** BLOCKER

Fixture puede expresar:
1. Men’s Doubles;
2. Women’s Doubles;
3. Men’s Singles;
4. Women’s Singles;
5. Mixed Doubles;
sin código especial para el nombre del torneo.

## TEAM-AT-004 - Conditional tiebreak rubber
**Severidad:** CRITICAL

Un rubber `if_tied` sólo se activa cuando la serie cumple condición; si format declara `always`, siempre se juega.

## TEAM-AT-005 - Encounter winner
**Severidad:** BLOCKER

Winner se deriva exactamente del series win rule; no de cantidad fija hardcodeada.

## TEAM-AT-006 - Team standings
**Severidad:** BLOCKER

Ordered criteria configurados producen standings deterministas y explanation payload.

## TEAM-AT-007 - Groups/playoff reuse
**Severidad:** CRITICAL

Teams pueden ser entries de groups/league/playoff usando el mismo progression framework de singles/pairs.

## TEAM-AT-008 - Lineup lock
**Severidad:** CRITICAL

Una lineup locked no cambia silenciosamente luego de iniciar encounter; override autorizado queda auditado.

---

# PARTE IV - FORMAT EXPLANATION

## EXPL-AT-001 - Determinismo
**Severidad:** CRITICAL

Misma format version + locale produce la misma explicación.

## EXPL-AT-002 - Normalized explanation
**Severidad:** CRITICAL

Texto ES/EN explica porcentaje de victorias, diferencia promedio y puntos promedio, sin decir “diferencia total” cuando no corresponde.

## EXPL-AT-003 - Equalized explanation
**Severidad:** CRITICAL

Texto ES/EN explica que la comparación externa usa una cantidad equiparada de partidos y que standings internos conservan todos.

## EXPL-AT-004 - Format consistency
**Severidad:** BLOCKER

Si organizer cambia qualifiers/rounds/playoff, explicación se regenera; no puede quedar texto oficial contradictorio con configuración.

## EXPL-AT-005 - Organizer note separation
**Severidad:** MAJOR

Organizer puede añadir nota propia claramente separada de “Reglas del formato HUAU”.

---

# PARTE V - REGISTRATION

## REG-AT-001 - Individual registration
**Severidad:** CRITICAL

Eligible user puede iniciar inscripción individual y recibe estado correcto según payment policy.

## REG-AT-002 - Pair invitation
**Severidad:** BLOCKER

Usuario inicia doubles entry, invita partner HUAU, partner acepta, entry queda completa sin duplicar personas.

## REG-AT-003 - Team captain/roster
**Severidad:** BLOCKER

Captain crea team registration e invita roster según format; no confirma equipo incompleto si rules lo prohíben.

## REG-AT-004 - Manual participant
**Severidad:** BLOCKER

Organization Admin puede crear/inscribir persona sin cuenta HUAU y luego Tournament funciona normalmente.

## REG-AT-005 - Capacity
**Severidad:** CRITICAL

Al alcanzar category capacity, siguientes registrations van a waitlist según policy y no exceden cupo por race condition.

## REG-AT-006 - Complimentary/discount
**Severidad:** MAJOR

Admin puede crear cortesía/descuento y estado de payment requirement se deriva correctamente.

---

# PARTE VI - PAYMENTS

## PAY-AT-001 - Payment receiver
**Severidad:** BLOCKER

Tournament A puede cobrar a Payment Account X aunque la Organization/venue tenga otra cuenta configurada.

## PAY-AT-002 - Redirect no confirma
**Severidad:** BLOCKER

Volver desde Mercado Pago sin webhook/API validado no cambia registration a paid.

## PAY-AT-003 - Approved webhook
**Severidad:** BLOCKER

Webhook firmado/verificado de pago aprobado actualiza payment asociado a registration exacta y confirma entry según policy.

## PAY-AT-004 - Idempotent webhook
**Severidad:** BLOCKER

Mismo evento repetido no duplica payment, entry ni efectos.

## PAY-AT-005 - Wrong amount/reference
**Severidad:** BLOCKER

Webhook con order/reference/amount incompatibles no confirma inscripción automáticamente.

## PAY-AT-006 - Manual transfer
**Severidad:** CRITICAL

Admin puede marcar transfer/cash paid; actor/timestamp quedan registrados; no requiere upload de comprobante.

## PAY-AT-007 - Rejection/refund external
**Severidad:** MAJOR

Admin puede reflejar estado cancelado/refunded/manual resolution sin que HUAU pretenda haber ejecutado refund automático V1.

---

# PARTE VII - PUBLIC / LIVE / PRIVACY

## PUB-AT-001 - No-login access
**Severidad:** CRITICAL

Visitor puede abrir tournament público sin autenticación.

## PUB-AT-002 - Public fields only
**Severidad:** BLOCKER

Public API nunca expone email, phone, DOB, payment details, auth IDs/secrets o private notes.

## PUB-AT-003 - Responsive live
**Severidad:** MAJOR

Misma URL funciona teléfono/desktop/TV y muestra layouts adecuados.

## LIVE-AT-001 - Revision invalidation
**Severidad:** CRITICAL

Resultado persistido incrementa/publica revision; clientes live actualizan sin reload manual.

## LIVE-AT-002 - Reconnect
**Severidad:** MAJOR

WebSocket desconectado/reconectado obtiene revision actual y no queda congelado en estado antiguo.

---

# PARTE VIII - OFFLINE / SYNC

## OFF-AT-001 - Result saved without Internet
**Severidad:** BLOCKER

Con operador offline, guardar resultado lo persiste en IndexedDB inmediatamente y UI lo refleja como pending sync.

## OFF-AT-002 - Browser reload offline
**Severidad:** BLOCKER

Después de guardar resultado offline y recargar PWA, resultado/outbox siguen presentes.

## OFF-AT-003 - Reconnect sync
**Severidad:** BLOCKER

Al volver conexión, mutation se envía una vez, servidor responde authoritative revision y pending state desaparece.

## OFF-AT-004 - Idempotent retry
**Severidad:** BLOCKER

Si respuesta se pierde y cliente reintenta, mutation UUID evita doble efecto.

## OFF-AT-005 - Conflict
**Severidad:** BLOCKER

Si server revision cambió de forma incompatible, cliente no hace last-write-wins silencioso; muestra resolución requerida.

## OFF-AT-006 - Public stale semantics
**Severidad:** MAJOR

Mientras operator está offline, public live conserva último estado server sincronizado y no inventa resultados pendientes locales.

---

# PARTE IX - CLUB MVP

## MEM-AT-001 - Join request
**Severidad:** CRITICAL

User solicita membership; Org Admin aprueba/rechaza; entitlement cambia sólo tras aprobación.

## MEM-AT-002 - Multi-sport entitlement
**Severidad:** CRITICAL

Un member puede tener Pickleball active, Padel active, Tennis inactive o General según policy.

## BOOK-AT-001 - Availability
**Severidad:** BLOCKER Club

User ve slots según sport/court/policy y no puede reservar bloque administrativo.

## BOOK-AT-002 - Pending hold
**Severidad:** BLOCKER Club

Solicitud pendiente que requiere aprobación bloquea provisionalmente slot según policy y evita doble confirmación.

## BOOK-AT-003 - Admin approve/reject
**Severidad:** CRITICAL

Recepción aprueba o rechaza; user ve estado correcto; rechazo libera slot.

## BOOK-AT-004 - Configurable duration
**Severidad:** CRITICAL

Club puede usar 60 min + incrementos de 30 u otra policy soportada sin cambiar código.

## OPEN-AT-001 - Open match requires reservation
**Severidad:** CRITICAL

No se publica open match sin reservation/request asociado.

## OPEN-AT-002 - Slot reopens
**Severidad:** CRITICAL

Si participant se baja antes de cutoff, su lugar vuelve a estar disponible y el post permanece.

## OPEN-AT-003 - Waitlist
**Severidad:** MAJOR

Match lleno puede aceptar waitlist y promotion no excede capacity.

## OPENPLAY-AT-001 - Capacity-only
**Severidad:** MAJOR

Open Play maneja cupo/waitlist/canchas sin exigir rotaciones/asistencia/no-show.

---

# PARTE X - REF ENGINE

## REF-AT-001 - Traditional doubles
**Severidad:** CRITICAL

Port de legacy conserva opening server, server number, side-out, rotation y called score.

## REF-AT-002 - Traditional singles
**Severidad:** CRITICAL

Sólo servidor anota y serving side corresponde al score.

## REF-AT-003 - Rally
**Severidad:** CRITICAL

Cada rally suma punto y serve info/positions se mantienen según reglas preservadas.

## REF-AT-004 - Win by two
**Severidad:** CRITICAL

Set no termina 11-10 y sí termina al alcanzar diferencia 2 después del target.

## REF-AT-005 - BO3/BO5
**Severidad:** CRITICAL

Sets needed y transition between sets correctos.

## REF-AT-006 - Undo/redo/correction
**Severidad:** BLOCKER Ref

Undo/redo restaura estado completo; correction actualiza score/serve/position de forma consistente.

## REF-AT-007 - Timeout/warning
**Severidad:** MAJOR

Timeout count/timer y warnings persisten correctamente.

## REF-AT-008 - Offline standalone
**Severidad:** BLOCKER Ref

Un árbitro puede completar match sin Internet y no perder scoring state por reload accidental.

---

# PARTE XI - UX / ACCESSIBILITY / PWA

## UX-AT-001 - Player mobile
**Severidad:** MAJOR

Core flows de user funcionan en viewport de teléfono sin horizontal scroll operativo.

## UX-AT-002 - Admin desktop/tablet
**Severidad:** MAJOR

Tournament/Club administration es usable con pointer/keyboard y tablet landscape.

## UX-AT-003 - Ref tablet
**Severidad:** CRITICAL Ref

Scoring controls son grandes, contrastados y utilizables en tablet landscape bajo presión.

## A11Y-AT-001 - Keyboard/focus
**Severidad:** MAJOR

Dialogs/forms críticos tienen focus visible, labels y cierre correcto.

## A11Y-AT-002 - Reduced motion
**Severidad:** MINOR/MAJOR según componente

Public motion respeta `prefers-reduced-motion`.

## PWA-AT-001 - Installability
**Severidad:** MAJOR

Manifest/icons/service worker válidos; app se puede instalar en browsers objetivo.

---

# PARTE XII - RELEASE REHEARSAL DE SEPTIEMBRE

## 4. Rehearsal obligatorio

Crear un torneo staging con configuración real del clasificatorio una vez recibidas las reglas finales.

Ejecutar con al menos:
- laptop de mesa;
- teléfono operador;
- TV/public screen;
- segundo teléfono como public visitor;
- conexión estable primero;
- luego pérdida deliberada de Internet.

Simular:
1. registrations;
2. payment states sandbox/manual;
3. team roster;
4. lineup;
5. draw/groups;
6. schedule;
7. todos los encounters;
8. rubbers;
9. tie scenario;
10. standings;
11. playoff;
12. final;
13. corrección de un resultado;
14. backup;
15. offline result;
16. reconnect;
17. restore de snapshot en staging.

---

## 5. Feature freeze

Antes del evento:
- congelar features;
- sólo blocker/critical fixes;
- backup export probado;
- legacy local fallback disponible;
- credenciales/entorno product verificados;
- venue/device test;
- procedimiento de “qué hago si no hay Internet” escrito en 1 página.

---

## 6. Go / No-Go

### GO
Sólo si:
- 0 BLOCKER abiertos;
- P0 Critical aceptados o mitigados explícitamente;
- rehearsal completo pasa;
- offline save/reconnect pasa;
- payment confirmation no tiene false-positive path;
- team standings/winner pasan fixtures oficiales;
- backup/restore probado;
- tenant/public privacy tests pasan.

### NO-GO
Si:
- existe riesgo conocido de pérdida de torneo;
- Team Engine no representa regla oficial;
- no se puede operar sin conexión;
- pagos pueden aparecer falsamente aprobados;
- un tenant puede acceder a otro;
- public API filtra datos privados.

En NO-GO, usar la estrategia de fallback definida y no “probar suerte” en producción.

---

## 7. Definition of Done de Foundation QA

Este documento está listo para convertirse en tests cuando cada requirement tenga:
- ID de ticket;
- test unit/integration/e2e owner;
- fixture;
- expected output;
- automated/manual classification.

Durante implementación, cada PR/ticket P0 debe referenciar al menos un acceptance ID relevante.
