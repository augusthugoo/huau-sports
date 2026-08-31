# HUAU Sports - Foundation v1.0

**Estado:** Baseline de producto y arquitectura listo para iniciar desarrollo  
**Fecha de congelamiento inicial:** 2026-08-29  
**Idioma documental:** Español  
**Producto:** HUAU Sports  

## 1. Propósito de este paquete

Este paquete convierte las decisiones de discovery de HUAU Sports en una fuente de verdad operativa para diseño y desarrollo. La intención es evitar volver a definir el producto durante la implementación y preservar lo que ya fue validado en HUAU Tournament y HUAU Ref.

HUAU no parte de cero:

- HUAU Tournament ya fue utilizado en un torneo real de dos jornadas y validó el flujo operativo principal.
- HUAU Tournament V2.4.x contiene lógica de personas, parejas, categorías, grupos, cronograma, resultados, standings, fase final, TV/live, imágenes, backups y formatos flexibles.
- HUAU Ref Beta 1.8 contiene un motor funcional de arbitraje de pickleball con singles/dobles, scoring tradicional/rally, BO1/BO3/BO5, servicio, posiciones, timeouts, advertencias, correcciones y undo/redo.
- El nuevo producto incorpora una tercera pata: HUAU Club, orientada al uso cotidiano de clubes/complejos/comunidades.

## 2. Documentos canónicos

1. `01_PRD_HUAU_SPORTS_v1.0.md`  
   Define qué producto se construye, para quién, alcance, reglas funcionales, prioridades y criterios de éxito.

2. `02_APP_USER_FLOWS_v1.0.md`  
   Define cómo recorren el producto visitantes, usuarios, administradores de organización y administrador de plataforma.

3. `03_BACKEND_DATA_MODEL_v1.0.md`  
   Define entidades, relaciones, estados, constraints, ownership y modelo multi-organización.

4. `04_TRD_HUAU_SPORTS_v1.0.md`  
   Define arquitectura técnica, stack, seguridad, offline/sync, realtime, pagos, emails, deployment y testing.

5. `05_UI_UX_DESIGN_BRIEF_v1.0.md`  
   Define lenguaje visual, responsive strategy, componentes, navegación, motion, tematización por club y experiencia de cada módulo.

6. `06_IMPLEMENTATION_PLAN_v1.0.md`  
   Define el orden ejecutable de trabajo, gates de salida, QA, migración y preparación para el torneo por equipos de fines de septiembre de 2026.

7. `07_LEGACY_MIGRATION_MAP_v1.0.md`  
   Mapea las capacidades existentes de HUAU Tournament/Ref al nuevo producto para evitar reescribir o perder reglas ya validadas.

8. `08_OPEN_DECISIONS_ADR_REGISTER_v1.0.md`  
   Registra decisiones deliberadamente abiertas y el mecanismo para aprobar cambios de arquitectura o alcance.

9. `09_ACCEPTANCE_TEST_MATRIX_v1.0.md`  
   Convierte los requisitos críticos en gates y casos verificables para paridad, equipos, pagos, offline, Club y Ref.

## 3. Jerarquía documental

En caso de contradicción:

- **Alcance, reglas funcionales, prioridades y comportamiento esperado:** prevalece el PRD.
- **Persistencia, ownership y relaciones de datos:** prevalece Backend/Data Model.
- **Tecnología, seguridad, deployment, sync y contratos de API:** prevalece TRD.
- **Presentación, interacción y lenguaje visual:** prevalece UI/UX Design Brief.
- **Orden de construcción y gates:** prevalece Implementation Plan.
- **Comportamiento heredado que debe preservarse durante migración:** Legacy Migration Map, salvo que el PRD lo reemplace explícitamente.

Todo cambio sustancial posterior debe registrarse como ADR en `08_OPEN_DECISIONS_ADR_REGISTER_v1.0.md` y actualizar los documentos afectados.

## 4. Principios no negociables

1. **HUAU es una sola identidad con módulos, no tres bases de usuarios separadas.**
2. **Una cuenta HUAU puede participar en varias organizaciones.**
3. **HUAU Tournament no puede volverse menos confiable al pasar a cloud.** Debe ser offline-resilient.
4. **Nunca se debe perder una competencia por una edición inocua.** Las operaciones estructurales deben ser explícitas, versionadas y recuperables.
5. **El dinero de torneos no pasa por una cuenta de HUAU en V1.** El receptor es la organización/organizador configurado.
6. **HUAU debe poder operar con participantes manuales aunque no tengan cuenta.**
7. **Los formatos competitivos deben describirse a partir de reglas, no de textos hardcodeados.**
8. **La competencia por equipos debe ser configurable; no se hardcodea un formato MLP ni el clasificatorio de septiembre.**
9. **HUAU Club debe resolver primero estructura y operación; no intenta sustituir chat/red social.**
10. **La interfaz pública debe transmitir producto premium; la administración debe priorizar claridad y velocidad.**

## 5. Convención de versiones

- `v1.0` documental = primera baseline congelada antes de replatforming.
- Las versiones de producto cloud serán independientes de las versiones legacy locales.
- Se recomienda usar semver para paquetes de dominio (`tournament-engine`, `ref-engine`, etc.).

## 6. Definición de "listo para desarrollar"

El desarrollo puede comenzar cuando:

- los documentos 01-09 están aprobados como baseline;
- los open decisions P0 tienen owner y fecha límite;
- el repo nuevo tiene CI, lint, typecheck y tests mínimos;
- la V2.4.x local actual permanece archivada como fallback y no se modifica destructivamente;
- el Tournament Engine nuevo tiene tests de paridad contra casos legacy antes de reemplazar la app usada en eventos reales.
