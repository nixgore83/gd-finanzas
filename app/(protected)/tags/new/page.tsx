import { redirect } from 'next/navigation';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { createTag } from '@/app/actions/tags/create';
import { TagForm } from '../tag-form';

export const metadata = {
  title: 'Nueva etiqueta · gd-finanzas',
};

export default async function NewTagPage() {
  try {
    await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  return (
    <div className="mx-auto max-w-xl">
      <TagForm
        action={createTag}
        submitLabel="Crear etiqueta"
        title="Nueva etiqueta"
        description="Etiquetas libres para marcar transacciones."
      />
    </div>
  );
}
