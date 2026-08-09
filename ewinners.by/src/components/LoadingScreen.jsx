export default function LoadingScreen({ label = 'Загрузка…' }) {
  return (
    <div className="ew-loading-screen" role="status" aria-live="polite">
      <div className="ew-loading-card">
        <img src="/e-winners-logo.jpeg" alt="" className="ew-loading-logo" />
        <div className="ew-loading-spinner" aria-hidden />
        <p>{label}</p>
      </div>
      <style>{`
        .ew-loading-screen {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background:
            radial-gradient(circle at 20% 20%, rgba(37, 141, 255, 0.22), transparent 42%),
            radial-gradient(circle at 80% 0%, rgba(143, 210, 255, 0.16), transparent 36%),
            #041933;
          color: #eaf4ff;
        }
        .ew-loading-card {
          display: grid;
          justify-items: center;
          gap: 16px;
          text-align: center;
        }
        .ew-loading-logo {
          width: 64px;
          height: 64px;
          border-radius: 16px;
          object-fit: cover;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
        }
        .ew-loading-spinner {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          border: 3px solid rgba(143, 210, 255, 0.22);
          border-top-color: #8fd2ff;
          animation: ew-spin 0.8s linear infinite;
        }
        .ew-loading-card p {
          margin: 0;
          font-size: 0.95rem;
          color: rgba(224, 239, 255, 0.78);
          font-weight: 600;
        }
        @keyframes ew-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
