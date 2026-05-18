import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { tags } from '@/db/schema';
import { requireHouseholdSession, SessionError } from '@/lib/auth/session';
import { updateTag } from '@/app/actions/tags/update';
import { TagForm } from '../tag-form';

export const metadata = {
  title: 'Editar etiqueta · gd-finanzas',
};

const idSchema = z.string().uuid();

type RouteParams = Promise<{ id: string }>;

export default async function EditTagPage({ params }: { params: RouteParams }) {
  const { id: idRaw } = await params;
  if (!idSchema.safeParse(idRaw).success) notFound();
  const id = idRaw;

  let session;
  try {
    session = await requireHouseholdSession();
  } catch (err) {
    if (err instanceof SessionError) redirect('/login');
    throw err;
  }

  const db = getDb();
  const [tag] = await db
    .select({ id: tags.id, name: tags.name, color: tags.color })
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.householdId, session.householdId)))
    .limit(1);

  if (!tag) notFound();

  return (
    <div className="mx-auto max-w-xl">
      <TagForm
        action={updateTag}
        hiddenId={tag.id}
        initial={{ name: tag.name, color: tag.color }}
        submitLabel="Guardar cambios"
        title="Editar etiqueta"
        description={`Editando "${tag.name}".`}
      />
    </div>
  );
}
