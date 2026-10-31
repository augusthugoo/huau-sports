# HUAU V3 — Próximas implementaciones acordadas

Este documento separa la V3 legal de las mejoras operativas futuras; no indica que ya estén implementadas.

## Lo que existe

- Páginas públicas Términos y Privacidad ES/EN, con versiones registradas en el alta.
- Perfil deportivo, inscripción, cobros por organizador, marcadores, torneo público y Tournament Day.
- D1 conserva constancias de aceptación inicial.
- Cloudflare R2 conserva comprobantes y archivos publicados. Los comprobantes NO se eliminan automáticamente en producción hoy.

## Próximas tareas del producto

1. **Resultados — Ver más.** La landing muestra una cantidad limitada de torneos. Agregar CTA «Ver más» y una lista pública por fecha/nombre, con paginación. Hasta que exista la vista, no prometerla en los Términos. Mantener acceso a páginas públicas elegibles.
2. **Archivo interno a doce meses.** Distinguir fecha real de finalización del torneo; al llegar a 12 meses retirar la página pública y conservar solo datos internos justificados. No usar `status=completed` como sustituto de finalización real si el torneo se reanuda. Probar enlaces, manifest R2, APIs y cachés para impedir acceso público residual.
3. **Conciliación.** Agregar un acto independiente de cierre de pagos del organizador (fecha, responsable, incidencias). Eliminar archivos R2 de comprobantes 30 días después si no hay controversias ni deber legal de retener, conservando los movimientos administrativos indispensables en D1; registrar borrados y reintentos. Hasta automatizarlo, la política implica trabajo MANUAL verificado; no asumir que `completed` inicia la cuenta regresiva.
4. **Menores.** El selector del alta expresa la condición de adulto/tutor, sin pedir cada vez la misma confirmación al titular. Para inscripciones de menores desde esa cuenta, registrar quién representa al menor y por qué. Para alta manual del organizador, exigirle constancia de consentimiento adecuado. Nunca asumir que una autodeclaración prueba parentesco.
5. **Fotografía y transmisiones.** Prever una forma breve de expresar oposición antes del encuentro: inicialmente por contacto con organizador / `privacidad@huau.app`, y más adelante como nota operativa en el torneo; no transmitir un partido si uno de sus jugadores se opone. Para fotos identificables en material promocional, obtener consentimiento independiente cuando legalmente sea necesario; excluir menores sin autorización específica.
6. **Datos públicos.** Auditar endpoints `/api/public/*`, exports, R2, perfiles públicos y contenido antiguo para no exponer nacimiento, edad exacta, ciudad residencial, correo, teléfonos, documentos ni comprobantes.
7. **Privacidad y cuentas.** Desarrollar un procedimiento controlado de eliminación o anonimización de cuentas sin corromper los resultados de otras personas, y contestar derechos en plazo. Reaceptaciones V3: las nuevas altas registran versión V3; la reaceptación de usuarios V2 requiere implementación si una modificación o ley lo exige.
8. **Proveedores internacionales.** Verificar contratos y ubicaciones de Cloudflare y Brevo, información a titulares y transferencias según legislación vigente.
9. **Responsable jurídico.** Ley 18.331, artículo 13, requiere identidad y domicilio del responsable. HUAU no inventa una dirección ni publica el domicilio residencial por decisión de su operador. Es una brecha legal pendiente; consultar asesoría local para una alternativa válida.

## Criterio para despliegues

Cambios técnicos por Python hotfix sobre `main`, preflight, backups, `git diff --check`, typecheck, build, `pnpm exec vitest run --config vitest.config.ts --no-file-parallelism --maxWorkers=1 --pool=threads`, revisión manual en móvil y web. No subir archivos sensibles a GitHub.
