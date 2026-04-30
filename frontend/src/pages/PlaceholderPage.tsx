export default function PlaceholderPage({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="max-w-5xl mx-auto px-8 py-20 text-center">
      <p className="section-label mb-2">§ — {title.toUpperCase()}</p>
      <h1 className="font-serif text-5xl text-ink mb-4">{title},</h1>
      <p className="text-ink-4 text-sm">{subtitle}</p>
    </div>
  );
}
