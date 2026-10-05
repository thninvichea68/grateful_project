import { PagePlaceholder } from '../components/PagePlaceholder';

export function FollowUpPage() {
  return (
    <PagePlaceholder
      heading={'Pending Follow-Up Actions'}
      phase={5}
      summary={
        'Reference, subject, client, due, priority and status, with create/edit/complete and overdue highlighting. The sidebar badge already counts open follow-ups from the database.'
      }
    />
  );
}
