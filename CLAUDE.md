# App de armario virtual

App móvil que responde "¿qué me pongo hoy?". El usuario fotografía su ropa (o la elige de una
lista de básicos), la IA la cataloga y la app propone un outfit diario armado solo con prendas
que ya tiene. Sin compras ni e-commerce. Momento de uso: 7am, medio dormido, con una mano, 30
segundos. Público unisex, hispanohablante. Lo más difícil es el onboarding: subir ropa nunca
debe sentirse como llenar formularios.

## Contexto del proyecto
La memoria, el estado y las decisiones de esta app están en el repo privado `asmq-labs/asmq-ops`,
carpeta `app-outfit/`. Si tu memoria está vacía (computador nuevo), pide al usuario clonar `asmq-ops`
en `Desarrollo aplicaciones/` y sigue su `RECUPERACION.md` para configurar este equipo.

## Stack
Monorepo: `backend/` (API y worker), `mobile/` (app), `docker-compose.yml` (entorno local) e
`image_spike/` (pruebas de modelos de imagen).

- **Móvil:** React Native + Expo (SDK 58) con TypeScript, Expo Router, NativeWind, React Native
  Reusables (`components/ui/`), TanStack Query + Zustand. Se prueba en Android con Expo Go; iOS
  se compila con EAS al final.
- **Backend:** Python + FastAPI, PostgreSQL en Docker Compose, SQLAlchemy + Alembic, uv.
- **Auth propia:** el móvil obtiene el ID token de Google/Apple, FastAPI lo verifica y emite un
  access JWT corto + refresh token rotativo. Header `Authorization`, sin cookies. Sin registro
  obligatorio: se crea una cuenta de invitado que luego se vincula.
- **Storage:** disco local, una carpeta por usuario, detrás de `app/storage.py`. La base guarda
  solo rutas relativas. Siempre se guarda la foto original.
- **Trabajo pesado:** cola durable en Postgres + proceso `worker`. Nunca `BackgroundTasks` ni
  nada bloqueante en los endpoints.
- **IA:** OpenRouter, solo a través de `app/ai/` (`analizar_prenda`, `recrear_prenda`,
  `sugerir_outfits`, `extraer_estilo`, `crear_basico`). Los modelos son configuración. Prompts en
  inglés. Imagen de catálogo: `bytedance-seed/seedream-5-0-flash` (~$0.018 por imagen).
- **Básicos:** 15 formas generadas una vez en gris (`backend/app/garments/basic_images/`) y
  recoloreadas en código. Regenerar faltantes (cuesta): `uv run python -m app.garments.basics`.

## Comandos
Desde la raíz, con Docker Desktop abierto:
```
docker compose up -d --build        # API en :8000 (aplica migraciones al arrancar), worker y db
```
Backend (`cd backend`):
```
uv sync
uv run pytest                       # necesita el contenedor db; crea su propia base outfit_test
uv run ruff check . && uv run ruff format --check .
uv run alembic revision --autogenerate -m "..."
```
Móvil (`cd mobile`):
```
npm install
npx expo start                      # abrir con Expo Go; la URL de la API sale del host de Metro
npx tsc --noEmit
npx prettier --check app components lib
CI=1 npx expo export --platform android --output-dir <carpeta temporal>   # prueba de build
```

## Convenciones
- Excepción a las preferencias generales: aquí todo el código, nombres y comentarios van en
  inglés; solo los textos de UI van en español (neutro latinoamericano, tuteo).
- En las URLs de base de datos usar `127.0.0.1`, nunca `localhost` (se cuelga en este Windows).
- Expo Router y NativeWind modernos. Prohibido `StyleSheet.create`, class components y configurar
  React Navigation a mano. Nada de patrones web (hover, CSS grid, cascada). Todo texto en `<Text>`.
- `components/ui/` queda como lo genera Reusables (está en `.prettierignore`); se ajusta con
  `className` donde se usa o con envoltorios en `components/app/` (`button.tsx`, `input.tsx`).
  Única excepción: `font-sans` en `components/ui/text.tsx`.
- Tipografía: Hanken Grotesk (interfaz) y Newsreader (títulos, frase del outfit). Cada peso es
  una familia (`font-sans-medium`, `font-serif-italic`...); nunca `font-medium`/`font-bold`.
- Colores siempre desde los tokens del tema, nunca hex en pantallas (los colores de prendas son
  datos y sí van en línea).
- UX: botones píldora de 48 dp, hojas inferiores en vez de menús desplegables, transiciones
  simétricas sin rebote, vibraciones suaves. Respaldar decisiones con Material 3, Apple HIG o NN/g.
  Confirmaciones con `askToConfirm` (hoja inferior), nunca `Alert`. Animar con intención: las
  pantallas rutinarias solo aparecen; la revelación del collage se reserva para Hoy.
- El móvil solo habla con FastAPI por HTTP/JSON, nunca con proveedores de IA.
- Tests en cada cambio del backend; commit y push al terminar cada paso.

## Decisiones de producto (no proponer alternativas)
- Hoy abre con el outfit ya generado (el del día y sus alternativas se pregeneran de madrugada).
  Un outfit a la vez, grande, con un botón discreto de "otra".
- Composición: base obligatoria (arriba + abajo, o pieza entera), capa opcional según el clima,
  zapatos obligatorios, un accesorio opcional. Fuera: joyería, cinturones, medias, ropa interior.
- Se dibuja como collage con zonas fijas. En modo oscuro el lienzo del collage sigue claro.
- Dos pasos: el código filtra candidatos (clima, ocasión, usado hace poco) y el LLM elige y
  escribe una explicación breve. Ocasión por chips, preseleccionada según día y hora. La hoja de
  pedido (`/outfit-request`) añade ocasión e indicaciones opcionales en lenguaje natural, desde Hoy
  o desde una prenda, y "Tu estilo" guarda gustos en texto libre: orientan al LLM, nunca cambian
  las reglas del código. Sin preguntas ni género obligatorios al empezar.
- Armar a mano y cambiar una prenda usan la misma pantalla (`/outfit/new`). Tocar una pieza en Hoy
  la cambia; en el resto de la app abre la prenda. Cambiar no llama al LLM.
- Opiniones: pulgar arriba o abajo con motivos opcionales, después de usarlo (y a la mañana
  siguiente) o con el pulgar abajo sobre una sugerencia. Orientan al LLM; el código nunca repite una
  combinación rechazada mientras exista otra. El corazón es otra cosa: guardar.
- Personalización en capas (`app/outfits/taste.py`): cada acción se anota en `taste_signals`; cada
  prenda llega al LLM con su historial para esa persona, y las etiquetas (`app/garments/tags.py`,
  vocabulario cerrado) en las que coinciden varias prendas se vuelven preferencias aprendidas.
  Clustering y embeddings se montan después sobre estos mismos datos.
- Ocasión Deporte: usa prendas de formalidad `sport`. Zapatos y chaquetas deportivos también
  sirven en Casual; el resto de la ropa deportiva, no.
- "Me lo pongo" registra lo usado y evita repetir con un descanso según el tipo de prenda. Sin
  lavandería. Abrigo por niveles (ligero, medio, abrigado), no por temporada.
- Login solo con Google y Apple. Modo claro y oscuro según el sistema.
- Fuera de alcance: comunidad, anuncios, estadísticas, importar de tiendas. Probador virtual,
  análisis de color, embeddings y viajes son a futuro (ver `asmq-ops/app-outfit/producto.md`).
