# HUAU Tournament — Phase 4.1 Recovery Pass P0

## Objetivo

Recuperar calidad operativa del Tournament legacy antes de avanzar a Team Engine / HUAU Club. La arquitectura cloud (D1/API/snapshots) se conserva; el frontend y las mutaciones deben volver a sentirse como una herramienta de torneo madura, no como una reimplementación técnica.

## Cambios incluidos en este primer pass

### 1. Performance del workspace

- `loadCompetition()` deja de ejecutar lecturas independientes de D1 en serie y las resuelve en paralelo una vez conocido el `competition_id`.
- `tournamentDetail()` hidrata las competiciones de todas las categorías en paralelo en lugar de hacerlo categoría por categoría.
- Se mantiene el contrato actual del endpoint para no introducir una migración de API durante este parche.

Este cambio reduce de forma importante la latencia del patrón actual de refresco completo. El siguiente nivel de optimización, si todavía fuese necesario, será reemplazar el full reload por refrescos/updates por sección.

### 2. Alta de jugador

- El formulario se resetea antes del refresh que vuelve a renderizar el workspace, evitando que queden los datos del jugador anterior.

### 3. Standings

La tabla deja de mostrar `Pts` ambiguo y pasa a:

`PJ | PG | PP | PF | PC | DIF`

- PJ: partidos jugados
- PG: partidos ganados
- PP: partidos perdidos
- PF: puntos a favor
- PC: puntos en contra
- DIF: PF - PC

En comparación cruzada se usa `PF/P` para puntos a favor por partido.

### 4. Spacing global y jerarquía

- separación explícita entre nombre/metadatos del jugador;
- separación de chips de estado;
- margen consistente para `Editar ficha`, acciones y panel titles;
- padding y gaps del workspace revisados;
- categorías y formularios recuperan jerarquía visual más clara.

### 5. Simulador/formato

Las opciones vuelven a presentarse como unidades completas, tomando como baseline la densidad y jerarquía del Tournament legacy:

- Recomendada / Más rápida / Más partidos;
- cantidad y tamaños de grupos;
- partidos mínimos;
- partidos totales;
- duración estimada;
- cantidad de clasificados;
- vueltas, fase de grupos y fase principal;
- clasificación por grupo/wildcards;
- comparación cruzada;
- scoring de grupos/medallas;
- resumen de fase posterior;
- CTA asociado visualmente a cada opción.

## Regla de producto

No se cierra Phase 4.1 por existencia de engine o persistencia. Tournament estándar debe recuperar paridad funcional, velocidad y claridad operacional antes de avanzar funcionalmente a Team Engine.
