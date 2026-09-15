export default function DataDeletion() {
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

        <h1 className="mb-2 text-2xl font-bold text-white">Eliminación de datos</h1>
        <p className="mb-8 text-sm">
          Aplicable a la aplicación de reporting de Media Power (el
          &quot;Dashboard&quot;), a través de la cual los clientes de Media
          Power conectan sus cuentas de Meta y Google para consultar los
          informes de rendimiento de sus propias campañas y canales
          digitales. Esta página explica cómo solicitar la eliminación de
          los datos asociados a tu cuenta.
        </p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Qué datos se pueden eliminar
            </h2>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-white">El token de acceso (OAuth):</strong>{' '}
                la credencial de solo lectura que el Dashboard obtiene cuando
                conectas tu cuenta de Meta o Google (por ejemplo, al pulsar
                &quot;Conectar con Facebook&quot;).
              </li>
              <li>
                <strong className="text-white">Las métricas sincronizadas:</strong>{' '}
                los datos de rendimiento (inversión, impresiones, clics,
                conversiones, publicaciones, seguidores, etc.) que el
                Dashboard ha copiado desde tus cuentas publicitarias o
                canales para mostrarlos en tu informe.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Cómo solicitar la eliminación
            </h2>
            <p className="mb-2">Tienes dos formas, y puedes usar una o ambas:</p>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                <strong className="text-white">Revocar el acceso desde Meta o Google:</strong>{' '}
                desde la configuración de tu cuenta de Facebook
                (Configuración → Aplicaciones y sitios web) o de tu Cuenta de
                Google (Seguridad → Aplicaciones de terceros con acceso a la
                cuenta), busca &quot;Dashboard reporting MP&quot; y revoca el
                acceso. Esto invalida inmediatamente el token y el Dashboard
                deja de poder sincronizar datos nuevos.
              </li>
              <li>
                <strong className="text-white">Solicitar el borrado completo:</strong>{' '}
                escribe a{' '}
                <a href="mailto:analytics@themediapower.com" className="text-accent">
                  analytics@themediapower.com
                </a>{' '}
                indicando el nombre de tu cuenta o empresa y qué conexión
                quieres eliminar (Meta Ads, Facebook, Instagram, Google Ads,
                Google Analytics, Search Console...). Eliminaremos el token
                de acceso guardado y las métricas sincronizadas asociadas a
                esa conexión en un plazo máximo de 30 días, y te
                confirmaremos por correo cuando se haya completado.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Qué ocurre después
            </h2>
            <p>
              Una vez eliminados el token y las métricas, el informe de esa
              conexión deja de estar disponible en el Dashboard hasta que se
              vuelva a conectar la cuenta. La eliminación no afecta a datos
              que residan en tus propias cuentas de Meta o Google — solo a la
              copia que el Dashboard había sincronizado.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">
              Contacto
            </h2>
            <p>
              PINTO INVESTMENTS S.L. (nombre comercial: Media Power), NIF/CIF
              B-88597224, Avenida del Brasil 17, 28020 Madrid. Para cualquier
              duda sobre esta página o sobre tus datos, escribe a{' '}
              <a href="mailto:analytics@themediapower.com" className="text-accent">
                analytics@themediapower.com
              </a>
              . También tienes derecho a presentar una reclamación ante la
              Agencia Española de Protección de Datos (AEPD).
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
