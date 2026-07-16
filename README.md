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
  data/        catalog.ts  (tipos, catálogos de pestañas/plataformas, sin datos inventados)
  lib/         utils.ts (formatters ES), reportConfig.tsx, useAsyncData.ts
  services/    capa de datos tipada (llama a /api/*)
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

## Capa de datos

Todas las vistas leen los datos a través de una **capa de servicios tipada** en
`src/services`, en lugar de importar datos directamente. Todo es real, vía
Supabase (alimentado por n8n) — no existe ningún modo con datos inventados.

- `types.ts` — interfaces de los "bundles" que consume cada vista y el contrato
  `DataProvider` (métodos asíncronos, porque los datos llegan por red).
- `liveProvider.ts` — llama a los endpoints server-side bajo `/api/*`.
- `index.ts` — `getProvider()` devuelve ese proveedor.

Los endpoints (`/api/overview`, `/api/paid`, `/api/seo`, `/api/social`)
consultan Supabase **desde el servidor** (nunca desde el navegador) y
devuelven un JSON con la forma definida en `services/types.ts`. Las partes
sin integración real todavía (Redes Sociales; Search Console y Semrush
dentro de SEO) devuelven un estado vacío honesto en vez de cifras
inventadas, hasta que se construyan.

### Credenciales por cliente

Las fuentes de datos se gestionan desde la vista **Configuración**, cada una en
su tarjeta (Meta Ads, Google Ads, GA4, Search Console, etc.). El objetivo es que
cada copia del proyecto introduzca ahí los identificadores y credenciales de su
cliente y el dashboard muestre sus datos reales. Los secretos (tokens/API keys)
deben resolverse en el servidor; nunca se exponen en el navegador.

> Estado actual: las tarjetas de Configuración ya existen y permiten activar o
> desactivar cada fuente en el informe. Cada integración real sigue el mismo
> patrón: tabla propia en Supabase + workflow de n8n dinámico (multi-cliente,
> sin tocar n8n al añadir un cliente) + su propio endpoint `/api/*`.
>
> - **Google Ads** — modo API: el PM pega el Customer ID de su cliente en
>   Configuración; el acceso vía MCC y las credenciales OAuth son
>   compartidas y ya están configuradas en n8n.
> - **Meta Ads** — admite dos modos, coexistentes en Configuración: API
>   (Ad Account ID + System User compartido de nuestro Business Manager) o
>   inicio de sesión con Facebook (el PM/cliente conecta cualquier cuenta que
>   administre, sin depender de nuestro BM).
> - **GA4** — solo por inicio de sesión con Google: el PM/cliente conecta la
>   propiedad GA4 que administre.
> - El resto (TikTok Ads, Search Console, Semrush, Instagram, Facebook,
>   TikTok, YouTube) todavía no tiene integración real; sus vistas muestran
>   un estado vacío honesto en vez de datos inventados.

## Visibilidad de fuentes

En **Configuración**, cada conexión tiene un interruptor _"Mostrar en el
informe"_ que controla si esa plataforma aparece como pestaña en Paid Media, SEO
y Redes Sociales, y si entra en los KPIs agregados. La preferencia se guarda en
`localStorage`.

## Formato numérico

Formato español: punto para miles y coma para decimales (`1.284.930`, `2,22%`,
`4,21x`). Ver `src/lib/utils.ts`.
