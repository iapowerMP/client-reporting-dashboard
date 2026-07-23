export default function PrivacyPolicy() {
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

        <h1 className="mb-2 text-2xl font-bold text-white">Política de privacidad</h1>
        <p className="mb-8 text-sm">
          Aplicable a la aplicación de reporting de Media Power (el
          &quot;Dashboard&quot;), a través de la cual los clientes de Media
          Power consultan los informes de rendimiento de sus propias campañas
          y canales digitales.
        </p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Responsable del tratamiento
            </h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Identidad del responsable: PINTO INVESTMENTS S.L.</li>
              <li>Nombre comercial: Media Power</li>
              <li>NIF/CIF: B-88597224</li>
              <li>Dirección: Avenida del Brasil 17, 28020 Madrid. Oficina 5º A-B</li>
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
              Qué es el Dashboard y quién lo usa
            </h2>
            <p>
              El Dashboard es una herramienta de uso interno y para clientes de
              Media Power que centraliza, en un único informe por cliente, las
              métricas de rendimiento de sus campañas de publicidad digital
              (Meta Ads, Google Ads, TikTok Ads), su posicionamiento SEO
              (Google Analytics 4, Google Search Console) y sus redes
              sociales. Solo acceden a él el equipo de Media Power y las
              personas del cliente autorizadas por este.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Qué datos tratamos y con qué finalidad
            </h2>
            <p className="mb-2">
              El Dashboard no recopila datos personales de visitantes ni
              utiliza formularios de captación. Los únicos datos que trata
              son:
            </p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-white">Datos de rendimiento publicitario:</strong>{' '}
                métricas agregadas de las cuentas publicitarias del cliente
                (inversión, impresiones, clics, conversiones, ingresos,
                nombre e identificador de campañas y anuncios, y miniaturas de
                los creativos), obtenidas mediante las APIs de Meta Graph API
                y Google Ads API. Estos datos pertenecen a las cuentas
                publicitarias del propio cliente y se muestran únicamente en
                su informe.
              </li>
              <li>
                <strong className="text-white">Datos de tráfico web y SEO:</strong>{' '}
                métricas agregadas de Google Analytics 4 y Google Search
                Console (sesiones, usuarios, consultas de búsqueda,
                posiciones), asociadas a la propiedad web del cliente.
              </li>
              <li>
                <strong className="text-white">Credenciales de conexión (OAuth):</strong>{' '}
                cuando un cliente pulsa &quot;Conectar con Facebook&quot; o
                &quot;Conectar con Google&quot;, se solicita su consentimiento
                para obtener un token de acceso de solo lectura (permisos
                como <code>ads_read</code> para Meta Ads) limitado a las
                cuentas publicitarias o propiedades que esa persona ya
                administra. Este token se usa exclusivamente para leer las
                métricas descritas arriba; el Dashboard nunca publica,
                modifica ni elimina contenido en nombre del usuario.
              </li>
              <li>
                <strong className="text-white">Datos de la cuenta de acceso al Dashboard:</strong>{' '}
                nombre y correo electrónico de las personas del equipo de
                Media Power o del cliente con acceso al informe.
              </li>
            </ul>
            <p className="mt-2">
              La finalidad única de este tratamiento es generar y mostrar al
              cliente los informes de rendimiento de sus propios canales
              digitales, en el marco de la relación de servicios de marketing
              contratada con Media Power.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Base legal
            </h2>
            <p>
              El tratamiento se basa en la ejecución del contrato de
              servicios de marketing suscrito entre el cliente y Media Power,
              y, en el caso de las conexiones mediante inicio de sesión
              (OAuth), en el consentimiento explícito otorgado por la persona
              usuaria al autorizar el acceso de solo lectura a sus cuentas
              publicitarias o propiedades analíticas.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Destinatarios y encargados del tratamiento
            </h2>
            <p className="mb-2">
              Para prestar el servicio, el Dashboard comparte datos con los
              siguientes proveedores, bajo sus correspondientes condiciones de
              privacidad:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong className="text-white">Meta Platforms, Inc.</strong> — origen de
                los datos de Meta Ads (Graph API).
              </li>
              <li>
                <strong className="text-white">Google LLC</strong> — origen de los datos
                de Google Ads, Google Analytics 4 y Google Search Console.
              </li>
              <li>
                <strong className="text-white">Supabase</strong> — base de datos donde se
                almacenan las métricas agregadas.
              </li>
              <li>
                <strong className="text-white">Vercel Inc.</strong> — hosting de la
                aplicación web.
              </li>
              <li>
                <strong className="text-white">n8n</strong> (instancia propia de Media
                Power) — automatización de la sincronización periódica de
                datos desde las APIs anteriores hacia la base de datos.
              </li>
            </ul>
            <p className="mt-2">
              Media Power no vende, alquila ni cede estos datos a terceros
              ajenos a la prestación del servicio.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Plazo de conservación
            </h2>
            <p>
              Los datos se conservan mientras dure la relación de servicios
              con el cliente. Una vez finalizada, se eliminan en un plazo
              razonable salvo obligación legal de conservarlos.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Tus derechos
            </h2>
            <p>
              Cualquier persona interesada tiene derecho a solicitar el
              acceso, rectificación, supresión, limitación del tratamiento,
              oposición y portabilidad de sus datos, así como a revocar en
              cualquier momento el consentimiento otorgado a través de las
              conexiones OAuth (revocando el acceso desde la configuración de
              su cuenta de Meta o Google, o solicitándolo a Media Power).
              Puedes ejercer estos derechos escribiendo a{' '}
              <a href="mailto:analytics@themediapower.com" className="text-accent">
                analytics@themediapower.com
              </a>
              . También tienes derecho a presentar una reclamación ante la
              Agencia Española de Protección de Datos (AEPD).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Seguridad
            </h2>
            <p>
              El acceso al Dashboard viaja cifrado (SSL/TLS). Los tokens de
              acceso obtenidos mediante OAuth se almacenan de forma segura y
              solo se usan desde los servidores de Media Power para las
              llamadas de solo lectura descritas en esta política.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Cambios en esta política
            </h2>
            <p>
              Media Power podrá actualizar esta política para adaptarla a
              cambios legislativos o del propio servicio. Cualquier cambio
              relevante se reflejará en esta misma página.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
