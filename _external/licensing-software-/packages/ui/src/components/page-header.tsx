import React from 'react';

export function PageHeader({ title, description, actions }: { title: string, description?: string, actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 pb-4 border-b border-slate-200">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="text-slate-500 mt-1">{description}</p>}
      </div>
      {actions && (
        <div className="mt-4 sm:mt-0 flex items-center gap-3">
          {actions}
        </div>
      )}
    </div>
  );
}
