export function Shell({ message, details }: { message: string; details?: string }) {
    return (
        <div className="shell">
            <div className="card">
                <div className="spinner" />
                <h1>{message}</h1>
                {details != null ? <pre>{details}</pre> : <p>Parsing and highlighting will happen in your browser.</p>}
            </div>
        </div>
    );
}
