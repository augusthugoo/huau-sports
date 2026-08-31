# HUAU Sports - Product Requirements Document (PRD) v1.0

**Estado:** Baseline funcional  
**Fecha:** 2026-08-29  
**Owner de producto:** HUAU Sports  
**Prioridad de entrega inmediata:** Tournament + equipos + inscripciones/pagos + robustez  
**Siguiente frente:** HUAU Club MVP

---

## 1. Resumen ejecutivo

HUAU Sports es una plataforma de tecnología deportiva enfocada inicialmente en **pickleball, pádel y tenis**. La plataforma debe cubrir tres momentos distintos de la experiencia deportiva:

1. **HUAU Club** - operación cotidiana de clubes, complejos y comunidades: membresías, canchas, reservas, partidos abiertos, Open Play, actividades y comunidad.
2. **HUAU Tournament** - organización competitiva: inscripciones, pagos, categorías, formatos, sorteos, grupos, cronograma, resultados, standings, playoffs, competiciones por equipos, información pública y visualización en vivo.
3. **HUAU Ref** - herramienta de arbitraje especializada, comercialmente incluida dentro de Tournament y operativamente diseñada para trabajar de forma simple y offline-resilient.

La nueva HUAU debe conservar la lógica que ya funcionó en eventos reales, elevar la calidad visual, simplificar la operación para terceros y reemplazar la arquitectura local-only por una plataforma cloud-connected que **continúe funcionando durante pérdidas de conectividad**.

HUAU se diseña como una única plataforma multi-organización: una persona tiene una sola cuenta HUAU, puede pertenecer a distintos clubes/organizaciones y puede asumir distintas capacidades según contexto.

---

## 2. Contexto y oportunidad

### 2.1 Problemas observados en torneos

En la experiencia local actual de pickleball existen fricciones recurrentes:

- formatos de competencia poco claros para los jugadores;
- sorteos y criterios de clasificación explicados informalmente;
- cálculo manual de tablas, diferencias y mejores clasificados;
- cruces y cronogramas difíciles de mantener en Excel/papel;
- falta de una vista pública en vivo consistente;
- dependencia de una persona que “sabe cómo está armado” el torneo;
- alto riesgo operativo cuando se realizan cambios sobre el evento;
- herramientas de arbitraje separadas de la gestión del torneo.

HUAU Tournament ya demostró en un torneo real que automatizar cronograma, resultados, standings y fase final reduce de forma considerable la carga cognitiva del organizador. También validó que la **transparencia previa** - video de formato, sorteo, grupos y reglas claras - fue percibida positivamente por los jugadores.

### 2.2 Problemas observados en clubes/comunidades

La actividad semanal se organiza frecuentemente por WhatsApp:

- listas manuales de nombres;
- horarios publicados como mensajes;
- partidos que buscan completar jugadores;
- reservas confirmadas por recepción;
- membresías verificadas manualmente;
- clínicas, clases y eventos comunicados por canales distintos.

Esto crea una oportunidad para que HUAU sea la capa estructurada del club sin intentar sustituir el chat social.

### 2.3 Oportunidad comercial

HUAU puede comercializarse de forma modular:

- **Club:** suscripción recurrente para operación cotidiana.
- **Tournament:** por evento, por inscripción, suscripción o modelo híbrido a definir.
- **Ref:** capability incluida con Tournament, no producto comercial independiente en V1.

Como referencia de discovery, un organizador reportó que una solución competidora cobra aproximadamente **USD 3 por inscripto**. Este dato es orientativo y no define el pricing de HUAU.

---

## 3. Visión de producto

### 3.1 Propuesta

**Tecnología para competir mejor.**

HUAU debe hacer que organizar, participar y seguir actividad deportiva se sienta:

- más claro;
- más profesional;
- más predecible;
- menos manual;
- más confiable;
- visualmente premium sin ser recargado.

### 3.2 Principios de producto

1. **Automatizar la complejidad, no ocultar las reglas.**
2. **Mostrar por qué el sistema toma una decisión.**
3. **No exigir conocimientos técnicos para operar un torneo.**
4. **No depender de conexión estable durante un evento crítico.**
5. **Proteger la información antes de agregar funciones nuevas.**
6. **Una cuenta, múltiples organizaciones y roles contextuales.**
7. **Configuración donde el deporte lo necesita; simplicidad donde no agrega valor.**
8. **Lo público debe ser compartible y entendible sin login.**
9. **El club define sus reglas; HUAU las ejecuta.**
10. **Nunca hardcodear un torneo particular como si fuera una regla universal.**

---

## 4. Objetivos de V1

### 4.1 Objetivos P0 - septiembre 2026

Antes del clasificatorio internacional por equipos de fines de septiembre, HUAU debe poder:

- registrar usuarios y organizaciones;
- crear y administrar torneos desde cloud;
- preservar los formatos ya soportados por Tournament legacy;
- corregir definitivamente el scheduling de fases a dos vueltas;
- soportar competición por equipos configurable;
- aceptar inscripciones online;
- soportar inscripción individual, por pareja y por equipo;
- confirmar pagos de torneos vía Mercado Pago cuando esté conectado;
- soportar pagos manuales (transferencia/efectivo) con validación del administrador;
- publicar información de torneo sin login;
- mostrar grupos, cronograma, standings, resultados y bracket en vivo;
- generar explicación clara y bilingüe del formato;
- proteger cambios críticos mediante snapshots y confirmaciones de impacto;
- funcionar como PWA y mantener capacidad de operación offline durante el torneo.

### 4.2 Objetivos P1 - HUAU Club piloto

- administrar membresías declaradas por el club;
- configurar deportes, canchas y disponibilidad;
- solicitar/aprobar reservas;
- permitir reserva privada o partido abierto;
- completar partidos con jugadores de la comunidad;
- soportar lista de espera;
- crear Open Play oficial con cupos;
- ofrecer dashboard simple para organización y experiencia mobile para socios;
- permitir branding por organización sin eliminar HUAU.

### 4.3 Objetivos P2

- clases individuales/grupales;
- clínicas/eventos más completos;
- agenda de coach;
- pagos de actividades distintas a torneos;
- integración Ref -> Tournament automática en eventos profesionales;
- push notifications;
- apps nativas.

---

## 5. No objetivos de V1

Quedan fuera del alcance inmediato:

- ranking universal HUAU entre clubes;
- chat o mensajería interna;
- red de amigos/contactos;
- feed social;
- gestión fiscal/facturación electrónica;
- cobro automático de membresías;
- split automático de comisión HUAU en V1;
- reembolsos automáticos desde HUAU;
- sanciones por no-show en Open Play;
- rotaciones automáticas de Open Play;
- deportes distintos a pickleball, pádel y tenis;
- white-label total sin marca HUAU;
- app nativa iOS/Android en la primera entrega;
- edición colaborativa en tiempo real estilo Google Docs.

---

## 6. Actores y permisos conceptuales

### 6.1 HUAU Platform Admin

Administrador maestro de la plataforma.

Debe poder:

- crear/deshabilitar organizaciones;
- habilitar módulos y configuraciones globales;
- revisar métricas mínimas de uso;
- consultar salud de integraciones;
- ingresar en **Support Mode** a una organización para resolver problemas remotos;
- recuperar snapshots críticos;
- revisar eventos de auditoría críticos;
- gestionar feature flags;
- bloquear operaciones peligrosas ante una incidencia.

El acceso de soporte debe estar claramente identificado y auditado. No debe exponer secretos en texto plano.

### 6.2 Organization Admin

Representa a la persona encargada del club, complejo, comunidad u organizador.

V1 asume una experiencia administrativa simple y un operador principal, aunque el backend no debe romperse si existen dos sesiones abiertas. No se crea una jerarquía empresarial de administradores. Cuando existan capabilities adicionales (por ejemplo coach u operador de torneo), la organización podrá activar/desactivar permisos concretos mediante políticas simples, sin crear niveles jerárquicos nuevos.

Debe poder:

- configurar organización, branding y deportes;
- aprobar miembros;
- administrar membresías;
- configurar canchas y reglas de reserva;
- aprobar/rechazar reservas;
- crear actividades y Open Play;
- crear y operar torneos;
- administrar inscripciones y pagos;
- crear participantes manuales;
- cargar resultados;
- publicar información;
- restaurar estado previo cuando corresponda.

### 6.3 User

Cuenta global HUAU.

Puede, según contexto:

- ser miembro de una o varias organizaciones;
- ser jugador;
- tener capability de coach;
- solicitar reservas;
- unirse a partidos abiertos;
- inscribirse a actividades;
- inscribirse a torneos;
- aceptar invitaciones de pareja/equipo;
- consultar contenido público o privado.

### 6.4 Coach capability

No es una jerarquía separada. Un usuario puede tener capacidad de coach en una organización.

P2: agenda, clases y gestión de actividades propias.

### 6.5 Referee capability

No se expone como rol central en V1. HUAU Ref funciona inicialmente como herramienta de evento. La asignación de árbitros con cuenta se incorpora en una etapa posterior.

---

## 7. Entidad comercial: Organization

La entidad raíz del tenant será **Organization**, no `Club`, porque HUAU debe soportar:

- club;
- complejo deportivo;
- comunidad;
- academia;
- organizador independiente;
- liga;
- federación.

Una organización puede organizar un torneo en un venue que pertenece a otra organización. El **organizador**, el **lugar físico** y el **receptor de pagos** son conceptos separados.

Ejemplo soportado:

- Organización que crea el torneo: Comunidad Shangrilá.
- Venue: complejo Horneros.
- Receptor de Mercado Pago: Horneros o el organizador, según configuración del evento.

---

## 8. Marca y personalización

### 8.1 Marca madre

HUAU siempre debe estar presente.

### 8.2 Personalización por organización

Cada organización podrá configurar:

- nombre;
- logo;
- color de acento principal;
- color de acento secundario opcional;
- imagen/hero pública opcional;
- datos de contacto;
- slug público.

No se permite:

- reemplazar completamente HUAU;
- recolorear el wordmark oficial de HUAU de forma arbitraria;
- alterar componentes esenciales hasta romper consistencia.

La interfaz puede mostrar “Powered by HUAU” en superficies públicas personalizadas.

---

## 9. Cuenta global y perfil

### 9.1 Registro

Campos base:

- nombre;
- apellido;
- email;
- contraseña.

Perfil preparado desde V1 para:

- teléfono;
- fecha de nacimiento;
- sexo/género deportivo cuando sea necesario para elegibilidad;
- país;
- ciudad;
- foto opcional;
- idiomas;
- perfiles por deporte;
- nivel/rating por modalidad.

No todos los campos deben bloquear el registro. El UX podrá usar progressive profiling.

### 9.2 Multi-organización

Una cuenta puede pertenecer a varias organizaciones simultáneamente.

### 9.3 Solicitud de ingreso

Flujo del club piloto:

1. usuario crea cuenta;
2. busca/abre la organización;
3. solicita unirse;
4. Organization Admin verifica que corresponde;
5. aprueba/rechaza;
6. si aprueba, se habilitan beneficios según membresía.

### 9.4 Menores

El modelo de datos debe soportar menores, pero el flujo legal/UX de guardianes queda como decisión abierta antes de habilitar self-service para menores.

Mientras tanto, un organizador puede registrar manualmente a un menor como participante de torneo.

---

## 10. HUAU Club

### 10.1 Membresías

V1 no procesa el cobro mensual de membresías.

El administrador registra/actualiza el estado.

Debe soportar:

- membresía Pickleball;
- membresía Pádel;
- membresía Tenis;
- membresía General/multideporte;
- combinaciones futuras configurables.

Estados mínimos:

- pending;
- active;
- suspended;
- expired;
- inactive.

Una persona puede tener varios beneficios deportivos activos simultáneamente.

Campos configurables:

- fecha de inicio;
- fecha de vencimiento opcional;
- deportes habilitados;
- notas internas.

### 10.2 Canchas

Una organización puede definir uno o más venues y canchas.

Por cancha:

- deporte(s) admitidos;
- nombre/número;
- indoor/outdoor opcional;
- activa/inactiva;
- horario habitual;
- excepciones/bloqueos.

### 10.3 Reglas de reserva

Deben ser configurables por organización y, cuando sea necesario, por deporte:

- granularidad de inicio;
- duración mínima;
- incrementos de duración;
- duración máxima;
- anticipación máxima;
- anticipación mínima;
- máximo de reservas futuras;
- máximo de reservas por día/semana;
- posibilidad de reservar bloques consecutivos;
- tiempo de cancelación;
- aprobación automática o manual;
- tiempo máximo de una solicitud pendiente;
- reglas de membresía necesarias.

El club piloto utiliza reservas de una hora con extensiones de media hora; por eso el sistema no debe asumir slots rígidos de 60 minutos.

### 10.4 Flujo de reserva

Usuario:

**Deporte -> Fecha -> Hora -> Cancha -> Tipo -> Solicitar**

Estados:

- available;
- pending_approval;
- confirmed;
- rejected;
- cancelled;
- expired.

Si la organización requiere aprobación, una solicitud pendiente bloquea provisionalmente el intervalo para evitar doble reserva.

### 10.5 Bloqueos de cancha

Organization Admin puede bloquear uno o más intervalos por:

- mantenimiento;
- torneo;
- clase;
- actividad;
- clima;
- evento;
- otro.

No se requiere acción masiva específica de “cancelar por lluvia” en V1.

---

## 11. Partidos abiertos y comunidad

### 11.1 Regla principal

Un partido abierto **siempre debe estar asociado a una reserva/cancha real**. No existe en V1 un post genérico de “busco gente” sin horario y cancha.

### 11.2 Parámetros

- deporte;
- organización/venue;
- cancha;
- fecha;
- hora;
- duración;
- modalidad;
- cantidad total de jugadores;
- nivel recomendado opcional;
- masculino/femenino/mixto/abierto cuando aplique;
- descripción;
- privacidad;
- lugares ya cubiertos;
- lugares públicos disponibles.

### 11.3 Reserva privada vs abierta

**Privada:** el reservante ya tiene grupo y no publica lugares.

**Abierta:** el reservante publica uno o más lugares para que usuarios se sumen.

El creador puede indicar lugares ya ocupados por invitados/no registrados. Si un amigo ya es usuario HUAU, la experiencia recomendada es que se una con su cuenta.

### 11.4 Join/leave

- Un usuario puede sumarse mientras haya cupo.
- Si se baja, el cupo vuelve a abrirse.
- El partido permanece visible hasta el cutoff configurado.
- Puede existir lista de espera.

### 11.5 Liberación de reserva incompleta

La organización puede configurar que una reserva abierta se cancele/libere automáticamente si no alcanza un mínimo de participantes a X horas/minutos del comienzo.

El creador también puede cancelarla manualmente según las reglas del club.

### 11.6 Fuera de alcance

- chat interno;
- amigos;
- historial social de todos los partidos casuales;
- rating automático por partidos casuales.

---

## 12. Open Play

Open Play será una actividad oficial creada por la organización.

Debe permitir:

- título;
- deporte;
- fecha/horario;
- recurrencia opcional;
- una o varias canchas reservadas;
- nivel recomendado opcional;
- cupo total;
- lista de espera;
- precio opcional;
- elegibilidad por membresía opcional;
- descripción.

HUAU administra **inscripción y cupos**, no:

- rotaciones;
- emparejamientos internos;
- asistencia;
- penalizaciones por ausencia.

---

## 13. Clases, clínicas y eventos

### 13.1 Prioridad

P2. El modelo debe contemplarlo desde el inicio, pero no debe retrasar Tournament P0 ni Club P1.

### 13.2 Capacidades previstas

- clase individual;
- clase grupal;
- clínica;
- evento;
- profesor asignado;
- cupo;
- recurrencia;
- precio opcional;
- inscripción;
- agenda del coach.

Una clínica puede reutilizar el motor general de Activities en lugar de ser una app separada.

---

## 14. HUAU Tournament - capacidades heredadas que deben preservarse

La migración cloud debe conservar o mejorar las siguientes capacidades ya implementadas en HUAU Tournament legacy:

### 14.1 Personas y entradas

- registro único de personas dentro del torneo/organización;
- participación en varias categorías sin duplicar identidad;
- singles y dobles;
- ratings separados para singles/dobles en pickleball;
- vínculos de pareja;
- edición cosmética de una persona sin destruir competencia;
- participantes manuales sin cuenta HUAU.

### 14.2 Categorías y formatos

- número de participantes/parejas;
- grupos configurables;
- tamaños de grupos desiguales;
- 1 o 2 vueltas;
- clasificados fijos por grupo;
- wildcards/cupos extra por rendimiento;
- comparación cruzada normalizada/equiparada;
- fase posterior estándar;
- Top 2 -> Final;
- Top 4 -> Semifinales;
- Top 3 step ladder;
- campeón por tabla;
- consuelo opcional;
- bronce opcional;
- final/bronce single match o BO3;
- puntos objetivo configurables;
- bronce/final secuenciales o simultáneos;
- evitar revancha inmediata del grupo cuando sea posible;
- objetivo de partidos mínimos en simulación/formato.

### 14.3 Siembra/sorteo

- siembra serpentina por rating;
- orden manual;
- sorteo aleatorio;
- sorteo en vivo progresivo;
- confirmación antes de aplicar;
- grupos manuales.

### 14.4 Cronograma

- múltiples canchas;
- duración por categoría;
- descanso preferido;
- prohibición de una misma persona en dos canchas simultáneas;
- categorías por jornada/día;
- orden dentro de jornada;
- reserva de slots para fase final;
- BO3 con mayor duración reservada;
- cronograma compartible.

### 14.5 Resultados y fase final

- carga de resultados;
- BO3 con sets;
- tablas en vivo;
- clasificación automática;
- generación de bracket;
- byes;
- propagación de ganadores/perdedores;
- bronce;
- final;
- resultados ordenados según cronograma.

### 14.6 Comunicación

- modo TV;
- imagen de cronograma;
- imagen de grupos;
- resumen/criterios visibles;
- backup/import.

---

## 15. Ranking interno de grupo

La lógica heredada debe preservarse inicialmente para torneos estándar, salvo configuración explícita futura.

Dentro de un grupo, el orden actual es:

1. partidos ganados;
2. si hay empate exacto entre dos en victorias, head-to-head;
3. si hay empate de tres o más en victorias, mini-tabla entre empatados por mini-wins;
4. mini-diferencia de puntos entre empatados;
5. diferencia total de puntos;
6. puntos anotados;
7. rating como último fallback.

El motor de explicación debe poder mostrar estos criterios en lenguaje claro cuando el organizador expanda “Ver criterios”.

---

## 16. Comparación entre grupos desiguales

HUAU debe soportar dos métodos claramente diferenciados.

### 16.1 Normalizado

Para comparar participantes de la misma posición entre grupos de distinto tamaño:

1. porcentaje de victorias;
2. diferencia de puntos promedio por partido;
3. puntos anotados promedio por partido;
4. rating;
5. nombre como fallback determinista.

Ejemplo conceptual:

- 2-0 = 100%.
- 3-0 = 100%.
- +12 en 2 partidos = +6 por partido.
- +15 en 3 partidos = +5 por partido.

De esta manera jugar un partido adicional no otorga ventaja por acumulación.

### 16.2 Equiparado

La tabla interna de cada grupo utiliza todos los partidos.

Para comparar entre grupos:

- se toma el tamaño del grupo más pequeño;
- en los grupos grandes se excluyen, sólo para la comparación cruzada, los resultados frente a los participantes extra peor posicionados en la tabla interna;
- se recalculan PJ, victorias, diferencia y puntos sobre el conjunto equiparado;
- luego se aplica porcentaje de victorias, diferencia/partido y puntos/partido.

El sistema debe explicar explícitamente que **no se borran partidos del grupo**: sólo cambia la base de comparación entre grupos.

---

## 17. Corrección obligatoria: scheduling de dos vueltas

Bug detectado en operación real:

En grupos a dos vueltas, el legacy scheduler puede intercalar/repetir el mismo enfrentamiento de Vuelta 2 inmediatamente después de Vuelta 1.

### Requisito P0

- Todos los partidos de **Vuelta 1** deben entrar en el cronograma antes de cualquier partido de **Vuelta 2** del mismo grupo/competencia.
- Dentro de cada vuelta, el scheduler debe intentar maximizar rotación y descanso.
- Debe evitar repetir la misma pareja/jugador consecutivamente cuando existe una alternativa válida.
- La regla de no simultaneidad de una persona es absoluta.
- Si las restricciones no permiten descanso ideal, se puede degradar descanso, pero no mezclar vueltas ni asignar simultaneidad.

Este comportamiento debe contar con tests automáticos específicos.

---

## 18. Format Explanation Engine

### 18.1 Objetivo

Convertir la configuración real del torneo en una explicación entendible para jugadores y organizadores.

No se mantendrán cientos de textos completos por combinación.

El motor recibe reglas estructuradas y compone bloques semánticos localizados.

### 18.2 Salidas

**Resumen de formato**

- 1-3 párrafos simples.

**Criterios detallados**

- clasificación interna;
- comparación entre grupos;
- wildcards;
- seeding;
- byes;
- fase posterior;
- bronce/final;
- BO3/puntos.

### 18.3 Integridad

La parte matemática/oficial generada **no es editable**.

El organizador puede agregar:

- nota del evento;
- aclaración logística;
- mensaje adicional.

No puede modificar el texto oficial de forma que contradiga las reglas configuradas.

### 18.4 Idiomas V1

- Español.
- Inglés.

Arquitectura preparada para más idiomas.

### 18.5 Uso

La explicación debe aparecer en:

- página pública del torneo;
- categoría;
- inscripción;
- vista del organizador;
- elementos compartibles cuando corresponda.

---

## 19. Inscripciones de Tournament

### 19.1 Visibilidad del torneo

- público;
- sólo miembros;
- por invitación.

### 19.2 Unidad de inscripción

Configurable por categoría:

- individual;
- pareja;
- equipo.

### 19.3 Singles

Usuario elige categoría -> valida elegibilidad/cupo -> inicia pago si corresponde -> queda confirmado al aprobarse pago.

### 19.4 Dobles

Flujo recomendado:

1. jugador inicia inscripción;
2. selecciona/invita compañero con cuenta HUAU;
3. compañero acepta;
4. entry queda completo;
5. pago se realiza según política de la categoría;
6. confirmación final.

Organization Admin puede crear la pareja manualmente sin cuentas.

### 19.5 Equipos

Para categorías `team`:

- un capitán puede crear entry de equipo;
- nombre de equipo;
- roster según reglas de composición;
- invitar miembros HUAU;
- estado de invitaciones;
- administrador puede completar/modificar manualmente;
- inscripción sólo pasa a `ready` cuando se cumplen requisitos mínimos del roster.

### 19.6 Precio

La categoría debe admitir:

- gratis;
- precio por entry;
- precio por persona.

Esto es necesario para singles, parejas y equipos sin asumir un modelo de cobro único.

### 19.7 Cupos

- cupo por categoría;
- waitlist;
- administración puede mover waitlist -> confirmed;
- reglas de retención del cupo durante pago deben ser configurables/consistentes.

### 19.8 Overrides

Organization Admin puede:

- registrar participante manual;
- inscribir gratis;
- aplicar código de descuento/cortesía;
- aprobar/rechazar;
- marcar pago manual;
- resolver duplicados/errores.

---

## 20. Pagos de torneos

### 20.1 Alcance V1

HUAU procesa pagos únicamente para **inscripciones de torneos** en la primera etapa.

Clínicas, reservas, Open Play, clases y membresías quedan preparadas pero fuera de P0.

### 20.2 Principio de fondos

Los fondos van directamente al receptor configurado para el torneo. HUAU no actúa como cuenta puente en V1.

### 20.3 Métodos

- Mercado Pago conectado: automático.
- Transferencia: manual.
- Efectivo: manual.
- Gratuito/cortesía.

### 20.4 Mercado Pago

Experiencia requerida:

1. HUAU crea una intención/orden asociada a una inscripción específica.
2. Usuario es enviado al checkout de Mercado Pago.
3. Mercado Pago procesa.
4. HUAU recibe evento de estado.
5. HUAU verifica el evento server-side.
6. `approved` -> pago aprobado -> inscripción confirmada.

La vuelta del navegador a HUAU no es suficiente para confirmar pago.

### 20.5 Receptor configurable

Cada torneo puede seleccionar un Payment Account diferente de su organización creadora.

### 20.6 Transferencia

HUAU muestra instrucciones y puede ofrecer botón a WhatsApp para enviar comprobante. El archivo no necesita almacenarse en HUAU V1.

Organization Admin marca manualmente `paid` una vez verificado.

### 20.7 Comisión HUAU

V1:

- no split automático;
- no retención automática;
- HUAU calcula métricas facturables si se define tarifa por inscripción;
- cobro de HUAU al organizador ocurre fuera de la app.

### 20.8 Reembolsos

No se automatizan en V1. Debe quedar un estado capaz de reflejar `refunded` si el organizador gestiona devolución fuera de HUAU.

---

## 21. Página pública y HUAU Live

### 21.1 Sin login

Un visitante puede consultar, según configuración de privacidad:

- nombre del torneo;
- organizador;
- venue;
- fechas;
- categorías;
- formato explicado;
- participantes;
- grupos;
- cronograma;
- standings;
- resultados;
- bracket;
- estado de la competencia.

### 21.2 Responsive

La misma fuente de datos debe funcionar:

- en teléfono;
- tablet;
- escritorio;
- TV.

No se construyen dos sistemas de live distintos. La presentación cambia según viewport/modo.

### 21.3 Modo TV

Debe conservar:

- lectura a distancia;
- rotación/estado de categorías;
- próximos partidos;
- últimos resultados;
- standings/bracket.

### 21.4 Compartir

El producto debe mantener/recuperar:

- imagen de grupos;
- imagen de cronograma;
- enlaces públicos compartibles.

---

## 22. Team Competition Engine

### 22.1 Objetivo

Soportar torneos por equipos sin hardcodear un formato particular.

Los equipos se comportan como “entries” de la competencia para:

- grupos;
- liga;
- standings;
- playoff;
- seeding;
- bracket;
- cronograma de encounters.

Un enfrentamiento `Team A vs Team B` contiene una lista ordenada de partidos/rubbers.

### 22.2 Configuración de roster

El organizador define:

- mínimo de integrantes;
- máximo de integrantes;
- composición libre/masculina/femenina/mixta;
- cuotas mínimas/máximas por sexo/género deportivo cuando corresponda;
- suplentes si se permiten;
- capitán opcional.

Ejemplos soportables:

- 2 hombres + 2 mujeres;
- 3 hombres + 3 mujeres;
- equipo abierto de 4-6;
- equipo exclusivamente masculino/femenino.

### 22.3 Builder de encounter

El organizador puede agregar, quitar y ordenar rubbers.

Cada rubber define:

- singles/doubles;
- masculino/femenino/mixto/abierto;
- orden;
- puntos/scoring;
- BO1/BO3/etc. cuando corresponda;
- si siempre se juega o sólo si es necesario;
- si actúa como tiebreaker;
- peso en el resultado de la serie (V1 default = 1 victoria).

### 22.4 Determinación del ganador

Configurable:

- mayoría de rubbers;
- primero en alcanzar X victorias;
- todos los rubbers se disputan aunque la serie esté definida;
- tiebreaker condicional si existe empate posible.

### 22.5 Alineación

El organizador administra la alineación.

Debe poder:

- seleccionar jugadores elegibles del roster para cada rubber;
- validar número de jugadores y modalidad;
- impedir usar jugador no perteneciente al roster;
- bloquear alineación cuando comienza el encounter;
- permitir corrección administrativa explícita con warning si aún no hay resultado.

La autoasignación de alineaciones no es requisito V1.

### 22.6 Formato de septiembre 2026

Debe poder configurarse sin código especial como:

1. Dobles Masculino.
2. Dobles Femenino.
3. Singles Masculino.
4. Singles Femenino.
5. Dobles Mixto.

El quinto partido define la serie si llegan 2-2; la configuración puede indicar si igualmente se juega cuando la serie ya está definida o si sólo se juega de ser necesario.

### 22.7 MLP-like

Debe ser posible crear una configuración diferente donde, tras rubbers regulares, exista un tiebreaker condicional tipo DreamBreaker u otra definición del organizador.

HUAU no debe utilizar el nombre/regla de MLP como dependencia técnica.

### 22.8 Fase competitiva

Los Team Entries pueden participar en:

- grupo único;
- múltiples grupos;
- una o dos vueltas;
- liga;
- playoffs;
- bracket estándar;
- bronce/final;
- métodos de clasificación configurados.

### 22.9 Standings de equipos

V1 debe incluir un método predeterminado consistente:

1. encounters ganados;
2. porcentaje de encounters ganados si PJ desigual;
3. diferencia de rubbers ganados/perdidos;
4. diferencia de puntos agregada o normalizada según configuración;
5. criterio adicional configurado.

El organizador debe ver qué criterio se está aplicando. La extensión a reglas de liga específicas debe ser posible sin cambiar el modelo central.

---

## 23. HUAU Ref

### 23.1 Posicionamiento

HUAU Ref forma parte del módulo Tournament. No se vende como producto separado en V1.

### 23.2 Experiencia dedicada

Aunque pertenezca a Tournament, Ref conserva interfaz propia enfocada en arbitraje.

### 23.3 Capacidades legacy a preservar

- pickleball singles/doubles;
- scoring tradicional/rally;
- 1 set, BO3, BO5;
- target 11/15/21;
- win by 2;
- primer equipo al saque;
- seguimiento de servidor;
- posiciones derecha/izquierda;
- servidor 1/2 en dobles tradicional;
- timeouts;
- advertencias;
- corrección manual;
- undo/redo;
- resumen/finalización;
- persistencia local.

### 23.4 Operación básica V1

Para eventos con conectividad limitada:

- Ref puede operar standalone/offline en una tablet;
- árbitro comunica resultado al delegado/mesa;
- delegado carga resultado en Tournament.

### 23.5 Integración profesional posterior

- asignación de árbitro;
- “próximo partido” en dispositivo;
- carga automática de roster/match;
- finalización -> resultado enviado a Tournament;
- revisión/confirmación opcional de mesa.

---

## 24. Seguridad de datos y protección operativa

### 24.1 Principio

Un operador no técnico debe poder usar HUAU sin miedo a destruir un torneo.

### 24.2 Ediciones cosméticas

Cambios como:

- nombre;
- contacto;
- club;
- notas;
- rating;

no deben regenerar competencia automáticamente salvo que un dato sea una dependencia explícita de seeding antes de bloquear la estructura.

### 24.3 Cambios estructurales

Ejemplos:

- agregar/quitar participante;
- cambiar pareja;
- cambiar cantidad de grupos;
- cambiar clasificados;
- cambiar formato;
- regenerar sorteo;
- modificar roster de equipo en fase bloqueada.

Antes de aplicar:

- mostrar impacto exacto;
- generar snapshot automático;
- pedir confirmación significativa.

### 24.4 Bloqueo de estructura

Una categoría/competencia puede pasar a estado `structure_locked`.

Una vez bloqueada:

- resultados pueden seguir cargándose;
- cambios estructurales requieren acción explícita “Desbloquear estructura” y explicación de impacto.

### 24.5 Snapshots

Crear automáticamente antes de operaciones destructivas y en hitos:

- grupos confirmados;
- cronograma generado;
- inicio de torneo;
- primer resultado;
- fase final generada;
- cambio estructural.

### 24.6 Undo/restore

Debe existir restauración del último snapshot relevante y acceso de soporte a snapshots anteriores.

### 24.7 Audit trail mínimo

Aunque no sea una pantalla prominente para el club, HUAU registra acciones críticas:

- actor;
- timestamp;
- organización;
- entidad;
- acción;
- resumen before/after o reference;
- source device/session.

Objetivo: soporte y recuperación, no vigilancia.

---

## 25. Offline resilience

### 25.1 Tournament

Debe ser capaz de seguir operando cuando se corta Internet después de haber cargado el evento.

Operaciones esenciales offline:

- abrir torneo descargado;
- ver grupos/cronograma;
- cargar resultados;
- calcular standings;
- generar/continuar bracket cuando las dependencias están disponibles;
- mantener cola local de cambios;
- exportar backup local.

Al reconectar:

- sincronizar mutaciones pendientes en orden;
- no sobrescribir silenciosamente cambios incompatibles;
- informar conflicto real cuando corresponda.

### 25.2 Public/live

Si el operador queda offline, la web pública conserva el último estado confirmado en cloud y debe mostrar “última actualización” si la frescura es relevante.

### 25.3 Ref

Ref debe continuar funcionando completamente durante un partido sin red.

---

## 26. Notificaciones

La filosofía V1 es **pocas y relevantes**.

### 26.1 Email P0

Candidatos mínimos:

- verificación de cuenta;
- recuperación de contraseña;
- inscripción confirmada;
- pago aprobado;
- invitación de pareja/equipo;
- cambio crítico/cancelación de torneo cuando el organizador decide notificar.

### 26.2 In-app

Puede cubrir eventos menos críticos:

- solicitud de membresía aceptada;
- reserva aprobada/rechazada;
- lugar disponible;
- invitaciones;
- grupos/cronograma publicados.

### 26.3 Push

Fuera de P0. Preparado conceptualmente para futuro.

La matriz final de notificaciones sigue abierta y se registra en el ADR/Open Decisions.

---

## 27. Internacionalización

### 27.1 Idiomas V1

- Español.
- Inglés.

### 27.2 Requisitos

- ningún texto central hardcodeado en componentes;
- idioma por usuario;
- idioma predeterminado por organización;
- contenido público traducible cuando la organización lo configure;
- Format Explanation Engine localizado;
- formato de fecha/hora/moneda basado en locale;
- zona horaria por organización/venue.

### 27.3 Monedas iniciales

- UYU.
- USD.

Modelo preparado para ISO 4217 adicionales (EUR, BRL, etc.) sin migración de arquitectura.

---

## 28. Analítica

### 28.1 Platform Admin

Mínimo:

- organizaciones activas;
- usuarios registrados;
- usuarios activos;
- torneos creados/completados;
- inscripciones;
- reservas;
- partidos abiertos;
- volumen de pagos registrado;
- uso por módulo;
- errores críticos/sync failures.

No se busca un BI complejo en V1.

### 28.2 Organization Admin

Mínimo:

- miembros activos;
- reservas por periodo;
- ocupación básica por cancha/horario;
- partidos abiertos creados/completados;
- actividades/inscripciones;
- torneos e inscripciones;
- pagos pendientes/aprobados.

---

## 29. Navegación conceptual

### 29.1 Público

- `/` - landing HUAU.
- `/organizations/:slug` - página pública de organización.
- `/tournaments/:slug` - torneo público/live.

### 29.2 Autenticado

Una sola entrada/login.

Después de login, HUAU presenta espacios según permisos:

- Mi HUAU.
- Organización/Admin.
- Coach, cuando aplique.
- Tournament workspace.
- Ref, cuando corresponda.
- Platform Admin, sólo para usuarios autorizados.

No se crean sistemas de login separados por módulo.

---

## 30. PWA y futuras apps nativas

V1 debe ser PWA instalable.

Objetivos:

- installable;
- shell offline;
- caching seguro;
- IndexedDB para estado operativo offline;
- UX mobile de calidad.

La arquitectura TypeScript y los paquetes de dominio deben permitir reutilización posterior en app nativa/híbrida.

---

## 31. Requisitos de UX de alto nivel

- Jugador/usuario: **mobile-first**.
- Admin: **desktop/tablet-first**, responsive a móvil para acciones puntuales.
- Ref: **tablet landscape-first**, usable en teléfono.
- Live: responsive desde móvil a TV.
- Administración: mínima animación, máxima claridad.
- Landing/público: movimiento sutil, premium y orientado a producto.
- Formularios complejos deben usar progressive disclosure.
- Cambios destructivos deben explicar consecuencias en lenguaje humano.

---

## 32. Métricas de éxito del piloto

### 32.1 Tournament

- cero pérdida de datos;
- torneo completo sin necesidad de Excel/papel como sistema de verdad;
- cálculo correcto de grupos/clasificación/bracket;
- cronograma utilizable durante evento;
- publicación pública entendible;
- pagos e inscripciones conciliados;
- organización capaz de operar con soporte mínimo.

### 32.2 Club

El éxito se evalúa en tres dimensiones:

**Adopción**  
Los miembros usan HUAU para reservas/partidos/torneos.

**Operación**  
El club reduce tareas manuales y centraliza información.

**Percepción**  
La comunidad percibe una experiencia más profesional, clara y organizada.

Los targets numéricos se fijarán con el club piloto una vez conocido su baseline real.

---

## 33. Riesgos principales

### R1 - Replatforming rompe lógica validada

Mitigación: extraer Tournament Engine puro, fixtures de paridad, no retirar legacy antes de ensayo real.

### R2 - Arquitectura cloud pierde resiliencia offline

Mitigación: offline-first para workspace de torneo, cola local, snapshots, backup exportable.

### R3 - Configurabilidad excesiva genera UI inmanejable

Mitigación: presets + opciones avanzadas progresivas; wizard de formato; explicación automática.

### R4 - Pagos inconsistentes

Mitigación: server-side verification, webhook firmado, idempotencia, estados explícitos, reconciliación.

### R5 - Multi-tenant sin RLS de base

Mitigación: autorización obligatoria en service layer, queries scopeadas por organization_id, tests de aislamiento.

### R6 - Team Engine crece demasiado antes de septiembre

Mitigación: construir modelo configurable pero limitar UI P0 a opciones necesarias + builder general de rubbers.

### R7 - Usuarios no técnicos rompen torneo

Mitigación: structure lock, snapshots, impact confirmations, restore, modo operador simplificado.

---

## 34. Prioridades congeladas

### P0 - Bloqueante para septiembre

- foundation cloud;
- auth/cuenta;
- organizations;
- Tournament Engine migrado y testeado;
- fix dos vueltas;
- safeguards;
- Team Competition Engine;
- inscripción individual/pareja/equipo;
- Mercado Pago + manual payments;
- public/live;
- ES/EN;
- explanation engine;
- PWA/offline tournament.

### P1 - Club piloto

- membresías manuales;
- canchas;
- disponibilidad;
- reservas;
- aprobación;
- partidos abiertos;
- waitlists;
- Open Play;
- dashboard org;
- platform admin básico.

### P2

- clinics/events;
- coach dashboard;
- advanced activities;
- Ref connected workflow;
- payment expansion;
- push.

### P3

- native apps;
- more sports;
- more languages;
- automatic HUAU marketplace fee;
- advanced analytics;
- cross-club rankings/social features.

---

## 35. Criterios de aceptación globales de V1

HUAU V1 no se considera lista para reemplazar Tournament legacy hasta que:

1. Los fixtures principales del legacy producen los mismos standings/clasificados/brackets donde la regla no cambió.
2. El caso 3/4/4 funciona con Normalized y Equalized.
3. Dos vueltas nunca programa Vuelta 2 antes de terminar de programar Vuelta 1.
4. Una edición cosmética de persona no invalida grupos/cronograma.
5. Agregar/quitar participante muestra impacto y snapshot antes de regenerar.
6. Un torneo puede continuar sin Internet después de estar cargado en el dispositivo.
7. Una mutación offline puede sincronizarse posteriormente sin duplicarse.
8. Dos sesiones no pueden sobrescribirse silenciosamente.
9. Los pagos no se confirman sólo por redirect del navegador.
10. Un torneo por equipos puede configurar el formato de septiembre sin código específico.
11. Un torneo por equipos puede configurar un tiebreaker condicional diferente.
12. Un usuario puede consultar el live desde móvil sin login.
13. La interfaz de TV usa la misma fuente de estado publicado.
14. Español e inglés están completos en los flujos P0.
15. El admin de plataforma puede asistir una organización sin conocer/mostrar sus secretos de pagos.

---

## 36. Decisiones abiertas que NO bloquean el PRD

Se registran formalmente en `08_OPEN_DECISIONS_ADR_REGISTER_v1.0.md`:

- reglas exactas de membresías del club piloto;
- límites reales de reservas;
- flujo legal/UX de menores;
- matriz final de emails/notificaciones;
- política exacta de cancelación/reembolso de torneo;
- pricing comercial HUAU;
- si el quinto rubber del clasificatorio se juega siempre o sólo con 2-2;
- reglas exactas de standings del clasificatorio por equipos si el organizador provee reglamento específico;
- si el pago del clasificatorio es por persona o por equipo;
- branding/accent final del club piloto.

Estas decisiones deben resolverse por configuración o ADR, sin requerir rediseñar la arquitectura.

---

## 37. Resultado esperado

HUAU debe evolucionar desde una herramienta de torneo manejada por su creador a una plataforma que pueda ser utilizada por otra organización con mínima capacitación, sin perder la ventaja que ya demostró: **hacer que el torneo sea más claro para jugadores y mucho menos estresante para quien lo opera.**
