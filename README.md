# Presupuesto local

App local para **Paola** (marketing): ver el restante de un presupuesto **aprobado** en tiempo real, sin tocar Power BI y sin sacar datos del ordenador.

El aprobado vive hoy en Power BI. Esta app **no se conecta a Power BI**. Exportas un CSV, lo sueltas aquí, anotas el gasto en este navegador y el restante se actualiza al momento.

## Tres reglas

1. **No inventar cifras.** Solo existen los números del CSV aprobado y del registro local de gasto. Si un número no está ahí, la lectura dice que no lo sabe.
2. **No cambiar el presupuesto aprobado.** El CSV es de solo lectura. Puedes anotar gasto o cargar otra exportación; no puedes editar una partida aprobada.
3. **Nada sale de este ordenador.** Sin nube, sin sincronizar, sin API cerrada. Gemma, si la usas, habla solo con Ollama en `127.0.0.1`.

## Qué hace

- Importa un CSV local del presupuesto aprobado.
- Anota gasto solo contra partidas que ya existen en ese CSV.
- Recalcula restante y desvío al momento.
- Ofrece una lectura con **Gemma** (`gemma3:1b` vía Ollama) anclada a esas cifras. Si Ollama no está, el presupuesto y el gasto siguen funcionando.

## Requisitos

- Node.js 20 o superior
- npm

Opcional, solo para la lectura con Gemma:

- [Ollama](https://ollama.com)
- el modelo `gemma3:1b`

## Arrancar en un portátil

```bash
npm install
npm test
npm run dev
```

Abre [http://127.0.0.1:43127](http://127.0.0.1:43127).

1. Pulsa **Cargar CSV de ejemplo** o suelta tu exportación de Power BI.
2. El banner **DATOS DE EJEMPLO** aparece solo con la muestra. No es el presupuesto real de Paola.
3. Anota un gasto y mira cómo cambia el restante.
4. Si quieres la lectura, instala Gemma (abajo) y pulsa **Leer las cifras locales**.

El gasto queda en `localStorage` de este navegador. No se envía a ningún servidor remoto.

## Formato del CSV

Cabecera esperada (Power BI → CSV):

```csv
origen,categoria,partida,presupuesto_aprobado
DATOS DE EJEMPLO,Publicidad digital,Google Ads,5000
```

- Separador `,` o `;`
- Decimales con `.` o con `,` (también `1.200,50`)
- Columnas mínimas: `categoria`, `partida`, `presupuesto_aprobado`
- `origen` es opcional. Si dice `DATOS DE EJEMPLO`, la app lo etiqueta así.
- Las líneas que empiezan por `#` se ignoran.

Hay una muestra en [`public/sample-presupuesto.csv`](public/sample-presupuesto.csv). Está marcada como **DATOS DE EJEMPLO**. No inventa el presupuesto real de Paola.

## Gemma (opcional)

La lectura no es un adorno: es el modelo el que resume qué está desbordado, qué queda y qué mirar ahora. El código ancla la respuesta a las cifras locales y descarta cualquier número que no esté en el CSV o en el log.

Esta máquina puede no tener Ollama. En ese caso verás un aviso real, no una transcripción inventada.

```bash
# 1. Instala Ollama desde https://ollama.com
# 2. Descarga el modelo abierto
ollama pull gemma3:1b
# 3. Deja Ollama en marcha (suele escuchar en 127.0.0.1:11434)
# 4. Recarga la app y pulsa «Leer las cifras locales»
```

Si el navegador no puede hablar con Ollama, arranca Ollama permitiendo el origen local:

```bash
OLLAMA_ORIGINS=http://127.0.0.1:43127 ollama serve
```

La app llama a `http://127.0.0.1:11434` desde este mismo ordenador. No hay clave de API cerrada ni llamada a la nube.

## Tests (sin modelo)

```bash
npm test
```

Cubren:

- restante = aprobado − gastado (por partida y total)
- el aprobado no cambia al anotar o borrar gasto
- no se aceptan partidas inventadas
- un texto con cifras que no están en el CSV/log se rechaza

## Scripts

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo en el puerto 43127 |
| `npm test` | Tests del camino sin modelo |
| `npm run build` | Build de producción |
| `npm start` | Servidor de producción en el puerto 43127 |

## Privacidad

No hay cuenta, no hay base de datos remota, no hay telemetría. Si cierras el navegador, los datos siguen en este perfil hasta que pulses **Borrar datos locales**.
