import { PagePlaceholder } from '../components/PagePlaceholder';

export function DocumentsPage() {
  return (
    <PagePlaceholder
      heading={'Document Library'}
      phase={5}
      summary={
        'Upload, download and categorise documents, linked to shipments and clients. Files are stored on the server volume with their metadata in PostgreSQL.'
      }
    />
  );
}
