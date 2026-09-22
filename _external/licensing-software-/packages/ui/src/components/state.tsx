import React from 'react';
import { Loader2, AlertCircle, FileBox } from 'lucide-react';
import { Button } from './button';

export function LoadingState({ message = 'Loading...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-slate-500 min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin mb-4 text-blue-600" />
      <p>{message}</p>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: string | Error; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : error;
  
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center min-h-[400px]">
      <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
      <h3 className="text-lg font-semibold text-slate-900 mb-2">Something went wrong</h3>
      <p className="text-slate-500 mb-6 max-w-md">{message}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline">
          Try Again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string, description: string, action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center p-12 text-center border-2 border-dashed border-slate-200 rounded-lg bg-slate-50 min-h-[300px]">
      <FileBox className="h-12 w-12 text-slate-400 mb-4" />
      <h3 className="text-lg font-medium text-slate-900 mb-1">{title}</h3>
      <p className="text-slate-500 mb-6 max-w-sm">{description}</p>
      {action}
    </div>
  );
}
