# Paola no necesita otro dashboard: necesita el restante, aquí y ahora

**Tags:** #devchallenge #weekendchallenge #hf26challenge

Este es un borrador para un post de fin de semana en DEV (Hacktoberfest). **No está publicado.**

---

Paola trabaja en marketing. El presupuesto **aprobado** vive en Power BI. El gasto, no. Entre un informe que se refresca cuando alguien puede y la tarjeta que acaba de pasar hay un hueco: no sabe, en este momento, qué queda y qué se ha pasado.

La regla de negocio no es “otro conector a Power BI”. Es la contraria:

1. Nunca inventar cifras.
2. Nunca cambiar el presupuesto aprobado.
3. Nunca sacar nada de su ordenador.

Así que construí **Presupuesto local**: una app web que corre en el portátil. Paola exporta el CSV del aprobado desde Power BI, lo suelta en la página, anota el gasto en el navegador y el restante se actualiza al momento. No hay sync. No hay API cerrada. No hay cuenta.

El CSV de demostración está etiquetado como **DATOS DE EJEMPLO**. No es el presupuesto real de Paola. No voy a inventar sus partidas, ni una cita, ni un testimonial.

## El bucle

Exportar en Power BI → soltar el CSV → anotar un gasto contra una partida que ya existe → ver restante y desvío.

Si intentas gastar en una partida que no vino en el export, la app lo rechaza. Si anotas o borras gasto, el aprobado no se mueve. Eso está cubierto con tests, sin modelo.

## Dónde entra Gemma

La lectura (“qué está desbordado, qué queda, qué mirar ahora”) la hace **Gemma 3 1B**, el peso abierto de Google, a través de **Ollama** en `127.0.0.1`. El prompt solo recibe las cifras del CSV y del registro local. Si el modelo menciona un número que no está ahí, la app no lo muestra: dice que no lo sabe.

Eso no es un widget. Es el producto leyendo las cifras que Paola ya tiene.

Gemma es categoría destacada **solo si de verdad corrió en esa máquina**. Si Ollama no estaba, el post no debe fingir una sesión.

### Sesión local real (pegar aquí solo si `gemma3:1b` contestó en este ordenador)

```
(pega aquí la pregunta, el recorte de DATOS LOCALES y la respuesta real de Gemma)
```

En el entorno donde se escribió este borrador, Ollama no se dio por disponible. El presupuesto, el gasto y los tests sí corrieron. No hay transcripción inventada.

## Cómo probarlo

```bash
npm install
npm test
npm run dev
```

Luego, si quieres la lectura:

```bash
ollama pull gemma3:1b
```

Repo local, puerto `43127`, todo en el navegador de Paola.

---

*Borrador. No publicar en DEV desde este flujo.*
