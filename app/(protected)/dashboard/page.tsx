import Link from 'next/link';

export const metadata = { title: 'Dashboard · gd-finanzas' };

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Bienvenido</h1>
        <p className="text-sm text-muted-foreground">
          El dashboard real llega en el Hito 5. Por ahora podés gestionar las cuentas:
        </p>
      </div>
      <div>
        <Link href="/accounts" className="text-sm underline underline-offset-4 hover:opacity-80">
          → Ver cuentas
        </Link>
      </div>
    </div>
  );
}
