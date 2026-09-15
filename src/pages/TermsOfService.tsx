export default function TermsOfService() {
  return (
    <div className="min-h-screen bg-base px-4 py-12 text-text-secondary">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-control bg-accent">
            <span className="text-sm font-extrabold text-black">M</span>
          </span>
          <span className="text-lg font-extrabold tracking-tight text-white">
            MEDIA POWER
          </span>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-white">Condiciones del servicio</h1>
        <p className="mb-8 text-sm">
          Aplicable a la aplicación de reporting de Media Power (el
          &quot;Dashboard&quot;), a través de la cual los clientes de Media
          Power consultan los informes de rendimiento de sus propias campañas
          y canales digitales. El uso del Dashboard implica la aceptación de
          estas condiciones.
        </p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Quién presta el servicio
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>PINTO INVESTMENTS S.L. (nombre comercial: Media Power)</li>
              <li>NIF/CIF: B-88597224</li>
              <li>Dirección: Avenida del Brasil 17, 28020 Madrid</li>
              <li>
                Correo electrónico:{' '}
                <a href="mailto:analytics@themediapower.com" className="text-accent">
                  analytics@themediapower.com
                </a>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Objeto del servicio
            </h2>
            <p>
              El Dashboard es una herramienta de reporting que centraliza, en
              un único informe por cliente, las métricas de rendimiento de
              sus campañas de publicidad digital (Meta Ads, Google Ads,
              TikTok Ads), su posicionamiento SEO (Google Analytics 4, Google
              Search Console) y sus redes sociales (Facebook, Instagram,
              TikTok, YouTube), en el marco de la relación de servicios de
              marketing contratada con Media Power.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Acceso y cuentas
            </h2>
            <p>
              El acceso al Dashboard está reservado al equipo de Media Power
              y a las personas del cliente autorizadas por este. Algunos
              informes están protegidos con contraseña; la persona usuaria es
              responsable de mantener en secreto sus credenciales de acceso y
              de cualquier uso que se haga con ellas.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Conexión de cuentas de terceros (Meta, Google)
            </h2>
            <p>
              Para mostrar datos reales, el Dashboard permite conectar
              voluntariamente cuentas publicitarias o canales del cliente
              (Meta Ads, Facebook, Instagram, Google Ads, Google Analytics 4,
              Google Search Console) mediante inicio de sesión OAuth. Solo se
              solicita acceso de solo lectura sobre las cuentas que la
              persona que conecta ya administra; el Dashboard nunca publica,
              modifica ni elimina contenido en nombre del usuario. El acceso
              puede revocarse en cualquier momento desde la configuración de
              la cuenta de Meta o Google correspondiente — ver{' '}
              <a href="/eliminacion-datos" className="text-accent">
                Eliminación de datos
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Uso permitido
            </h2>
            <p>
              El Dashboard debe usarse únicamente para consultar los propios
              informes de rendimiento. No está permitido intentar acceder a
              datos de otros clientes, realizar ingeniería inversa,
              scraping automatizado del servicio, ni ceder el acceso a
              terceros no autorizados por el cliente o por Media Power.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Propiedad intelectual
            </h2>
            <p>
              El software, diseño y marca del Dashboard son propiedad de
              Media Power. Los datos de rendimiento mostrados (campañas,
              métricas, publicaciones) pertenecen al cliente titular de las
              cuentas conectadas; Media Power los trata únicamente para
              generar y mostrar el informe.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Disponibilidad del servicio
            </h2>
            <p>
              Media Power hace un esfuerzo razonable por mantener el
              Dashboard disponible, pero no garantiza un funcionamiento
              ininterrumpido: puede haber pausas por mantenimiento,
              actualizaciones, o por indisponibilidad de las APIs de terceros
              (Meta, Google, TikTok) de las que dependen los datos mostrados.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Limitación de responsabilidad
            </h2>
            <p>
              Los datos del Dashboard proceden de plataformas de terceros
              (Meta, Google, TikTok); Media Power no es responsable de
              errores, retrasos o cambios en esas plataformas que afecten a
              la exactitud o disponibilidad de los datos mostrados. Media
              Power no será responsable de daños indirectos derivados del uso
              del Dashboard, salvo en los casos en que la ley aplicable no
              permita limitar dicha responsabilidad.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Protección de datos
            </h2>
            <p>
              El tratamiento de datos personales se rige por la{' '}
              <a href="/politica-privacidad" className="text-accent">
                Política de privacidad
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Terminación del acceso
            </h2>
            <p>
              Media Power podrá suspender o cancelar el acceso al Dashboard
              en caso de incumplimiento de estas condiciones o al finalizar
              la relación de servicios con el cliente.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Modificaciones
            </h2>
            <p>
              Media Power podrá actualizar estas condiciones para adaptarlas
              a cambios legislativos o del propio servicio. Cualquier cambio
              relevante se reflejará en esta misma página.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Ley aplicable y jurisdicción
            </h2>
            <p>
              Estas condiciones se rigen por la legislación española. Para
              cualquier controversia relacionada con el uso del Dashboard,
              las partes se someten a los Juzgados y Tribunales de Madrid,
              salvo que la normativa de consumidores establezca un fuero
              distinto de carácter imperativo.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
