export default function Dashboard() {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar always visible, no responsive behavior, no hamburger */}
      <aside data-testid="sidebar" style={{ width: 240, borderRight: "1px solid #ccc" }}>
        <nav style={{ padding: 16 }}>
          <a href="#">Home</a>
          <br />
          <a href="#">Settings</a>
        </nav>
      </aside>

      <div style={{ flex: 1 }}>
        <header
          data-testid="header"
          style={{
            height: 56,
            borderBottom: "1px solid #ccc",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
          }}
        >
          <h1>Dashboard</h1>
        </header>
        <main data-testid="content" style={{ padding: 24 }}>
          <h2>Welcome</h2>
          <p>Dashboard content.</p>
        </main>
      </div>
    </div>
  );
}
