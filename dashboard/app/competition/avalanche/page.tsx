import {notFound,redirect} from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function AvalancheCompetitionPage() {
  if (process.env.NERYA_COMPETITION !== 'avalanche') notFound();
  redirect('/chat');
}
