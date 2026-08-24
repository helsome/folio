import React from 'react';

interface ContentRevealProps {
  children: React.ReactNode;
  className?: string;
  testId?: string;
}

/** Restrained 4px content entrance used when a result replaces a running state. */
export const ContentReveal: React.FC<ContentRevealProps> = ({ children, className = '', testId }) => (
  <div data-testid={testId} className={`folio-motion-content-reveal ${className}`.trim()}>
    {children}
  </div>
);
