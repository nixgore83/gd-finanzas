import { redirect } from 'next/navigation';

export default function BudgetIndex() {
  const year = new Date().getFullYear();
  redirect(`/budget/${year}`);
}
