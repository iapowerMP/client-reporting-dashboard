# Media Power · Reporting Dashboard

Dashboard de reporting de marketing digital (Paid Media, SEO y Redes Sociales)
construido con **Vite + React 18 + TypeScript + Tailwind CSS 3**, Recharts,
React Router v6 y Lucide.

## Scripts

```bash
npm install      # instalar dependencias
npm run dev      # servidor de desarrollo
npm run build    # build de producción (type-check + vite build)
npm run preview  # previsualizar el build
```

## Estructura

```
src/
  components/
    layout/    Sidebar, TopBar, Layout, ClientLayout
    shared/    KpiCard, ChartCard, DataTable, PlatformBadge, StatusBadge,
               Tabs, Toggle, ChartTooltip, AsyncState (Loading/ErrorState)
  pages/       ClientPicker, Overview, PaidMedia, Seo, Social, Settings
  data/        mockData.ts  (datos ficticios, tipados)
  lib/         utils.ts (formatters ES), reportConfig.tsx, useAsyncData.ts
  services/    capa de datos conmutable (mock ↔ real)
api/           Vercel Functions: clients, data-sources, paid, overview...
```

## Multi-cliente: un deployment, muchos informes

El dashboard es **multi-cliente en un único deployment**: no hace falta
duplicar el proyecto en Vercel para cada cliente. Cada cliente tiene su
propio informe en una URL fija, `/c/<slug>/...` (p. ej. `/c/acme-corp/paid`),
que un project manager puede guardar en favoritos y usar siempre sin volver a
configurar nada — el identificador va en la URL, no en variables de entorno,
así que dos personas pueden trabajar en clientes distintos a la vez sin
pisarse.

- **`/`** — pantalla para elegir un cliente existente o crear uno nuevo
  (`ClientPicker`, vía `/api/clients`). Al crear un cliente se genera un
  `slug` único a partir de su nombre y se navega directamente a su informe.
- **`/c/:clientSlug/*`** — el dashboard de ese cliente (Overview, Paid Media,
  SEO, Redes Sociales, Configuración). El slug se resuelve en cada endpoint
  `/api/*` contra la tabla `clients` de Supabase.
- La preferencia de visibilidad de fuentes (`localStorage`) se guarda por
  cliente, para que no se mezclen las de uno con las de otro en el mismo
  navegador.

## Capa de datos (mock ↔ real)

Todas las vistas leen los datos a través de una **capa de servicios tipada** en
`src/services`, en lugar de importar los datos directamente. Así, pasar de datos
ficticios a datos reales no obliga a tocar las vistas.

- `types.ts` — interfaces de los "bundles" que consume cada vista y el contrato
  `DataProvider` (métodos asíncronos, porque los datos reales llegan por red).
- `mockProvider.ts` — devuelve los datos de `data/mockData.ts`.
- `liveProvider.ts` — llama a endpoints server-side bajo `/api/*`.
- `index.ts` — `getProvider()` elige el proveedor según `VITE_DATA_MODE`.

### Cambiar a datos reales

1. Definir la variable de entorno en Vercel (Project → Settings → Environment
   Variables):

   ```
   VITE_DATA_MODE=live
   ```

2. Implementar los endpoints server-side (Vercel Functions) en `/api`:
   `/api/overview`, `/api/paid`, `/api/seo`, `/api/social`, `/api/settings`.
   Cada uno consulta la API de la plataforma correspondiente **desde el
   servidor** (nunca desde el navegador) usando las credenciales del cliente, y
   devuelve un JSON con la forma definida en `services/types.ts`.

Mientras un endpoint no exista, esa vista mostrará un estado de error claro.
El modo por defecto es `mock`, por lo que el dashboard funciona sin configurar
nada.

### Credenciales por cliente

Las fuentes de datos se gestionan desde la vista **Configuración**, cada una en
su tarjeta (Meta Ads, Google Ads, GA4, Search Console, etc.). El objetivo es que
cada copia del proyecto introduzca ahí los identificadores y credenciales de su
cliente y el dashboard muestre sus datos reales. Los secretos (tokens/API keys)
deben resolverse en el servidor; nunca se exponen en el navegador.

> Estado actual: las tarjetas de Configuración ya existen y permiten activar o
> desactivar cada fuente en el informe. La persistencia segura de credenciales y
> las integraciones reales por plataforma se irán añadiendo una a una.
>
> **Google Ads** ya está integrado de extremo a extremo, y de forma
> **multi-cliente**: el workflow de n8n (`n8n/google-ads-ingest.workflow.ts`)
> lee en cada ejecución qué clientes tienen un Customer ID guardado en la
> tabla `data_sources` y hace ingesta para todos ellos, sin que haya que
> tocar n8n al añadir un cliente nuevo. Un project manager solo necesita:
>
> 1. Ir a `/` y crear el cliente (o pedir que se lo creen) — obtiene su URL
>    fija `/c/<slug>`.
> 2. Ir a **`/c/<slug>/settings` → Google Ads**, pegar el Customer ID de su
>    cliente y pulsar "Guardar" — esto llama a `/api/data-sources`, que lo
>    escribe en Supabase. El developer token, el Client ID/Secret de OAuth y
>    el acceso vía MCC son compartidos y ya están configurados en n8n; el PM
>    nunca los toca, ni toca Vercel.
>
> Meta Ads y TikTok Ads seguirán el mismo patrón (tabla propia + workflow de
> n8n dinámico + endpoint `/api/*`) en cuanto tengan credenciales.

## Visibilidad de fuentes

En **Configuración**, cada conexión tiene un interruptor _"Mostrar en el
informe"_ que controla si esa plataforma aparece como pestaña en Paid Media, SEO
y Redes Sociales, y si entra en los KPIs agregados. La preferencia se guarda en
`localStorage`.

## Formato numérico

Formato español: punto para miles y coma para decimales (`1.284.930`, `2,22%`,
`4,21x`). Ver `src/lib/utils.ts`.
