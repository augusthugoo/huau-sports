# HUAU Sports - Legacy Migration Map v1.0

**Estado:** Baseline de migración  
**Fecha:** 2026-08-29  
**Fuentes legacy revisadas:** HUAU Tournament V2.4.2 Local + Netlify Autocarga; HUAU Ref Beta 1.8  
**Objetivo:** preservar la lógica validada, eliminar acoplamientos legacy y evitar reescribir a ciegas comportamientos ya probados.

---

## 1. Propósito

Este documento responde una pregunta concreta durante el replatforming de HUAU:

> ¿Qué parte de la solución actual debe conservarse como regla de dominio, qué parte debe reescribirse como infraestructura/UI y qué parte debe retirarse?

La migración **no** consiste en copiar `app.js` dentro del producto cloud. La versión actual mezcla UI, estado, persistencia, scheduling, standings, draw, bracket, exportación y sincronización local. La nueva arquitectura debe extraer las reglas validadas a paquetes puros de dominio y reconstruir la capa de aplicación alrededor de ellas.

Las referencias de funciones que aparecen aquí corresponden al código legacy inspeccionado y sirven para localizar comportamiento, no como contratos de API futuros.

---

## 2. Estrategia de migración

Cada capacidad legacy se clasifica como una de estas acciones:

- **PORTAR:** la regla existe y debe preservarse con tests de paridad.
- **PORTAR + CORREGIR:** existe, pero el comportamiento debe cambiar por un bug/requisito nuevo.
- **REDISEÑAR:** la necesidad permanece, pero la implementación actual no debe trasladarse.
- **REEMPLAZAR:** la nueva plataforma ofrece una infraestructura distinta.
- **ARCHIVAR:** queda como fallback/referencia; no entra al nuevo runtime.
- **DIFERIR:** se conserva el conocimiento, pero se implementa después del P0.

Regla principal:

> Ninguna pantalla legacy se considera fuente de verdad. Las reglas de dominio sí pueden serlo cuando están documentadas, verificadas y cubiertas por tests.

---

# PARTE I - HUAU TOURNAMENT

## 3. Estado y persistencia

### 3.1 Estado monolítico JSON

**Legacy**
- `defaultState()`
- `loadState()`
- `normalizeState()`
- `saveState()`
- `getState()`
- `exportBackup()`
- `importBackupFile()`

**Acción:** REEMPLAZAR + conservar import/export.

**Nueva ubicación:**
- D1 como fuente cloud persistente.
- IndexedDB como working state offline del operador.
- snapshots explícitos para recuperación.
- importador/exportador JSON de compatibilidad.

**Debe preservarse**
- posibilidad de exportar un respaldo portable;
- posibilidad de operar con participantes manuales;
- normalización/migración de datos legacy al importar;
- ausencia de dependencia obligatoria de una cuenta de jugador para competir.

**No portar**
- un único objeto global como fuente de verdad de toda la aplicación;
- writes directos de UI a `localStorage`;
- invalidación global de `state.schedule` por cambios no relacionados.

---

### 3.2 Local Server / polling

**Legacy**
- `huau_server.py`
- `/api/state`
- `sendStateToServer()`
- `pollServerState()`
- `applyRemoteState()`
- `startServerSync()`

**Acción:** REEMPLAZAR.

**Nueva ubicación:**
- API Worker + D1 para persistencia;
- Durable Object/WebSocket para invalidaciones live;
- IndexedDB + outbox para offline;
- revisionado/idempotencia para mutaciones.

**Fallback:** archivar la versión local V2.4.2 y mantenerla intacta hasta que la nueva plataforma pase rehearsal completo.

---

### 3.3 Netlify bundled state

**Legacy**
- `bundledStateFromPayload()`
- `tryBundledTournamentPaths()`
- `loadBundledTournamentIfEmpty()`

**Acción:** ARCHIVAR.

Fue una solución útil para abrir una copia estática de un torneo, pero no resuelve sincronización multi-dispositivo. La nueva página pública obtiene su proyección desde backend/live state.

---

## 4. Personas, parejas y participantes

### 4.1 Persona única y edición

**Legacy**
- `findPlayer()`
- `upsertPlayer()`
- `removePlayer()`
- `syncPartnerLinks()`
- `findPlayerByName()`

**Acción:** PORTAR CON REDISEÑO DE DATOS.

**Nueva ubicación:**
- `profiles` para usuarios HUAU;
- `organization_people` para identidad operativa/manual;
- `competition_entries` para entradas individuales/parejas/equipos;
- `entry_members` para composición.

**Regla preservada:** una persona se registra una vez y puede aparecer en múltiples categorías.

**Nueva regla:** un participante manual puede luego vincularse a una cuenta HUAU sin reescribir resultados históricos.

---

### 4.2 Edición segura

**Legacy relevante**
- `playerStructureChanged()`
- `refreshCompetitionReferences()`
- `invalidateCompetitionsForPlayerChange()`

V2.4 corrigió el problema por el cual editar un nombre podía destruir categorías/cronograma.

**Acción:** PORTAR COMO REGLA DE SEGURIDAD, no como implementación.

**Nueva regla:**

Cambios **cosméticos/no estructurales** no regeneran competencia:
- nombre;
- contacto;
- club;
- notas;
- rating si no se solicita re-seeding explícito.

Cambios **estructurales** requieren cálculo de impacto:
- entrada/salida de categoría;
- composición de pareja/equipo;
- estado que afecta elegibilidad;
- reglas competitivas;
- roster/alineación cuando el match ya existe.

Antes de aplicar una mutación destructiva:
1. mostrar impacto;
2. crear snapshot;
3. exigir confirmación explícita;
4. limitar invalidación al scope afectado;
5. permitir restore.

---

## 5. Categorías y entries

**Legacy**
- `isSinglesCategory()`
- `isDoublesCategory()`
- `getCategoryEntries()`
- category order/date functions.

**Acción:** PORTAR + GENERALIZAR.

La nueva abstracción no debe depender de strings como “Singles Masculino B”.

Nueva categoría/competition config debe separar:
- sport;
- entry type: `individual | pair | team`;
- gender/composition rule;
- level/division;
- age band opcional/futuro;
- format version.

**Compatibilidad:** el importador legacy infiere estos campos de la categoría actual cuando sea posible y permite revisión manual cuando no sea inequívoco.

---

## 6. Format simulator y formatos flexibles

### 6.1 Simulador

**Legacy**
- `buildFormatOptions()`
- `recalculateFormatTiming()`
- `balancedGroupSizes()`
- `calculateGroupMatchCountFromSizes()`
- `effectiveQualifiedCount()`
- `countMainFinalMatches()`
- `countConsolationMatches()`

**Acción:** PORTAR AL `tournament-engine`.

**Debe conservarse**
- cálculo de tamaños equilibrados;
- 1 o 2 vueltas;
- clasificados fijos por grupo;
- wildcards/cupos extra;
- bronze;
- consuelo;
- diferentes modos post-grupo;
- duración estimada;
- mínimo deseado de partidos como input de recomendación.

**Cambio de arquitectura:** el motor recibe configuración y devuelve candidatos/resultados; la UI sólo presenta y confirma.

---

### 6.2 Modos post-grupo

**Legacy soportado**
- bracket estándar;
- Top 2 -> final;
- Top 4 -> semifinales;
- Top 3 step ladder;
- campeón por tabla;
- consuelo opcional.

**Acción:** PORTAR + TESTEAR PARIDAD.

No agregar nuevos modos P0 salvo necesidad del torneo real o formato por equipos.

---

## 7. Sorteo y grupos

### 7.1 Sorteo automático/manual/live

**Legacy**
- `createDrawTargetSequence()`
- `createDrawSession()`
- `advanceDraw()`
- `groupsFromDrawSession()`
- `confirmDrawGroups()`
- `buildAutomaticGroups()`
- `validateManualGroupAssignments()`

**Acción:** PORTAR REGLAS + REDISEÑAR UI.

**Debe preservarse**
- sorteo aleatorio;
- experiencia live paso a paso;
- pausa/reinicio antes de confirmar;
- armado manual;
- no destructivo hasta confirmación.

**Nueva seguridad:** confirmar draw genera una nueva `format/structure revision`; si ya existen resultados, el cambio se bloquea o exige un flujo de recuperación explícito.

---

## 8. Matches y fase de grupos

**Legacy**
- `createMatch()`
- `groupMatchesByRound()`
- `allGroupMatchesFinished()`

**Acción:** PORTAR + NORMALIZAR.

En el nuevo modelo:
- `competition_encounter` representa el enfrentamiento de alto nivel;
- `match` representa el partido/rubber atómico.

Para individual/pareja, normalmente un encounter tiene un match.
Para equipos, un encounter tiene N rubbers.

Esto evita crear un segundo sistema de Tournament para equipos.

---

## 9. Standings internos de grupo

**Legacy**
- `calculateGroupStandings()`
- `headToHead()`
- `addMiniTableValues()`

**Acción:** PORTAR AL MOTOR + CONGELAR TESTS.

Comportamiento legacy a preservar inicialmente:
1. victorias;
2. head-to-head en empate exacto de dos;
3. mini-tabla para empates múltiples;
4. mini diferencia;
5. diferencia total;
6. puntos anotados;
7. rating como fallback.

**Importante:** estos son criterios internos del grupo. No confundir con la comparación entre grupos desiguales.

El Format Explanation Engine debe explicar los criterios realmente activos.

---

## 10. Comparación entre grupos desiguales

**Legacy**
- `smallestCompetitionGroupSize()`
- `crossGroupStatsForEntry()`
- `compareCrossGroupPerformanceDesc()`
- `qualifiedEntries()`

**Acción:** PORTAR + TESTS EXHAUSTIVOS.

### 10.1 Método normalizado

Preservar:
1. porcentaje de victorias;
2. diferencia de puntos por partido;
3. puntos anotados por partido;
4. rating/fallback definido por el formato.

Ejemplo conceptual:
- 2-0 = 100%; +12 total / 2 = +6 por partido.
- 3-0 = 100%; +15 total / 3 = +5 por partido.
- la primera entrada queda por encima por diferencia promedio, aunque tenga menos partidos.

### 10.2 Método equiparado

Preservar:
- detectar tamaño del grupo más pequeño;
- para comparación cruzada, los grupos grandes ignoran los enfrentamientos contra sus rivales extra peor ubicados hasta igualar cantidad de rivales;
- la tabla interna del grupo sigue usando todos los partidos.

**P0:** el engine debe devolver no sólo el ranking sino un `explanation payload` con estadísticas computadas, partidos considerados y regla aplicada, para permitir transparencia en UI.

---

## 11. Clasificación, seeding, byes y bracket

**Legacy**
- `mainQualifiedEntriesForMode()`
- `qualifiedEntries()`
- `buildBracketSlots()`
- `standardSeedOrder()`
- `assignPoolToSeedNumbers()`
- `autoAdvanceByes()`
- `generateFinalPhase()`
- `updateBracketWinners()`

**Acción:** PORTAR + TESTS DE PARIDAD.

**Preservar**
- byes automáticos;
- seed order;
- política de evitar rematch de grupo cuando sea posible;
- progresión de ganadores;
- bronce;
- consuelo cuando esté activado;
- generación de fase final sólo cuando corresponde.

**Nueva regla de seguridad:** una fase final publicada/bloqueada no se regenera silenciosamente por cambios cosméticos.

---

## 12. Match rules / BO3

**Legacy**
- `applyKnockoutMatchRules()`
- `saveBestOfThreeScoreFromForm()`
- `finalizeMatchResult()`

**Acción:** PORTAR REGLAS; UI nueva.

Preservar soporte de:
- target preliminar;
- reglas diferentes para medal matches;
- BO3 en final/bronce;
- tercer set opcional sólo cuando sea necesario;
- score input no artificialmente restringido por win-by-two.

En el nuevo engine, las reglas de scoring deben vivir en `match_rule_set`, no en condiciones de UI.

---

## 13. Scheduler

### 13.1 Base legacy

**Funciones**
- `generateSchedule()`
- `scheduleCategoryGroupMatches()`
- `reserveCategoryFinalPhase()`
- `interleaveGroupMatches()`
- `chooseMatchForSlot()`
- `markLastSlot()`
- date/day offset helpers.

**Acción:** PORTAR + CORREGIR.

### 13.2 Comportamiento probado que debe mantenerse

- múltiples canchas;
- categoría asignada a jornada/día;
- orden de categorías por día;
- duración configurable por categoría;
- descanso mínimo entre partidos cuando sea posible;
- reserva de slots para fases finales;
- bronce/final secuencial o simultáneo;
- BO3 ocupa más tiempo que match normal;
- fix V2.2.1 para jornadas posteriores al día 1.

### 13.3 Bug real P0: dos vueltas

Legacy `interleaveGroupMatches()` no fuerza frontera entre vueltas. En grupo único a dos vueltas puede programar inmediatamente el rematch de la segunda vuelta.

**Nueva regla obligatoria:**

> Ningún match de Vuelta 2 puede ser programado antes de que todos los matches de Vuelta 1 del mismo grupo hayan sido programados.

Después de respetar la frontera de vuelta, el scheduler debe maximizar:
- distribución de cancha;
- descanso;
- evitar consecutivos cuando sea matemáticamente posible.

**Test obligatorio:** grupos de 3, 4, 5 y 6 entries a dos vueltas con 1-4 canchas.

---

## 14. Cronograma y binding de fase final

**Legacy**
- `bindAllGeneratedFinalsToSchedule()`
- `bindFinalsToReservedSchedule()`
- `resolveScheduleMatch()`

**Acción:** REDISEÑAR.

La nueva plataforma debe separar:
- `schedule_slot` planificado;
- `match` asignado;
- estado real (`scheduled`, `called`, `in_progress`, `finished`, `delayed`, etc.).

No depender de reemplazar placeholders de arrays por IDs de match como mecanismo principal.

---

## 15. Resultados

**Legacy**
- `saveMatchScore()`
- `saveBestOfThreeScoreFromForm()`
- `finalizeMatchResult()`
- `formatMatchResult()`

**Acción:** PORTAR REGLA + REDISEÑAR MUTACIÓN.

Nueva mutación de resultado debe:
1. validarse en domain engine;
2. guardarse primero localmente si operador offline;
3. llevar mutation UUID/idempotency key;
4. aplicar revisión de competencia/tournament;
5. persistirse server-side;
6. disparar recomputación derivada;
7. emitir invalidación live;
8. guardar audit event crítico.

Correcciones posteriores deben conservar historial mínimo del valor previo.

---

## 16. TV/public live

**Legacy**
- `renderTV()`
- `renderTVStandings()`
- `renderTVBracket()`
- `renderTVPending()`
- `renderTVResults()`

**Acción:** REDISEÑAR COMO PUBLIC LIVE.

Nueva experiencia:
- misma fuente pública para teléfono, desktop y TV;
- responsive layouts según viewport;
- sin login para información marcada pública;
- realtime cuando hay conectividad;
- conserva último estado sincronizado si se corta conexión;
- no expone PII/contacto/pagos.

La TV deja de ser un producto de datos separado; es una presentación de la misma proyección pública.

---

## 17. Exportaciones visuales

**Legacy**
- group image generator;
- schedule image generator;
- tournament promo generator.

**Acción:** DIFERIR PARCIALMENTE.

Prioridad:
1. página pública/share link;
2. exportación de grupos y cronograma si es necesaria para mantener flujo WhatsApp;
3. promo generator después del P0 si retrasa equipos/pagos/offline.

El diseño aprobado de grupos V2.4.1 puede usarse como referencia visual, no como canvas code obligatorio.

---

## 18. Backup y recovery

**Legacy**
- JSON export/import.

**Acción:** AMPLIAR.

Nueva solución:
- export/import manual JSON;
- snapshots automáticos server-side/locales antes de cambios críticos;
- restore dirigido;
- structure lock;
- critical audit events;
- legacy local build archivado como último fallback mientras dure la transición.

---

# PARTE II - NUEVO TEAM COMPETITION ENGINE

## 19. No existe equivalente legacy

La competición por equipos no debe implementarse como un parche sobre parejas.

**Acción:** NUEVO P0.

### 19.1 Abstracción

- `entry_type = team`.
- Team tiene roster configurable.
- Un `encounter` enfrenta Team A vs Team B.
- Encounter contiene una lista ordenada de `rubbers`/matches atómicos.
- Cada rubber define:
  - singles/doubles;
  - male/female/mixed/open;
  - orden;
  - regla de scoring;
  - condición `always | if_tied | custom-supported`.
- Organizador define lineup por encounter.
- Resultado del encounter se deriva de rubbers según `series_win_rule`.

### 19.2 Caso septiembre fixture inicial

Configuración de referencia para tests, no hardcode:
1. Men’s Doubles.
2. Women’s Doubles.
3. Men’s Singles.
4. Women’s Singles.
5. Mixed Doubles decisivo/5.º rubber según regla configurada.

### 19.3 Generalización

El builder debe permitir:
- roster 4, 6 u otro dentro de límites razonables;
- composición de roster configurable;
- 3, 5 u otro número de rubbers;
- tie-break rubber condicional;
- orden arbitrario;
- grupos/liga/playoff para teams igual que entries estándar.

---

# PARTE III - HUAU REF

## 20. Motor de arbitraje existente

**Legacy:** `engine.js` de HUAU Ref Beta 1.8.

**Acción:** PORTAR COMO PAQUETE PURO `ref-engine`.

Funciones/reglas existentes a preservar:
- `createMatch()`;
- `awardRally()`;
- `getServeInfo()`;
- `getCalledScore()`;
- `startNextSet()`;
- `useTimeout()` / `endTimeout()`;
- `addWarning()`;
- `correctMatch()`;
- `finishMatch()`;
- `undo()` / `redo()`.

Capacidades verificadas:
- singles/doubles;
- traditional/rally;
- BO1/BO3/BO5;
- 11/15/21 configurable;
- win by two;
- primer equipo al saque;
- server number en dobles;
- posiciones derecha/izquierda;
- timeouts;
- warnings;
- correcciones;
- resumen/finalización;
- persistencia local.

---

## 21. Tests Ref existentes

El archivo legacy `tests/engine.test.js` ya verifica al menos:
- servidor inicial de dobles tradicional;
- scoring/rotación;
- secuencia de side-out;
- singles tradicional;
- rally scoring;
- win-by-two;
- cambio de set/servidor;
- undo/redo;
- timeout/warning;
- corrección manual.

**Acción:** PORTAR LOS CASOS A VITEST antes de cambiar el motor.

No considerar Ref migrado hasta que los tests legacy y nuevos tests de edge cases pasen sobre el paquete TypeScript.

---

## 22. Ref UI

**Legacy:** app independiente con login/password local y PWA.

**Acción:** REDISEÑAR.

V1 comercial:
- Ref pertenece a Tournament;
- puede operar standalone/offline en tablet;
- no requiere auto-asignación de árbitro P0;
- resultado puede comunicarse a delegado para carga manual.

Futuro profesional:
- referee capability en cuenta HUAU;
- asignación de match;
- “Próximo partido”;
- carga automática del match config;
- submit de resultado a Tournament;
- posible aceptación/confirmación de mesa según policy.

---

# PARTE IV - COMPONENTES QUE NO DEBEN MIGRARSE TAL CUAL

## 23. Lista de anti-migración

No copiar al producto nuevo como arquitectura:

- IIFE monolítica de `app.js`;
- navegación manual por hashes como router de producto final;
- DOM strings como lógica de negocio;
- `localStorage` como base de datos primaria;
- un solo JSON mutable para todo;
- server Python local como backend cloud;
- polling frecuente como realtime principal;
- password global de Ref;
- lógica de formato dentro de componentes de UI;
- invalidaciones globales del cronograma;
- textos de formato hardcodeados;
- nombres de categorías usados como tipos del dominio;
- dependencia de canvas export para que el jugador entienda el torneo.

---

# PARTE V - PARIDAD Y FIXTURES

## 24. Fixtures que deben capturarse antes de reemplazar legacy

Crear fixtures JSON pequeños y deterministas para:

1. singles, 1 grupo, 3 jugadores, 1 vuelta;
2. singles, 1 grupo, 4 jugadores, 2 vueltas;
3. dobles, 2 grupos iguales, 2 clasifican;
4. dobles 3/4/4, método normalizado;
5. dobles 3/4/4, método equiparado;
6. wildcards;
7. Top2 final;
8. Top4 semis;
9. Top3 step;
10. league-only;
11. consuelo;
12. bracket con byes;
13. bronze;
14. final/bronce BO3;
15. jornada día 2;
16. scheduler con descansos y 3 canchas;
17. dos vueltas con frontera obligatoria de vuelta;
18. edición cosmética de jugador sin invalidación;
19. cambio estructural con snapshot/impact;
20. torneo por equipos de septiembre;
21. team encounter con rubber condicional;
22. Ref singles tradicional;
23. Ref doubles tradicional;
24. Ref rally BO3;
25. Ref undo/correction/timeout.

---

## 25. Criterio de paridad

Una feature legacy puede marcarse `MIGRATED` sólo cuando:

- la regla está modelada explícitamente;
- existe al menos un test automatizado de caso feliz;
- edge cases relevantes tienen test;
- el resultado nuevo coincide con legacy en comportamiento que decidimos preservar;
- diferencias intencionales están documentadas como ADR/requisito;
- la UI nueva consume el motor, no replica la lógica;
- existe path de rollback/import para los datos involucrados.

---

## 26. Matriz resumida de migración

| Capacidad | Legacy | Acción | Destino | Prioridad |
|---|---|---|---|---|
| Personas únicas | Sí | Portar/rediseñar | domain + D1 | P0 |
| Parejas | Sí | Portar | Tournament Engine | P0 |
| Teams | No | Nuevo | Team Engine | P0 |
| Simulador formatos | Sí | Portar | Tournament Engine | P0 |
| 1/2 vueltas | Sí | Portar + fix scheduler | Tournament Engine | P0 |
| Normalizado | Sí | Portar | standings engine | P0 |
| Equiparado | Sí | Portar | standings engine | P0 |
| Wildcards | Sí | Portar | qualification engine | P0 |
| Bracket/byes | Sí | Portar | bracket engine | P0 |
| Bronze | Sí | Portar | bracket/match rules | P0 |
| BO3 medallas | Sí | Portar | match rules | P0 |
| Draw live/manual | Sí | Portar/rediseñar UI | draw engine | P0/P1 |
| Schedule | Sí | Portar + corregir | scheduler | P0 |
| Día/categoría | Sí | Portar | scheduler | P0 |
| Resultados | Sí | Portar + nueva sync | result service | P0 |
| TV | Sí | Rediseñar | Public Live | P0 |
| Imagen grupos | Sí | Diferir/portar visual | share/export | P1 |
| Imagen cronograma | Sí | Diferir/portar visual | share/export | P1 |
| Promo image | Sí | Diferir | marketing export | P2 |
| JSON backup | Sí | Ampliar | backup/recovery | P0 |
| Cosmetic safe edit | Sí | Portar regla | mutation policy | P0 |
| Snapshots/restore | Parcial/no | Nuevo | recovery | P0 |
| Format explanation | Parcial | Nuevo | explanation engine | P0 |
| Auth global | No | Nuevo | Better Auth | P0 |
| Online registration | No | Nuevo | registration | P0 |
| Mercado Pago | No | Nuevo | payments | P0 |
| Public live cloud | No | Nuevo | projection/live | P0 |
| Offline outbox | No | Nuevo | PWA sync | P0 |
| Ref scoring engine | Sí | Portar | ref-engine | P2 integración |
| Ref tablet UX | Sí | Rediseñar/preservar | Ref app | P2 integración |

---

## 27. Orden recomendado de extracción

1. congelar legacy V2.4.2 y Ref Beta 1.8;
2. crear fixtures/parity harness;
3. extraer tipos y funciones puras de standings;
4. extraer qualification/bracket;
5. extraer scheduler y aplicar fix de dos vueltas;
6. implementar `encounter` abstraction;
7. agregar team engine;
8. agregar format explanation sobre config/result payloads;
9. adaptar UI nueva;
10. migrar persistencia/import;
11. conectar registration/payment/public live;
12. migrar Ref engine cuando Tournament P0 esté estabilizado.

---

## 28. Regla de retiro del legacy local

La aplicación local actual **no se elimina ni se sobreescribe** hasta que la plataforma nueva haya completado:

- importación correcta de un backup real;
- rehearsal completo con formato estándar;
- rehearsal completo por equipos;
- pérdida de Internet simulada;
- recuperación/reconexión;
- restore de snapshot;
- resultado final/bracket correctos;
- prueba de TV/public view;
- export de respaldo al finalizar.

Hasta ese momento, la V2.4.2 local es el fallback operativo de emergencia.

---

## 29. Definition of Done de migración legacy

La migración legacy está cerrada cuando:

- ningún cálculo competitivo crítico depende de `app.js` legacy;
- los engines son paquetes TypeScript puros;
- los tests de paridad pasan;
- el bug de dos vueltas está cubierto y corregido;
- una edición inocua nunca destruye competencia;
- restore está probado;
- el JSON legacy real puede importarse a la nueva plataforma;
- Ref engine está preservado sin regresión cuando llegue su fase;
- la versión local queda archivada sólo como referencia/fallback, no como fuente activa de desarrollo.
