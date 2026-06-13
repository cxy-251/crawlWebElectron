export function StatusBadge({ value }: { value: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
      {value}
    </span>
  );
}

