# COEPRISS Sinaloa - Sistema de Facturación y Timbrado

Este es un prototipo interactivo premium recreado de manera fiel a partir de las capturas del flujo del sistema de COEPRISS Sinaloa.

## Contenido del Proyecto
El proyecto consta de tres archivos principales:
1. **`index.html`**: Contiene la estructura semántica de la barra lateral, el Stepper de 7 pasos superior, las tarjetas de cada paso, y los modales interactivos para edición y previsualización.
2. **`style.css`**: Contiene todo el diseño visual premium adaptado con la tipografía *Inter* y *Outfit*, la paleta de colores guinda institucional del gobierno de Sinaloa con acentos dorados, efectos de sombreado modernos, animaciones keyframe para simulación de escaneo y diseño totalmente responsivo para dispositivos móviles y tablets.
3. **`app.js`**: Implementa las interacciones dinámicas de la aplicación, como la navegación libre por el Stepper, animación láser de escaneo, edición de datos fiscales en tiempo real, simulación de descarga de archivos XML y PDF, simulador de arrastrar y soltar (drag & drop), sistema de notificaciones flotantes (Toasts) de éxito e información, y filtro inteligente de búsqueda en tiempo real dentro del panel de reportes.

## Instrucciones para Ejecución en Visual Studio Code
Para abrir y probar la aplicación directamente en tu navegador:
1. Abre **Visual Studio Code**.
2. Selecciona **Archivo -> Abrir Carpeta...** (File -> Open Folder...).
3. Selecciona el directorio: `C:\Users\DELL\.gemini\antigravity\scratch\coepriss-billing-system`.
4. Si tienes instalada la extensión **Live Server** en VS Code:
   - Haz clic derecho sobre `index.html` y selecciona **Open with Live Server**.
   - Esto abrirá la aplicación en una dirección local (ej. `http://127.0.0.1:5500/index.html`) con recarga automática.
5. Si no tienes Live Server:
   - Simplemente haz doble clic sobre el archivo `index.html` en el explorador de archivos para abrirlo en tu navegador favorito.

## Características de la Simulación Interactiva
- **Paso 1 (Recepción)**: Al dar clic en "Escanear / Leer documentos" se activará una animación de láser dorado y, tras 1.8 segundos, avanzará de forma automática al Paso 2, emitiendo una notificación en la parte inferior derecha.
- **Paso 2 (Extracción)**: Puedes dar clic en el botón **Editar** para abrir un modal donde podrás modificar los datos del receptor. Al guardar los cambios, estos se actualizarán dinámicamente y se verán reflejados en los pasos siguientes.
- **Paso 3 (Vista Previa)**: Muestra el desglose de la factura con el cálculo exacto de IVA y Subtotal a partir del importe total de $1,160.00 pesos.
- **Paso 4 (Generación XML)**: Los botones **Descargar XML** y **Abrir portal del SAT** son interactivos. "Descargar XML" genera y descarga en tu navegador un archivo `.xml` real con los datos fiscales actuales.
- **Paso 5 (Carga)**: Muestra los archivos timbrados listos.
- **Paso 6 (Factura Timbrada)**: Al dar clic en **Ver factura (Vista previa)** se abrirá una representación visual del PDF de la factura (con diseño estilo matriz de puntos/ticket) que se adapta en tiempo real a los datos fiscales del cliente.
- **Paso 7 (Registro en Reporte)**: Incluye una tabla general de facturas timbradas. Si usas el buscador del panel superior e ingresas palabras clave (como "Juan", "Ejemplo", "F-00043"), la tabla filtrará sus filas en tiempo real y recalculará la leyenda "Mostrando X de Y resultados" en el pie de página.
