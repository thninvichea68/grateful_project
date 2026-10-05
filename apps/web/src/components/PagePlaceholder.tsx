import type { ReactNode } from 'react';

interface Props {
  heading: string;
  phase: number;
  summary: string;
  children?: ReactNode;
}

/**
 * Temporary body for routes whose page is built in a later phase. Routing,
 * permissions and the shell are real; only the page content is pending.
 */
export function PagePlaceholder({ heading, phase, summary, children }: Props) {
  return (
    <section className="view active">
      <div className="card">
        <div className="card-header-row">
          <h3>{heading}</h3>
          <span className="status-tag pending">
            <span className="dot" />
            Built in Phase {phase}
          </span>
        </div>
        <p
          style={{
            color: 'var(--text-secondary)',
            fontSize: 14,
            lineHeight: 1.6,
            maxWidth: '72ch',
          }}
        >
          {summary}
        </p>
        {children}
      </div>
    </section>
  );
}
