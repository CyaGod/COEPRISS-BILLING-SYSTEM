# Plan Maestro de Perfeccionamiento del OCR

## Casos reales de oficina COEPRISS

## 1. Objetivo

Mejorar la lectura local de comprobantes, recibos CIS, constancias fiscales y documentos bancarios capturados desde equipos de oficina, con especial atención a documentos horizontales de aproximadamente 1280 × 816 px.

El resultado esperado es una extracción consistente de:

- RFC y razón social del contribuyente.
- Régimen fiscal y código postal.
- Folio CIS o folio del recibo.
- Concepto completo.
- Importe y moneda.
- Fecha de operación, fecha de pago y fecha de recepción.
- Referencia, clave de rastreo y datos bancarios cuando existan.
- Correo del contribuyente, sin confundirlo con correos institucionales del documento.

El OCR seguirá funcionando localmente en el navegador. Los datos detectados serán una precarga editable y deberán confirmarse antes de continuar al timbrado.

## 2. Diagnóstico del caso real

| Problema | Causa técnica | Resultado esperado |
|---|---|---|
| Documento horizontal leído a la mitad | Las regiones actuales asumen una hoja vertical dividida en columnas | Reconocer orientación y usar bandas adaptadas |
| Correo incorrecto del pie institucional | El extractor toma el primer correo encontrado | Priorizar el correo etiquetado del contribuyente |
| Régimen confundido con Régimen Capital | La expresión regular no distingue ambos encabezados | Extraer sólo Regímenes Fiscales |
| Razón social truncada | Una región corta una línea larga | Conservar candidatos de página completa y regiones |
| Referencia incorrecta | Se interpreta una etiqueta cercana como valor | Exigir etiqueta, formato y valor válido |
| Folio contaminado con texto | El extractor usa patrones genéricos de folio | Separar folio CIS, folio bancario y folio de operación |
| Concepto contaminado con campos posteriores | Faltan etiquetas de corte como Fecha y Estatus | Usar límites completos por tipo documental |
| Uso CFDI no detectado | Etiqueta y valor pueden aparecer en líneas distintas | Normalizar código y descripción SAT |
| Valor unitario falso | Regla numérica demasiado amplia | Extraerlo sólo de una tabla CFDI identificable |

## 3. Arquitectura de extracción

La extracción se dividirá en cuatro etapas:

1. **Preparación:** orientación, rotación, encuadre, escala y mejora visual.
2. **Reconocimiento:** página completa, regiones y QR cuando esté disponible.
3. **Clasificación:** identificar si el archivo es una constancia SAT, recibo CIS, comprobante bancario, CFDI u otro.
4. **Consolidación:** generar candidatos por campo, seleccionar el candidato compatible con el tipo documental y marcar conflictos para revisión.

Cada candidato deberá conservar:

```js
{
    field: 'rfcReceptor',
    value: 'EIA15081956A',
    normalized: 'EIA15081956A',
    confidence: 0.91,
    sourceFile: 'constancia.pdf',
    page: 1,
    region: 'datos-fiscales',
    extractor: 'constancia-sat-v1',
    evidence: 'RFC: EIA15081956A'
}
```

No se deberá elegir automáticamente el primer valor encontrado si existen candidatos incompatibles.

## 4. Soluciones técnicas

### 4.1 Orientación, escala y regiones adaptativas

Modificar `recognizeImageWithFallback` para:

- Detectar orientación horizontal, vertical y rotada.
- Corregir rotación antes de definir regiones.
- Usar bandas horizontales completas para recibos apaisados.
- Mantener regiones de encabezado, contribuyente, concepto, importes y pie.
- Escalar el lado mayor hacia una resolución suficiente, con límites de memoria.
- Conservar una pasada de página completa como referencia.
- Comparar resultados de página completa y regiones mediante candidatos, no por orden de ejecución.

Para el documento horizontal de oficina se propone inicialmente:

- Encabezado institucional: 0–22 %.
- Datos del contribuyente: 18–50 %.
- Concepto y detalle: 42–78 %.
- Importes, folios y fechas: 68–96 %.

Estos porcentajes deberán configurarse por plantilla y no aplicarse a todos los documentos.

### 4.2 Extractor especializado de recibos CIS COEPRISS

Crear una plantilla activada sólo cuando existan suficientes anclas como `COEPRISS`, `Secretaría de Salud`, `Recibo de Pago`, `Derechos` o `Servicios`.

Campos:

- Municipio o delegación.
- Folio CIS, incluyendo formatos como `AB-074673` o `074673`.
- RFC del solicitante como candidato, sin asumir automáticamente que es el receptor fiscal.
- Nombre o razón social completo.
- Concepto o servicio completo.
- Importe.
- Fecha de operación.
- Fecha o sello de recepción.

El extractor deberá detener cada campo en la siguiente etiqueta conocida y eliminar encabezados, numeración de tabla y texto del pie.

### 4.3 Correos electrónicos

El extractor deberá aplicar esta prioridad:

1. Correo situado junto a `Correo electrónico`, `Email` o `E-mail`.
2. Correo situado en la sección de datos del contribuyente.
3. Correo encontrado en el cuerpo principal.
4. Correo de pie institucional, marcado como baja prioridad.

No se bloquearán automáticamente todos los dominios gubernamentales. En su lugar, se penalizarán direcciones con etiquetas como `denuncias`, `soporte`, `contacto`, `quejas` o `atención`, y se solicitará confirmación si no hay evidencia de que pertenecen al contribuyente.

### 4.4 Régimen Capital y Régimen Fiscal

Modificar `parseExtractedFields` para:

- Ignorar expresamente `Régimen Capital` al buscar el régimen tributario.
- Buscar `Régimen Fiscal`, `Regímenes Fiscales` y sus variantes OCR.
- Validar el código contra un catálogo SAT versionado.
- Separar el código (`601`, `603`, `612`, etc.) de su descripción.
- Marcar conflicto cuando aparecen varios regímenes incompatibles.

### 4.5 Referencias, folios y claves bancarias

Separar los campos:

- `folioRecibo`.
- `folioOperacion`.
- `referencia`.
- `claveRastreo`.
- `cuentaBeneficiaria`.

Cada campo deberá depender de una etiqueta concreta y validar su formato. No se deberán aceptar como valor palabras como `HORA`, `FECHA`, `CANAL`, `INTERBANCARIO`, `SUCURSAL`, `OPERACIÓN` u `OPERACION`.

Reglas iniciales:

- Referencia: alfanumérica o numérica, con al menos un dígito.
- Clave de rastreo: alfanumérica de longitud definida por el formato bancario.
- CLABE o cuenta: sólo dígitos y longitud permitida.
- Folio CIS: patrón propio del recibo, no el patrón genérico de banco.

### 4.6 Fusión de documentos

Modificar `mergeExtractedFieldSets` para ponderar el origen:

| Campo | Fuente prioritaria |
|---|---|
| RFC receptor | Constancia SAT o CFDI receptor |
| Razón social | Constancia SAT |
| Régimen y CP | Constancia SAT |
| Folio CIS | Recibo CIS |
| Concepto e importe del trámite | Recibo CIS |
| UUID y metadatos fiscales | CFDI |
| Clave de rastreo y bancos | Comprobante bancario |

Cuando dos archivos aporten valores distintos, conservar ambos candidatos y mostrar un conflicto. No sobrescribir silenciosamente con el primer valor encontrado.

## 5. Reglas de seguridad funcional

Antes de avanzar al timbrado, el sistema deberá exigir confirmación de:

- RFC receptor.
- Razón social.
- Código postal.
- Régimen fiscal.
- Uso CFDI.
- Importe.

El timbrado quedará bloqueado si:

- Falta un campo crítico.
- Existe conflicto entre documentos.
- El RFC sólo proviene de un emisor o de un documento no fiscal.
- La imagen tiene calidad baja.
- El usuario no confirmó manualmente los campos.

La palabra `PAGADO` o un importe detectado por OCR no deberá considerarse confirmación bancaria.

## 6. Archivos a modificar

### `app.js`

- `recognizeImageWithFallback`: orientación, bandas y escala.
- `parseExtractedFields`: etiquetas, fechas, correos, régimen, referencias y campos CIS.
- `mergeExtractedFieldSets`: candidatos, prioridad documental y conflictos.
- `applyExtractedFields`: sólo aplicar valores no conflictivos y conservar evidencia.
- `proceedToStep4`: puerta de confirmación para campos críticos.
- Estados de archivo y contador de resultados OCR.

### `index.html`

- Mostrar archivo, página y evidencia de cada campo.
- Mostrar conflictos de documentos.
- Sustituir el mensaje de precisión absoluta por estados de revisión.
- Mostrar errores por archivo y advertencias de páginas no procesadas.

### Nuevos archivos

- `ocr-core.js`: funciones puras de normalización, clasificación y parsing.
- `test/ocr/*.test.js`: pruebas unitarias con `node --test`.
- `fixtures/ocr/expected.json`: valores esperados sin almacenar documentos personales reales.

## 7. Fases de implementación

### Fase 1 — Correcciones del parser

- Corregir Uso CFDI.
- Corregir límites del concepto.
- Eliminar falsos positivos de valor unitario, folio y referencia.
- Corregir el contador de archivos procesados.

### Fase 2 — Orientación y plantilla CIS

- Añadir detección horizontal.
- Añadir bandas adaptativas.
- Implementar extractor CIS.

### Fase 3 — Evidencia y fusión

- Añadir candidatos por campo.
- Añadir clasificación documental.
- Añadir prioridades y conflictos.

### Fase 4 — Revisión y timbrado seguro

- Mostrar evidencia en la interfaz.
- Bloquear campos críticos no confirmados.
- Persistir únicamente valores confirmados como datos fiscales.

### Fase 5 — Rendimiento y compatibilidad

- Limitar memoria y duración por archivo.
- Aislar fallos de archivos individuales.
- Definir política para PDFs de más de tres páginas.
- Verificar formatos realmente compatibles con cada navegador.

## 8. Plan de pruebas

### Pruebas unitarias

- PDF con capa de texto.
- PDF escaneado.
- Imagen horizontal de 1280 × 816 px.
- Imagen vertical.
- Imagen rotada.
- Documento con sombras y baja iluminación.
- Constancia SAT con `Régimen Capital`.
- Correo institucional en pie de página.
- Varias referencias en un mismo documento.
- Concepto de varias líneas.
- Campos y etiquetas en líneas separadas.

### Prueba objetivo del recibo CIS

El texto esperado debe validar, como mínimo:

- Folio: `074673` o `AB-074673`, según lo que muestre el documento.
- RFC: `EIA15081956A` como candidato del solicitante.
- Importe: `$1,408.00`.
- Concepto completo de la constancia de condiciones sanitarias.
- Fecha de operación y sello recibido por separado.
- Sin correo institucional tomado del pie.
- Sin confundir `Régimen Capital` con régimen fiscal.

### Prueba de integración

Probar la carga combinada de los archivos de `mierda/` y verificar:

- Cada archivo conserva su estado.
- Los campos indican archivo y página de origen.
- Los conflictos no se ocultan.
- Un archivo defectuoso no cancela los demás.
- El botón de timbrado permanece bloqueado hasta la confirmación requerida.

## 9. Criterios de aceptación

El trabajo se considerará terminado cuando:

- El caso horizontal ya no pierda la mitad del documento.
- La razón social se conserve completa.
- El correo del contribuyente no sea sustituido por uno institucional sin advertencia.
- `Régimen Capital` no se guarde como régimen fiscal.
- Folio, referencia y clave de rastreo no se mezclen.
- El concepto no incluya los campos posteriores.
- `Uso CFDI` se normalice correctamente.
- No se genere un valor unitario si no existe una línea CFDI inequívoca.
- Los conflictos se presenten al usuario.
- Los seis campos críticos requieran confirmación antes del timbrado.
- La suite de pruebas pase en cada cambio del OCR.

## 10. Entregables

1. Parser corregido y separado de la interfaz.
2. Extractor CIS COEPRISS.
3. Clasificador de documentos y sistema de candidatos.
4. Interfaz de evidencia y conflictos.
5. Bloqueo de timbrado por datos no confirmados.
6. Suite de pruebas OCR.
7. Reporte de precisión por campo y tipo documental.
8. Documentación actualizada en `README.md`.
