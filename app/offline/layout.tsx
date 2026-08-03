export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-root" data-ds-theme="emerald">
      {children}
    </div>
  );
}
