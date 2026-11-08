export function LoadingState({ label = "正在翻开页面" }: { label?: string }) {
  return (
    <div className="loading-state" role="status">
      <div className="loading-bars" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="error-state">
      <span className="error-state__eyebrow">CONNECTION LOST</span>
      <h2>这一页暂时没有送达。</h2>
      <p>{message}</p>
      {retry && (
        <button type="button" className="button button--ink" onClick={retry}>
          重新加载
        </button>
      )}
    </div>
  );
}
