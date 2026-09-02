# Phase 5B — Team Tournament Admin

## Objetivo

Exponer el Team Competition Engine de Phase 5A dentro del workspace administrativo de HUAU Tournament, manteniendo el formato por equipos configurable y sin hardcodear un evento particular.

## Alcance implementado

- Nueva pestaña **Equipos / Teams** dentro del Tournament admin.
- Creación de categorías `entry_type = team` con preset inicial MD · WD · MS · WS · XD.
- Builder visual de `TeamFormat`:
  - tamaño y composición de roster;
  - cuotas mínimas por género;
  - suplentes y capitán;
  - regla de ganador de la serie;
  - continuar o no después de clinchar;
  - una o dos vueltas de grupos;
  - modo de playoff guardado para el siguiente bloque;
  - alta, baja, orden y edición de rubbers;
  - singles/doubles, género, BO1/BO3, target, peso y condición `always` / `if_tied`.
- Alta, edición y baja segura de equipos reutilizando `organization_people` existentes.
- Validación server-side del roster contra `TeamFormat`.
- Generación de grupos Team y round-robin de una o dos vueltas.
- Creación persistente de encounters y sus rubbers.
- Alineaciones por lado y rubber con estados draft/locked.
- Override administrativo de lineup sólo cuando la política del engine lo permite.
- Carga y corrección de resultados BO1/BO3.
- Persistencia de los jugadores que disputaron cada rubber en `match_side_members`.
- Recalculo de marcador de serie y estados `ready/pending/skipped/finished` usando `scoreTeamEncounter`.
- Standings Team por grupo con encounters, rubbers y puntos.
- Snapshots de categoría ampliados para incluir lineups Team, assignments y `match_side_members`.

## Persistencia

Phase 5B **no agrega una migración nueva**. Requiere que `0004_phase5_team_competition.sql` de Phase 5A ya esté aplicada. Usa:

- `competition_encounters`
- `matches`
- `match_sets`
- `match_side_members`
- `team_encounter_lineups`
- `team_lineup_assignments`
- `entry_members`
- `tournament_snapshots`

## Aislamiento del Tournament estándar

Mientras Team avanza por bloques, las categorías `team` quedan fuera de las superficies estándar que todavía asumen formatos individuales/parejas:

- simulador estándar;
- sorteo estándar;
- competencia/standings estándar;
- scheduler estándar;
- Modo TV estándar.

Esto evita regresiones sobre Tournament legacy. Team tiene su propio workspace en Phase 5B y se conectará con scheduler/playoffs/live en bloques posteriores.

## Safeguards

Los cambios estructurales sobre una categoría Team con competencia generada requieren confirmación de impacto y snapshot previo. El primer resultado Team y las correcciones de resultado generan snapshot. Restore de categoría ahora incluye los datos Team asociados.

## Fuera de alcance de 5B

- playoff Team ejecutable;
- scheduler de encuentros/rubbers Team;
- superficie pública/live Team;
- inscripción pública de equipos;
- pagos Team;
- autoasignación de alineaciones.

El `TeamFormat` ya conserva la configuración necesaria para conectar estos bloques sin rehacer el modelo.

## Aceptación manual mínima

1. Crear una categoría Team.
2. Confirmar/editar el preset de cinco rubbers.
3. Crear al menos dos equipos con roster válido.
4. Generar un grupo.
5. Guardar y bloquear las dos alineaciones de una serie.
6. Cargar rubbers en orden y verificar que el siguiente rubber cambie a `ready`.
7. Comprobar que un `if_tied` se habilita o salta según el marcador.
8. Finalizar una serie y validar ganador + standings.
9. Corregir un resultado y comprobar recálculo.
10. Confirmar que las categorías estándar siguen operando en Formato/Sorteo/Cronograma/Resultados/TV sin mezclar Team.
