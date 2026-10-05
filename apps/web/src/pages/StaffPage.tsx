import { PagePlaceholder } from '../components/PagePlaceholder';

export function StaffPage() {
  return (
    <PagePlaceholder
      heading={'Staff & Role Management'}
      phase={5}
      summary={
        'Members, role, department and status, inviting staff, and editing what each role (Admin, Manager, Operator, Accountant, Viewer) is allowed to do.'
      }
    />
  );
}
