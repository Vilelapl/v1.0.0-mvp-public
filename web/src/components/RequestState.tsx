export function Loading({ children }: { children: string }) {
  return <p role="status" className="request-state"><span className="spinner" aria-hidden="true" />{children}</p>;
}
export function RequestError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="request-state error"><p role="alert">{message}</p><button onClick={retry}>Reintentar</button></div>;
}
