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
    layout/    Sidebar, TopBar, Layout
    shared/    KpiCard, ChartCard, DataTable, PlatformBadge, StatusBadge,
               Tabs, Toggle, ChartTooltip, AsyncState (Loading/ErrorState)
  pages/       Overview, PaidMedia, Seo, Social, Settings
  data/        mockData.ts  (datos ficticios, tipados)
  lib/         utils.ts (formatters ES), reportConfig.tsx, useAsyncData.ts
  services/    capa de datos conmutable (mock ↔ real)
```

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
> 1. Duplicar este proyecto y su propio deployment en Vercel (compartiendo el
>    mismo Supabase/n8n si gestionas varios clientes desde la misma agencia).
> 2. Definir en Vercel las variables `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
>    `DASHBOARD_CLIENT_ID` (el uuid de su cliente en la tabla `clients`) y
>    `VITE_DATA_MODE=live`.
> 3. Ir a **Configuración → Google Ads**, pegar el Customer ID de su cliente y
>    pulsar "Guardar" — esto llama a `/api/data-sources`, que lo escribe en
>    Supabase. El developer token, el Client ID/Secret de OAuth y el acceso vía
>    MCC son compartidos y ya están configurados en n8n; el PM nunca los toca.
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
