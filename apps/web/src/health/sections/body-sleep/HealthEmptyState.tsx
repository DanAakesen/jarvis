export function HealthEmptyState({ name }: { name: string }) {
  return <div className="body-sleep-empty" role="status">
    <p>No {name} records yet.</p>
    <a href="/settings#health-upload">Health upload settings</a>
  </div>;
}
