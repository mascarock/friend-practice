# Presupuesto local

Para Paola · marketing

El aprobado está en Power BI. El restante tiene que estar en su ordenador.

---

# El problema

Paola aprueba un presupuesto en Power BI.

El gasto ocurre en campañas, ferias y facturas.

Hoy no tiene un control en tiempo real que respete tres cosas: no inventar, no reescribir el aprobado, no sacar datos.

Esta app no se conecta a Power BI. Ella exporta.

---

# El bucle local

1. Exportar el CSV del presupuesto aprobado.
2. Soltarlo en la app (solo lectura).
3. Anotar el gasto en este navegador.
4. Ver restante y desvío al momento.
5. Pedir a Gemma (si está en local) que lea esas cifras: qué se pasa, qué queda, qué mirar ahora.

Nada se sincroniza. Nada viaja a una API cerrada.

---

# Las tres reglas

1. **Nunca inventar cifras.** Solo el CSV y el registro de gasto. Si no está, “no lo sé”.
2. **Nunca cambiar el aprobado.** El gasto se suma. El aprobado no se edita.
3. **Nunca sacar nada del ordenador.** LocalStorage + Ollama en localhost.

Los DATOS DE EJEMPLO están etiquetados. No son el presupuesto real de Paola.
