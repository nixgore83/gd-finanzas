# Guía: cómo cargar tus movimientos en gd-finanzas

> Para Pau 💙 — paso a paso, sin tecnicismos.
> Esta guía sigue **exactamente** los botones y pantallas que vas a ver en la app.

---

## Antes de empezar

La app **no se conecta sola a los bancos**. La forma de cargar tus movimientos es:

> **Bajás el resumen del homebanking → lo subís a la app → un asistente (la IA) lee las
> transacciones → vos las revisás → confirmás.** Listo, quedan cargadas.

No tenés que tipear nada a mano. Solo subir el archivo y revisar que la IA lo haya leído bien.

### Qué cuentas tenés que cargar

Hoy tus cuentas están casi vacías. Estas son **tuyas** y faltan cargar:

| Cuenta (como figura en la app) | Estado actual | Qué bajar |
|---|---|---|
| **Galicia Caja de ahorro · Pau · ARS** | Empezada (pocos movimientos) | Resumen mensual PDF |
| **Galicia Master · Pau · ARS** (tarjeta Mastercard) | Vacía | Resumen de tarjeta PDF |
| **Galicia Visa · Pau · ARS** (tarjeta Visa) | Vacía | Resumen de tarjeta PDF |
| **Galicia Inversiones · Pau · ARS** (broker) | Vacía | Resumen del broker PDF |

> 📛 Así es como vas a ver los nombres en los desplegables de la app: el formato es
> **`Institución Producto · Dueño · Moneda`**. Tus dos tarjetas se distinguen por la marca
> (**Master** y **Visa**).

> 💡 La idea es cargar **un resumen por mes y por cuenta**. Lo más cómodo es bajar todos
> los meses que tengas disponibles (enero a hoy) y subirlos juntos.

### Qué necesitás a mano

1. **Los resúmenes en PDF** descargados del homebanking de Galicia (uno por cuenta y por mes).
2. Si algún PDF te pide **contraseña para abrirlo** (típico en resúmenes de tarjeta), tenela
   anotada. La app te la va a pedir una sola vez y la puede recordar.

> Formatos que acepta: **PDF** (lo normal), y también CSV/XLSX —pero CSV es solo para HSBC US,
> así que para Galicia siempre va a ser **PDF**. Máximo **20 MB** por archivo.

---

## El recorrido, de un vistazo

```
  ┌──────────┐   ┌──────────┐   ┌───────────┐   ┌──────────┐   ┌────────────┐
  │ 1. Subir │ → │ 2. La IA │ → │ 3. Revisar│ → │ 4. Cuenta│ → │ 5. Confirmar│
  │  el PDF  │   │   lee    │   │  líneas   │   │ destino  │   │            │
  └──────────┘   └──────────┘   └───────────┘   └──────────┘   └────────────┘
   subís 1 o     esperás ~1-2    aceptás /        elegís a      quedan creadas
   varios        minutos         editás /         qué cuenta    las transacciones
   archivos                      rechazás         van
```

El único paso que lleva atención es el **3 (revisar)**. El resto es casi automático.

---

## Paso 1 — Subir el resumen

1. En el menú entrás a **Imports** (en la sección *Tools*).
2. Tocás el botón **`+ Subir extracto`** (si nunca subiste nada, el botón dice **`+ Subir el primero`**).
3. Caés en la pantalla **"Nuevo import"**:

```
┌─ Nuevo import ───────────────────────────────────────────────┐
│ Subí un resumen PDF (o CSV en cuentas HSBC US). Tras subirlo, │
│ vas a poder parsearlo con LLM y revisar las transacciones     │
│ antes de confirmar.                                           │
│                                                               │
│  Archivos (PDF, CSV o XLSX, hasta 20 MB c/u)                  │
│  [  Elegir archivos…  ]   ← acá seleccionás 1 o varios PDFs   │
│                                                               │
│  Por cada archivo elegido:                                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ resumen-galicia-enero.pdf                      [Quitar]  │ │
│  │  Institución [ Galicia ▾ ]  ← OBLIGATORIO               │ │
│  │  Tipo        [ Banco   ▾ ]                               │ │
│  │  Cuenta      [ Sin especificar ▾ ]  ← opcional          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                               │
│              [  Subir 1 archivo(s)  ]                         │
└───────────────────────────────────────────────────────────────┘
```

**Qué completar por cada archivo:**

- **Institución** → **Galicia** (obligatorio).
- **Tipo** → elegí según qué resumen es: **Tarjeta de crédito**, **Banco** (la caja de ahorro)
  o **Broker** (inversiones).
- **Cuenta** → opcional. Si la elegís acá, mejor (la app ya sabe a dónde va). Si no, la
  elegís más adelante en la revisión. Dejala en *"Sin especificar"* si tenés dudas.

4. Tocás **`Subir N archivo(s)`**. Vas a ver un toast verde: **"Import creado"** (o
   *"N imports creados"* si subiste varios).

> 💡 **Tip:** podés seleccionar **varios PDFs de una** (todos los meses juntos). La app crea
> un import por cada uno. Si subís un archivo que ya habías subido antes, te avisa y podés
> elegir **`Re-importar duplicados`** o saltearlo.

---

## Paso 2 — La IA lee el resumen ("parsear")

Apenas subís, la app **empieza a leer el PDF sola** en segundo plano. Vas a ver el estado
del import pasar por: **Subido → Parseando… → Revisar**.

Vas a ver el mensaje: *"Parseando con LLM en segundo plano… esto puede tardar hasta un par
de minutos."* Es normal, esperá.

### Si el PDF tiene contraseña

Algunos resúmenes (sobre todo de tarjeta) vienen protegidos. Si es el caso, la app no va a
poder leerlo solo y vas a ver un recuadro pidiéndola, con el botón **`Parsear con LLM`**:

```
┌──────────────────────────────────────────────────────┐
│  Contraseña de desencriptación (requerida para        │
│  desbloquear el PDF):                                  │
│  [ ••••••••                                    ]       │
│  ☐ Guardar contraseña para futuras importaciones      │
│                                                        │
│            [  Parsear con LLM  ]                       │
└──────────────────────────────────────────────────────┘
```

- Escribís la contraseña del PDF.
- Tildá **`Guardar contraseña para futuras importaciones`** para no tener que escribirla cada mes.
- Tocás **`Parsear con LLM`** y esperás.

> Cuando el estado pase a **Revisar**, ya está lista para que la mires.

---

## Paso 3 — Revisar las líneas (el paso importante)

Acá ves todo lo que la IA leyó del resumen. **Tu trabajo es confirmar que esté bien.**

```
┌─ Líneas extraídas · 42 ───────────────────────────────────────────────────┐
│  [ Pending 42 ] [ Aceptadas 0 ] [ Editadas 0 ] [ Rechazadas 0 ]           │
│                                                                            │
│  🔎 Buscar en descripción / contraparte…   [Recargar lista]               │
│  Categoría: (Todas) (Sin categorizar) (Categorizadas) (Transfers)         │
│  Tipo:      (Todos) (Gasto) (Ingreso)                                      │
│  Estado:    (Todos) (Pending) (Aceptadas) (Editadas) (Rechazadas)         │
│                                                                            │
│  ☐ | Fecha   | Descripción       | Tipo  | Monto   |Mon.| Categoría |Estado│
│  ──┼─────────┼───────────────────┼───────┼─────────┼────┼───────────┼──────│
│  ☐ | 03/01   | Coto Supermercado | Gasto | 45.200  |ARS │[Categoría▾]│Pend  │  → [✓] [✕] [Editar] [⇄ Transfer]
│  ☐ | 05/01   | Sueldo            |Ingreso| 800.000 |ARS │[Categoría▾]│Pend  │  → [✓] [✕] [Editar] [⇄ Transfer]
│  ☐ | 07/01   | Transf. a ICBC    | Gasto | 200.000 |ARS │  —         │Pend  │  → [✓] [✕] [Editar] [⇄ Transfer]
│  …                                                                         │
│                                                  ← Anterior  Página 1/1  Siguiente →
└────────────────────────────────────────────────────────────────────────────┘
```

### Las 3 acciones por línea

En la columna **Acciones** de cada fila:

- **`✓`** → **Aceptar** la línea tal como la leyó la IA.
- **`✕`** → **Rechazar** (no querés que se cargue: ej. un movimiento que no corresponde).
- **`Editar`** → abrir la línea para corregir algo (ver abajo).
- **`⇄ Transfer`** → marcar que esa línea es una **transferencia entre tus cuentas** (no un gasto ni un ingreso). Ej: "pasé plata de Galicia a ICBC".

> Una línea que ya quedó cargada de antes aparece como **`linkeada`** y no la tocás.

### Ponerle categoría (lo más común)

En la columna **Categoría** de cada línea hay un desplegable **`Categoría…`**. Lo abrís,
elegís (ej. *Supermercado*, *Sueldo*, *Salud*) y listo, sin abrir nada más.

> 🪄 **Magia útil:** cuando categorizás o etiquetás una línea, la app te ofrece con un toast
> aplicar lo mismo a las **líneas parecidas** (mismo comercio / misma contraparte). Si decís
> que sí, te ahorra repetir.

### Editar una línea (cuando algo está mal)

Tocás **`Editar`** y se despliega un formulario con: Fecha, Tipo (Gasto/Ingreso), Monto,
Moneda, Descripción, **Etiqueta de contraparte** (*"ej. Niñera, Alquiler…"*), Categoría, y
algunos extras:

- ☐ **devolución/reembolso** — si es una devolución.
- ☐ **Deducible Ganancias** — si ese gasto sirve para descontar de impuestos.
- ☐ **Servicio doméstico** — abre campos extra (Empleado, CUIL, etc.).
- **Tags** y link a una **previsión**, si querés.

> Para Galicia caja de ahorro / tarjeta, lo normal es solo **revisar el monto y poner la
> categoría**. El resto es opcional.

### Hacer muchas de una vez (barra azul)

Si tildás varias líneas con los ☐ de la izquierda, aparece abajo una **barra azul** para
aplicarles algo **en lote**:

```
┌─ (5 seleccionadas) ───────────────────────────────────────────────────────┐
│ Categoría [▾ Aplicar categoría]  Moneda [▾ Aplicar moneda]                 │
│ [Marcar transfer] [No es transfer]  Deducible [Marcar][Quitar]            │
│ Contraparte [▾ ……… Aplicar etiqueta]  [Volver a pendiente]                │
│ [Limpiar selección]                                                        │
└────────────────────────────────────────────────────────────────────────────┘
```

> 💡 **Truco recomendado:** usá los filtros de arriba para mostrar un grupo parecido
> (ej. filtrás "Sin categorizar" + buscás "Coto"), tildás todas con **`Seleccionar las N
> filtradas`**, y les ponés la categoría de una sola vez con **`Aplicar categoría`**.

### Atajos para terminar rápido

Arriba de la lista tenés acciones globales sobre lo que quede pendiente:

- **`Aceptar todas las pending`** → si ya revisaste y está todo bien, aceptás el resto de un saque.
- **`Rechazar todas las pending`**.
- **`↻ Re-sugerir pendientes`** → la IA vuelve a sugerir categorías usando lo que aprendió.

### Controlar que los números cierren

Abajo de todo hay un bloque **"Totales extraídos (excluye rechazadas)"** con Gastos /
Ingresos / Neto por moneda, y compara contra los subtotales que figuran en el PDF. Si algo
no cuadra, tenés el link **`Abrir PDF para verificar ↗`** para mirar el original.

> ✅ La regla simple: que el **Neto** de la app coincida con lo que dice tu resumen del banco.

---

## Paso 4 — Elegir la cuenta destino

Antes de confirmar, abajo hay un selector:

```
  Cuenta destino (común a todas las líneas)
  [ Galicia Caja de ahorro · Pau · ARS ▾ ]
```

La app intenta adivinarla (por el número de cuenta del resumen), pero **verificá que sea la
correcta**: todas las líneas de ese resumen se van a cargar en esa cuenta.

> Si subiste el resumen de la **tarjeta**, acá tiene que decir la **tarjeta**; si es la caja
> de ahorro, la caja de ahorro. Una cuenta por resumen.

---

## Paso 5 — Confirmar

Tocás el botón final **`Confirmar import (N)`** (N = cuántas líneas vas a cargar).

Cuando termina, ves un cartel verde:

```
✅ Import confirmado — 38 transacciones creadas
   [ Ver transacciones ]  [ Importados ]  [ Importar otro archivo ]
```

🎉 **Listo, esas transacciones ya están cargadas.** Tocás **`Importar otro archivo`** para
seguir con el próximo mes / la próxima cuenta.

---

## Caso especial: un mes sin movimientos

Si una cuenta **no tuvo ningún movimiento** en un mes (ej. una tarjeta que no usaste), no
hace falta subir nada: hay que **avisarle a la app** que ese mes fue vacío, así no te lo
marca como "te falta cargar".

En la pantalla **Imports**, si hay meses faltantes, aparece un bloque amarillo
**"Resúmenes faltantes"** con un chip por cada mes:

```
┌─ Resúmenes faltantes ──────────────────────────────────────┐
│  Galicia Master · Pau:  [ mar 2026 · sin mov. ]  Importar → │
│  Galicia Visa · Pau:    [ abr 2026 · sin mov. ]  Importar → │
└─────────────────────────────────────────────────────────────┘
```

- Si **ese mes sí tuvo movimientos** → tocás **`Importar →`** y subís el resumen (Paso 1).
- Si **ese mes fue vacío** → tocás **`sin mov.`** y queda marcado como "sin movimientos".
  El aviso desaparece.

> Esto mantiene la app prolija: en verde lo que está al día, sin huecos fantasma.

---

## Errores comunes / FAQ

**"Subí el PDF pero no aparecen las líneas."**
→ Mirá el estado: si dice *Parseando…*, esperá uno o dos minutos. Si dice *Revisar*, recargá.
Si el PDF tenía contraseña, fijate que el recuadro de contraseña no esté esperándote.

**"La IA puso mal una categoría / un monto."**
→ Para eso es la revisión. Corregilo con **`Editar`** o con el desplegable de categoría. La
idea es que vos tenés la última palabra, no la IA.

**"Hay una transferencia que figura como gasto."**
→ Marcala con **`⇄ Transfer`**. Las transferencias entre tus cuentas no cuentan como gasto
ni ingreso (es plata que se movió de un bolsillo a otro).

**"Subí dos veces el mismo resumen."**
→ La app detecta duplicados y te avisa. Podés rechazar el repetido o borrar el import de más.

**"¿Tengo que cargar todo de golpe?"**
→ No. Podés ir de a un mes. Lo importante es no dejar huecos: o cargás el resumen, o marcás
el mes como *sin mov.*

---

## Resumen en una línea

> **Bajá el PDF → Imports → `+ Subir extracto` → elegí Galicia → esperá que lea → revisá y
> categorizá → elegí la cuenta → `Confirmar import`.** Repetí por cada cuenta y cada mes.

¿Dudas? Avisale a Nico. 🙂
