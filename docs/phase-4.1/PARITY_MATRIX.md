# HUAU Tournament — Matriz de paridad Legacy → HUAU Sports

**Referencia funcional legacy:** HUAU Tournament V2.4.2 Local + Netlify Autocarga  
**Objetivo:** el Tournament nuevo no se considera funcionalmente equivalente hasta que cada capacidad legacy esté portada, validada o reemplazada explícitamente por una versión mejor.

## Estados

- ✅ **Portado**: existe en engine/persistencia/UI y puede probarse.
- 🟡 **Parcial**: existe parte de la lógica, pero falta UI, persistencia, flujo o paridad operacional.
- ❌ **Falta**: no está disponible en el Tournament nuevo actual.
- ➡️ **Fase arquitectónica posterior**: la función debe preservarse, pero su superficie final pertenece a una fase posterior ya prevista (Live/PWA, etc.). No se elimina de la paridad.

## 1. Personas, categorías e inscripciones manuales

| Capacidad V2.4.2 | Engine nuevo | D1 | UI Phase 4 | Estado / acción |
|---|---:|---:|---:|---|
| Registro único de personas | n/a | ✅ organization_people | 🟡 alta manual | 🟡 Falta gestión/edición/reutilización de personas |
| Singles y dobles | ✅ | ✅ | ✅ | ✅ |
| DUPR/rating por modalidad | 🟡 rating genérico | 🟡 seed_rating | 🟡 un campo | 🟡 Recuperar distinción singles/doubles vía perfil deportivo |
| Parejas vinculadas sin duplicar jugador | 🟡 participantIds | ✅ entry_members | ❌ UI crea personas nuevas cada vez | 🟡 Reutilizar persona existente y evitar duplicados |
| Editar typo sin destruir estructura | ✅ regla/test cosmético | ✅ modelo permite | ❌ no hay edición | 🟡 Crear editor cosmético seguro |

## 2. Simulador y formatos

| Capacidad V2.4.2 | Engine nuevo | D1 | UI Phase 4 | Estado / acción |
|---|---:|---:|---:|---|
| Grupos configurables | ✅ | ✅ | ✅ | ✅ |
| Tamaños desiguales | ✅ | ✅ | ✅ | ✅ |
| 1 o 2 vueltas | ✅ | ✅ config_json | ✅ | ✅ |
| Clasificados fijos por grupo | ✅ | ✅ | ✅ | ✅ |
| Wildcards/cupos extra | ✅ | ✅ | ✅ | ✅ |
| Comparación normalizada | ✅ | ✅ | ✅ | ✅ |
| Comparación equiparada | ✅ | ✅ | ✅ | ✅ |
| Top 2 → Final | ✅ | ✅ | ✅ | ✅ |
| Top 4 → Semis | ✅ | ✅ | ✅ | ✅ |
| Top 3 escalonado | ✅ | ✅ | ✅ | ✅ |
| Campeón por tabla | ✅ | ✅ | ✅ | ✅ |
| Cuadro consuelo | ✅ | ✅ | ❌ hardcode `none` | 🟡 Exponer opción |
| Bronce opcional | ✅ | ✅ | ✅ | ✅ |
| Final/bronce BO1 o BO3 | ✅ | ✅ | ✅ config | 🟡 Editor de resultados BO3 debe quedar integrado |
| Puntos objetivo configurables | ✅ | ✅ | ✅ | ✅ |
| Bronce/final secuencial o simultáneo | ✅ | ✅ | ✅ | ✅ |
| Evitar revancha inmediata | ✅ | ✅ | ❌ hardcode `true` | 🟡 Exponer permitir/evitar |
| Fase final por rendimiento | ✅ | ✅ | ❌ hardcode `performance` | 🟡 Exponer |
| Fase final por bombos | ✅ | ✅ | ❌ | 🟡 Exponer |
| Objetivo mínimo de partidos | ❌ no está en tipo | ❌ | ❌ | ❌ Portar simulador/recomendación |
| Explicación detallada del formato | 🟡 lógica dispersa | ✅ config | ❌ | ➡️ Phase 8 Explanation Engine, manteniendo paridad |

## 3. Siembra, sorteo y grupos

| Capacidad V2.4.2 | Engine nuevo | D1 | UI Phase 4 | Estado / acción |
|---|---:|---:|---:|---|
| Serpentina por rating | ✅ distribución actual | ✅ | implícita | 🟡 Debe ser opción visible |
| Orden manual | ❌ | ❌ | ❌ | ❌ Portar |
| Sorteo aleatorio | ❌ como modo | ❌ | ❌ | ❌ Portar |
| Armado manual de grupos | ❌ | ✅ tablas sirven | ❌ | ❌ Portar modal/editor |
| Sugerencia automática dentro de grupos manuales | 🟡 serpentina reutilizable | ✅ | ❌ | ❌ Portar UI |
| Sorteo en vivo progresivo | ❌ | ❌ sesión | ❌ | ❌ Portar sesión de sorteo |
| Sacar siguiente / auto-pausa / mezclar / reiniciar | ❌ | ❌ | ❌ | ❌ Portar |
| Confirmar grupos sin tocar competencia antes | arquitectura posible | ❌ sesión | ❌ | ❌ Portar con persistencia de sesión |

## 4. Cronograma

| Capacidad V2.4.2 | Engine nuevo | D1 | UI Phase 4 | Estado / acción |
|---|---:|---:|---:|---|
| Múltiples canchas | ✅ | ✅ | ✅ | ✅ |
| Duración por categoría | ✅ | ✅ config_json | ✅ | ✅ |
| Descanso preferido 0/1/2 bloques | ✅ | ✅ config_json | ❌ hardcode 1 | 🟡 Exponer y usar valor guardado |
| Nunca jugador simultáneo | ✅ | ✅ resultado | automático | ✅ |
| Maximizar rotación | ✅ heurística | n/a | automático | ✅ con más fixtures de paridad |
| Vuelta 1 completa antes de Vuelta 2 | ✅ regression test | ✅ | automático | ✅ |
| Evitar consecutivos si hay alternativa | ✅ preferred rest | n/a | automático | ✅/🟡 ampliar fixtures |
| Categoría asignada a día | ✅ | ✅ scheduled_date | ✅ | ✅ |
| Orden manual de categorías dentro del día | ✅ `sortOrder` consumido | ✅ | ❌ no editable | 🟡 Exponer subir/bajar |
| Completar categoría antes de siguiente | ✅ | ✅ | automático | ✅ |
| Reserva fase final antes de conocer clasificados | ✅ | ✅ placeholders | ✅ cronograma | ✅ |
| BO3 reserva mayor duración | ✅ x2 | ✅ | automático | ✅ |
| Cierre real calculado, no límite duro | ✅ | ✅ | 🟡 no muestra ventana | 🟡 Mostrar hora inicio/cierre por categoría |
| Resultados ordenados según cronograma | 🟡 revisar query/UI | ✅ | 🟡 | 🟡 Validar y fijar como criterio |
| Imagen vertical de cronograma | ❌ | ❌ | ❌ | ❌ Portar export PNG |

## 5. Resultados, standings y fase final

| Capacidad V2.4.2 | Engine nuevo | D1 | UI Phase 4 | Estado / acción |
|---|---:|---:|---:|---|
| Carga de BO1 | ✅ | ✅ | 🟡 prompt navegador | 🟡 Reemplazar por editor inline |
| Corrección de resultado | ✅ | ✅ audit/result_status | 🟡 prompt | 🟡 Editor inline seguro |
| Carga BO3 set por set | ✅ | ✅ match_sets | 🟡 prompt | 🟡 Editor de sets inline |
| Standings y desempates | ✅ | ✅ resultados | ❌ no visibles en resultados | 🟡 Mostrar tablas en vivo |
| Ranking cruzado transparente | ✅ | ✅ | ❌ | 🟡 Mostrar tabla Normalized/Equalized |
| Clasificación automática | ✅ | ✅ | ✅ al generar final | ✅ lógica, mejorar UX |
| Fase final automática al último resultado de grupos | engine permite | ✅ | ❌ botón manual | 🟡 Recuperar auto-generación o decisión explícita equivalente |
| Bracket/byes/propagación | ✅ | ✅ | ✅ básico | 🟡 Mejorar representación visual |
| Recalcular llave al corregir grupos | 🟡 necesita política de seguridad | ✅ | ❌ | 🟡 Portar con snapshot/impacto |

## 6. Visualización, difusión y operación

| Capacidad V2.4.2 | Nuevo HUAU | Estado / acción |
|---|---:|---|
| Modo TV | ❌ Phase 4 | ➡️ Phase 9 HUAU Live/TV: debe conservar grupos, próximos, últimos, bracket y autoavance |
| Refresco multidispositivo | 🟡 cloud D1 | ➡️ Phase 9 realtime + Phase 10 offline/sync |
| Imagen PNG de grupos | ❌ | ❌ Portar en parity pass / compartir |
| Imagen promocional del torneo | ❌ | ❌ Portar como superficie de difusión (puede quedar detrás de grupos/cronograma si priorizamos) |
| Página/Live pública | ❌ Phase 4 | ➡️ Phase 9 |
| Responsive móvil/tablet/TV | 🟡 admin | ➡️ Phase 9/10 según superficie |

## 7. Seguridad, backup y resiliencia

| Capacidad V2.4.2 | Nuevo HUAU | Estado / acción |
|---|---:|---|
| Backup/export JSON | 🟡 importer/backup core | 🟡 Falta botón de export operativo |
| Import legacy JSON | ✅ importer Phase 3 | 🟡 Falta flujo admin visible |
| Snapshot antes de destructivo | ✅ | ✅ |
| Restore snapshot | ✅ | ✅ básico |
| Control de revisión multidispositivo | 🟡 working_revision | 🟡 Endurecer conflictos/concurrencia |
| Offline durante evento | ❌ | ➡️ Phase 10 PWA/offline, requisito bloqueante antes de retirar legacy |
| Cola y sincronización al reconectar | ❌ | ➡️ Phase 10 |

# Decisión de producto para Phase 4.1

**No cerrar Phase 4 ni avanzar funcionalmente a Team Engine hasta recuperar la paridad del Tournament estándar.**

La implementación se divide en seis bloques para poder probar sin meter un parche gigante:

1. **4.1A — Configuración y scheduler parity**  
   Descanso configurable, consuelo, permitir/evitar revancha, rendimiento/bombos, mínimo de partidos, valores persistidos, orden de categorías, ventanas horarias.

2. **4.1B — Siembra y grupos parity**  
   Serpentina explícita, aleatorio, orden manual, grupos manuales, sugerencia automática.

3. **4.1C — Sorteo en vivo parity**  
   Sesión persistida, sacar siguiente, automático/pausa, mezclar, reiniciar, confirmar sin tocar estructura previamente.

4. **4.1D — Resultados y standings parity**  
   Editor inline BO1/BO3, corrección, tablas, comparación cruzada, resultado según cronograma, finalización automática segura.

5. **4.1E — Compartir/export parity**  
   PNG de grupos, PNG de cronograma, backup/export/import visible.

6. **4.1F — Fixtures de aceptación**  
   Reproducir fixtures representativos del V2.4.2 y comprobar standings, clasificados, bracket y cronograma. Sólo después Phase 4 queda cerrada.

# Regla de cierre

Una función del legacy sólo se marca ✅ cuando existe en el producto nuevo y tiene prueba automática o validación manual reproducible. Que el engine posea el campo o la función **no cuenta como paridad** si el organizador no puede usarla desde la nueva aplicación.
